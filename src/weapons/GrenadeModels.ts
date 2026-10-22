import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { extFor } from "./ArmsRig";
import nadesUrl from "../assets/weapons/grenades.glb?url";

export type LethalType = "frag" | "flame" | "plasma";

/**
 * The "set of grenades" model ships every grenade twice, merged per material,
 * so each grenade is cut out by region (mesh-local coordinates, measured once
 * from the source) and its material set. The result is one mesh per grenade:
 * centred, metres, +Y = fuze end, ready for the hand and for world instances.
 */
const CUT: Record<LethalType, { mats: string[]; min: [number, number, number]; max: [number, number, number]; height: number }> = {
  // AP fragmentation grenade (green egg) — the copy lying at -Y
  frag: { mats: ["lambert10SG", "lambert5SG"], min: [-5, -47, -1.5], max: [46.7, -16.5, 29], height: 0.118 },
  // incendiary canister — the upright copy
  flame: { mats: ["initialShadingGroup", "lambert11SG", "lambert7SG", "lambert8SG"], min: [-13, -17, -1], max: [16, 17, 55], height: 0.15 },
  // plasma grenade — the upright copy
  plasma: { mats: ["lambert2SG", "lambert3SG", "lambert4SG"], min: [22, -16, -1], max: [54, 16, 62.5], height: 0.15 },
};

export async function loadGrenadeSet(scene: Scene, onProgress?: (p: number) => void): Promise<Record<LethalType, Mesh>> {
  const c: AssetContainer = await LoadAssetContainerAsync(nadesUrl, scene, {
    pluginExtension: extFor(nadesUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
  c.addAllToScene();
  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.1;
  }
  const out = {} as Record<LethalType, Mesh>;
  for (const type of Object.keys(CUT) as LethalType[]) out[type] = cut(scene, c, type);
  c.meshes[0].setEnabled(false);
  return out;
}

function cut(scene: Scene, c: AssetContainer, type: LethalType): Mesh {
  const spec = CUT[type];
  type Part = { mat: Mesh["material"]; pos: number[]; nrm: number[]; uv: number[]; idx: number[] };
  const parts: Part[] = [];
  const all: number[] = [];
  for (const m of c.meshes as Mesh[]) {
    if (!m.getTotalVertices() || !m.material || !spec.mats.includes(m.material.name)) continue;
    const P = m.getVerticesData("position")!;
    const N = m.getVerticesData("normal");
    const U = m.getVerticesData("uv");
    const I = m.getIndices()!;
    const map = new Map<number, number>();
    const part: Part = { mat: m.material, pos: [], nrm: [], uv: [], idx: [] };
    const inside = (x: number, y: number, z: number) =>
      x >= spec.min[0] && x <= spec.max[0] && y >= spec.min[1] && y <= spec.max[1] && z >= spec.min[2] && z <= spec.max[2];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], d = I[t + 2];
      const cx = (P[a * 3] + P[b * 3] + P[d * 3]) / 3;
      const cy = (P[a * 3 + 1] + P[b * 3 + 1] + P[d * 3 + 1]) / 3;
      const cz = (P[a * 3 + 2] + P[b * 3 + 2] + P[d * 3 + 2]) / 3;
      if (!inside(cx, cy, cz)) continue;
      for (const v of [a, b, d]) {
        let k = map.get(v);
        if (k === undefined) {
          k = part.pos.length / 3;
          map.set(v, k);
          part.pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          all.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
          if (N) part.nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
          if (U) part.uv.push(U[v * 2], U[v * 2 + 1]);
        }
        part.idx.push(k);
      }
    }
    if (part.idx.length) parts.push(part);
  }

  // frame: centre, long axis (power iteration on the covariance), fuze end = narrower end
  const n = all.length / 3;
  const ctr = new Vector3();
  for (let i = 0; i < all.length; i += 3) ctr.addInPlaceFromFloats(all[i], all[i + 1], all[i + 2]);
  ctr.scaleInPlace(1 / n);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < all.length; i += 3) {
    const d = [all[i] - ctr.x, all[i + 1] - ctr.y, all[i + 2] - ctr.z];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) C[r * 3 + k] += d[r] * d[k];
  }
  let ax = [0.3, 0.2, 1];
  for (let it = 0; it < 64; it++) {
    const w = [0, 1, 2].map((r) => C[r * 3] * ax[0] + C[r * 3 + 1] * ax[1] + C[r * 3 + 2] * ax[2]);
    const L = Math.hypot(w[0], w[1], w[2]);
    ax = w.map((x) => x / L);
  }
  const up = new Vector3(ax[0], ax[1], ax[2]);
  let lo = 1e9, hi = -1e9;
  for (let i = 0; i < all.length; i += 3) {
    const t = (all[i] - ctr.x) * up.x + (all[i + 1] - ctr.y) * up.y + (all[i + 2] - ctr.z) * up.z;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  const rad = (fromTop: boolean) => {
    let s = 0, k = 0;
    for (let i = 0; i < all.length; i += 3) {
      const d = new Vector3(all[i] - ctr.x, all[i + 1] - ctr.y, all[i + 2] - ctr.z);
      const t = Vector3.Dot(d, up);
      if (fromTop ? t < hi - (hi - lo) * 0.2 : t > lo + (hi - lo) * 0.2) continue;
      s += d.subtract(up.scale(t)).length();
      k++;
    }
    return s / Math.max(1, k);
  };
  if (rad(true) > rad(false)) {
    up.scaleInPlace(-1);
    [lo, hi] = [-hi, -lo];
  }
  // recentre along the axis so the grip is in the middle of the body
  ctr.addInPlace(up.scale((lo + hi) / 2));
  const scale = spec.height / (hi - lo);
  const x = Vector3.Cross(up, Math.abs(up.z) < 0.9 ? Vector3.Forward() : Vector3.Right()).normalize();
  const z = Vector3.Cross(x, up).normalize(); // right-handed (glTF space)

  const meshes: Mesh[] = [];
  for (const part of parts) {
    const pos: number[] = [];
    const nrm: number[] = [];
    for (let i = 0; i < part.pos.length; i += 3) {
      const d = new Vector3(part.pos[i] - ctr.x, part.pos[i + 1] - ctr.y, part.pos[i + 2] - ctr.z);
      // glTF (right-handed) → Babylon (left-handed): mirror Z, flip winding below
      pos.push(Vector3.Dot(d, x) * scale, Vector3.Dot(d, up) * scale, -Vector3.Dot(d, z) * scale);
      if (part.nrm.length) {
        const nn = new Vector3(part.nrm[i], part.nrm[i + 1], part.nrm[i + 2]);
        nrm.push(Vector3.Dot(nn, x), Vector3.Dot(nn, up), -Vector3.Dot(nn, z));
      }
    }
    const idx: number[] = [];
    for (let t = 0; t < part.idx.length; t += 3) idx.push(part.idx[t], part.idx[t + 2], part.idx[t + 1]);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    if (nrm.length) vd.normals = nrm;
    if (part.uv.length) vd.uvs = part.uv;
    const m = new Mesh(`${type}_part`, scene);
    vd.applyToMesh(m);
    m.material = part.mat;
    meshes.push(m);
  }
  const merged = Mesh.MergeMeshes(meshes, true, true, undefined, false, true)!;
  merged.name = `${type}Grenade`;
  merged.isPickable = false;
  return merged;
}
