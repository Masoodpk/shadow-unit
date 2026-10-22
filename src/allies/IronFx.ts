import { Color4 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Color3 } from "@babylonjs/core/Maths/math.color";

/**
 * Iron Man's thruster fire: for each nozzle (both boots, both palms) a bright flare — a soft glow
 * with a white-hot core, flickering, sized by the thrust — and a stream of flame sprites thrown out
 * along the nozzle (white-yellow at the nozzle, orange, then a dark smoky red as they die), with the
 * armour's own motion added so the plume trails behind him in flight. Everything is camera-facing
 * quads in one mesh (a fixed pool; one draw call), additive.
 */
const MAX = 260;

interface Spr {
  p: Vector3;
  v: Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
  /** 0 flame, 1 flare (held at a nozzle for one frame), 2 shock-diamond spark */
  kind: number;
  heat: number;
}

/** a soft round sprite: white core, falling off to nothing */
function glowTexture(scene: Scene) {
  const S = 64;
  const t = new DynamicTexture("ironGlowTex", { width: S, height: S }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  t.update();
  t.hasAlpha = true;
  return t;
}

export class ThrusterFx {
  private mesh: Mesh;
  private pos = new Float32Array(MAX * 12);
  private col = new Float32Array(MAX * 16);
  private spr: Spr[] = [];
  private flares: { at: Vector3; size: number; heat: number }[] = [];
  private emitAcc = [0, 0, 0, 0];
  private right = new Vector3();
  private up = new Vector3();

  constructor(private scene: Scene) {
    const m = (this.mesh = new Mesh("ironThrusterFx", scene));
    const uv = new Float32Array(MAX * 8);
    const idx: number[] = [];
    for (let i = 0; i < MAX; i++) {
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const k = i * 4;
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const vd = new VertexData();
    vd.positions = this.pos;
    vd.uvs = uv;
    vd.colors = this.col;
    vd.indices = idx;
    vd.applyToMesh(m, true);
    const mat = new StandardMaterial("ironThrusterMat", scene);
    const tex = glowTexture(scene);
    mat.disableLighting = true;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.alphaMode = 1; // ADD
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    m.material = mat;
    m.hasVertexAlpha = true;
    m.useVertexColors = true;
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    m.renderingGroupId = 0;
    for (let i = 0; i < MAX; i++) this.spr.push({ p: new Vector3(), v: new Vector3(), life: 0, max: 1, size: 0.1, grow: 0, kind: 0, heat: 1 });
  }

  /**
   * One nozzle this frame: where it is, which way the fire goes, how hard (0..1+), and the armour's
   * own velocity (the plume trails behind him). `n` picks the nozzle (0,1 boots; 2,3 palms).
   */
  nozzle(n: number, at: Vector3, dir: Vector3, k: number, carry: Vector3, dt: number, big: boolean) {
    if (k <= 0.03) return;
    const scale = big ? 1 : 0.62;
    // the flare: a glow sitting on the nozzle, flickering, bigger with the thrust
    this.flares.push({ at: at.add(dir.scale(0.04)), size: (0.28 + k * 0.42) * scale * (0.85 + Math.random() * 0.3), heat: 1 });
    // the stream: a few dozen sprites a second per nozzle, more when he opens up
    this.emitAcc[n] += dt * (35 + 110 * k) * scale;
    while (this.emitAcc[n] >= 1) {
      this.emitAcc[n] -= 1;
      const s = this.spr.find((x) => x.life <= 0);
      if (!s) break;
      const spread = 0.12;
      const jitter = new Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread);
      const speed = (5 + 9 * k) * scale * (0.8 + Math.random() * 0.4);
      s.p.copyFrom(at).addInPlace(dir.scale(0.05 + Math.random() * 0.08));
      s.v.copyFrom(dir).addInPlace(jitter).normalize().scaleInPlace(speed).addInPlace(carry.scale(0.7));
      s.max = s.life = (0.1 + Math.random() * 0.12) * (0.7 + k * 0.5);
      s.size = (0.12 + k * 0.1) * scale;
      s.grow = 0.9 * scale;
      s.kind = Math.random() < 0.07 * k ? 2 : 0;
      s.heat = 1;
    }
  }

  update(dt: number) {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    // the billboard axes (the camera's right and up)
    const view = cam.getViewMatrix();
    this.right.set(view.m[0], view.m[4], view.m[8]);
    this.up.set(view.m[1], view.m[5], view.m[9]);
    const P = this.pos, C = this.col;
    let q = 0;
    const put = (c: Vector3, size: number, r: number, g: number, b: number, a: number) => {
      if (q >= MAX) return;
      const rx = this.right.x * size, ry = this.right.y * size, rz = this.right.z * size;
      const ux = this.up.x * size, uy = this.up.y * size, uz = this.up.z * size;
      const o = q * 12;
      P[o] = c.x - rx - ux; P[o + 1] = c.y - ry - uy; P[o + 2] = c.z - rz - uz;
      P[o + 3] = c.x + rx - ux; P[o + 4] = c.y + ry - uy; P[o + 5] = c.z + rz - uz;
      P[o + 6] = c.x + rx + ux; P[o + 7] = c.y + ry + uy; P[o + 8] = c.z + rz + uz;
      P[o + 9] = c.x - rx + ux; P[o + 10] = c.y - ry + uy; P[o + 11] = c.z - rz + uz;
      const k = q * 16;
      for (let v = 0; v < 4; v++) {
        C[k + v * 4] = r;
        C[k + v * 4 + 1] = g;
        C[k + v * 4 + 2] = b;
        C[k + v * 4 + 3] = a;
      }
      q++;
    };
    // flares: a big soft orange halo and a small white-hot core
    for (const f of this.flares) {
      put(f.at, f.size * 1.25, 1, 0.45, 0.12, 0.5);
      put(f.at, f.size * 0.75, 1, 0.85, 0.55, 0.9);
      put(f.at, f.size * 0.32, 1, 1, 1, 1);
    }
    this.flares.length = 0;
    // the stream
    for (const s of this.spr) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.life <= 0) continue;
      s.p.addInPlace(s.v.scale(dt));
      s.v.scaleInPlace(Math.exp(-5 * dt));
      const f = 1 - s.life / s.max; // 0 at the nozzle → 1 dying
      const size = s.size * (1 + f * s.grow * 2.2);
      if (s.kind === 2) {
        // a shock-diamond spark: a hard white-blue fleck
        put(s.p, s.size * 0.45, 0.8, 0.9, 1, 1 - f);
        continue;
      }
      // white-yellow → orange → a dark, smoky red as it dies
      const r = 1;
      const g = f < 0.3 ? 0.92 - f * 1.2 : Math.max(0.15, 0.56 - (f - 0.3) * 0.6);
      const b = f < 0.2 ? 0.7 - f * 3 : Math.max(0.03, 0.1 - f * 0.08);
      put(s.p, size, r, g, b, Math.max(0, (1 - f) * 0.85));
    }
    // (unused quads collapse to nothing)
    for (let i = q; i < MAX; i++) {
      const o = i * 12;
      for (let k = 0; k < 12; k++) P[o + k] = 0;
    }
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, P, false, false);
    this.mesh.updateVerticesData(VertexBuffer.ColorKind, C, false, false);
    this.mesh.refreshBoundingInfo();
    this.mesh.setEnabled(q > 0);
  }

  reset() {
    for (const s of this.spr) s.life = 0;
    this.flares.length = 0;
    this.mesh.setEnabled(false);
  }
  /** sprites alive (tests: they're freed) */
  get active() {
    return this.spr.filter((s) => s.life > 0).length;
  }
}
void Color4;
