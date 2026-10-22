import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_texture_transform";
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { extFor } from "../weapons/ArmsRig";
import containersUrl from "../assets/props/containers.glb?url";
import psxUrl from "../assets/props/psx_containers.glb?url";
import uralUrl from "../assets/props/ural.glb?url";
import truckUrl from "../assets/props/truck.glb?url";
import crateUrl from "../assets/props/ammo_crate.glb?url";
import ammoBoxUrl from "../assets/props/ammo_pack.glb?url";
import ammoCanUrl from "../assets/props/ammo_can.glb?url";
import woodCrateUrl from "../assets/props/wood_box.glb?url";
import rationUrl from "../assets/props/ration_box.glb?url";

/**
 * Authored set dressing for Red Dune: shipping containers ("Shipping Containers" by Arsen Ismailov,
 * "Psx Cargo Containers" by Brainsick Games), the Ural army truck ("Army Truck" by foxyvfx7867) and a
 * tank transporter ("Transformers Universe: Army Truck" by Primus03) — all CC BY 4.0. Sandstorm's
 * barricades are piles of the supply crates also used for pickups ("Ammo Crate PBR" by avhatar,
 * "AMMO" by FrodaJan, "Ammo Box" by nghiakua06), the six crates of "military wooden box" by
 * ForevereQ (each one a variant) and "Ration cardboard box" by Sousinho — all CC BY 4.0.
 *
 * Each model becomes a template: its parts, measured and re-oriented once (long side along +Z,
 * standing on y = 0, scaled to a real size). Placements are instances of those parts, so a yard
 * full of containers costs one draw per part. Collision stays the level's own boxes.
 */
export type PropKind = "container" | "containerLow" | "ural" | "truck" | "crate" | "ammoBox" | "ammoCan" | "woodCrate" | "ration";

export interface PropPlacement {
  kind: PropKind;
  x: number;
  y: number;
  z: number;
  rotY: number;
  variant?: number;
  /** stretch along the long side (a container cut to fit a street wall to wall) */
  stretch?: number;
  /** "entrance": a container whose doors open (not frozen; its node is "prop_entrance") */
  tag?: string;
}

interface Part {
  mesh: Mesh;
  local: Matrix;
}
interface Template {
  parts: Part[];
}

/** [pitch, roll] to stand a model up when its file lies on its side */
const PRE_ROT: Partial<Record<PropKind, [number, number]>> = {};

/** real-world length (m) of each kind, along its long side */
// "truck" is a tank transporter (tractor + lowboy trailer): ~15.5 m with a 3.4 m cab
// the barricade crates: a big ammunition crate, an ammo box, a can (Sandstorm's Dust2.ts relies on these)
const LENGTH: Record<PropKind, number> = { container: 6.06, containerLow: 6.06, ural: 7.4, truck: 15.5, crate: 1.6, ammoBox: 1.25, ammoCan: 0.5, woodCrate: 1, ration: 0.6 };
/** kinds scaled by a fixed factor instead (a set of variants that keep their sizes relative to each other) */
const SCALE: Partial<Record<PropKind, number>> = { woodCrate: 0.36 };

export class Props {
  private templates = new Map<string, Template[]>();
  readonly meshes: AbstractMesh[] = [];

  constructor(private scene: Scene) {}

  /** the models for `kinds` (only what a stage places: the Ural alone is ~10 MB) */
  async load(kinds: Iterable<PropKind>, onProgress?: (p: number) => void) {
    const want = new Set(kinds);
    const urls = ([
      ["container", containersUrl],
      ["containerLow", psxUrl],
      ["ural", uralUrl],
      ["truck", truckUrl],
      ["crate", crateUrl],
      ["ammoBox", ammoBoxUrl],
      ["ammoCan", ammoCanUrl],
      ["woodCrate", woodCrateUrl],
      ["ration", rationUrl],
    ] as [PropKind, string][]).filter(([k]) => want.has(k));
    const done = new Array(urls.length).fill(0);
    const containers = await Promise.all(
      urls.map(([, url], i) =>
        LoadAssetContainerAsync(url, this.scene, {
          pluginExtension: extFor(url),
          onProgress: (e) => {
            if (e.lengthComputable) done[i] = e.loaded / e.total;
            onProgress?.(done.reduce((a, b) => a + b, 0) / urls.length);
          },
        }),
      ),
    );
    urls.forEach(([kind], i) => this.templates.set(kind, this.build(kind, containers[i])));
  }

  /** split a file into one or more templates (container packs hold several variants) */
  private build(kind: PropKind, c: AssetContainer): Template[] {
    c.addAllToScene();
    const root = c.meshes[0];
    root.computeWorldMatrix(true);
    for (const m of c.materials) {
      if (!(m instanceof PBRMaterial)) continue;
      m.maxSimultaneousLights = 4;
      m.environmentIntensity = 1.0;
      m.backFaceCulling = false; // mirrored (glTF handedness) instances stay solid
    }
    // every drawable node, including the loader's instances of repeated meshes
    const all = c.meshes.filter((m) => m.getTotalVertices() > 0);
    const centre = (m: AbstractMesh) => {
      m.computeWorldMatrix(true);
      m.refreshBoundingInfo({});
      return m.getBoundingInfo().boundingBox.centerWorld.clone();
    };
    let groups: AbstractMesh[][];
    if (kind === "container") {
      // one group per container body ("Main") plus the doors next to it; one of each paint variant
      const mains = all.filter((m) => /Main/.test(m.name));
      const others = all.filter((m) => !/Main/.test(m.name));
      const seen = new Set<string>();
      groups = [];
      for (const main of mains) {
        const mat = main.material?.name ?? "";
        if (seen.has(mat)) continue;
        seen.add(mat);
        const c0 = centre(main);
        groups.push([main, ...others.filter((o) => Vector3.Distance(centre(o), c0) < 3.6 && o.material?.name === mat)]);
      }
    } else if (kind === "containerLow") {
      groups = all.map((m) => [m]); // four textures, one box each
    } else if (kind === "woodCrate") {
      // six crates, one variant each (crate0 … crate5, biggest first: prep-props.mjs)
      groups = [...all].sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m]);
    } else groups = [all];

    const templates: Template[] = [];
    let preMats: Matrix[] | null = null;
    for (const g of groups) {
      // bounds of the group in world space (template as loaded)
      // models exported lying on their side get stood up first (applied before measuring)
      const pre = PRE_ROT[kind];
      if (pre) {
        const rot = Matrix.RotationYawPitchRoll(0, pre[0], pre[1]);
        for (const m of g) m.computeWorldMatrix(true);
        preMats = g.map((m) => m.getWorldMatrix().multiply(rot));
      } else preMats = null;
      const min = new Vector3(Infinity, Infinity, Infinity);
      const max = new Vector3(-Infinity, -Infinity, -Infinity);
      // containers are fitted by their body alone (open doors would skew the size)
      const box = kind === "container" ? [g[0]] : g;
      for (const m of box) {
        m.computeWorldMatrix(true);
        m.refreshBoundingInfo({});
        const bb = m.getBoundingInfo().boundingBox;
        const W = preMats ? preMats[g.indexOf(m)] : null;
        // the 8 local corners through the (possibly pre-rotated) world matrix
        for (const c of bb.vectors) {
          const w = W ? Vector3.TransformCoordinates(c, W) : Vector3.TransformCoordinates(c, m.getWorldMatrix());
          min.minimizeInPlace(w);
          max.maximizeInPlace(w);
        }
      }
      const size = max.subtract(min);
      const centre = min.add(max).scale(0.5);
      // long side → +Z, bottom on y = 0, real length
      const turn = size.x > size.z ? Math.PI / 2 : 0;
      const long = Math.max(size.x, size.z), short = Math.min(size.x, size.z);
      const s = SCALE[kind] ?? LENGTH[kind] / long;
      // containers match their collision box exactly (2.44 × 2.59 × 6.06): stacks sit flush
      const scale =
        kind === "container" || kind === "containerLow" ? new Vector3(2.44 / short, 2.59 / size.y, 6.06 / long) : new Vector3(s, s, s);
      const fit = Matrix.Translation(-centre.x, -min.y, -centre.z)
        .multiply(Matrix.RotationY(turn))
        .multiply(Matrix.Scaling(scale.x, scale.y, scale.z));
      // instances draw from their source mesh
      const parts = g.map((m, i) => ({ mesh: (m instanceof Mesh ? m : (m as unknown as { sourceMesh: Mesh }).sourceMesh), local: (preMats ? preMats[i] : m.getWorldMatrix()).multiply(fit) }));
      for (const m of g) m.isPickable = false;
      templates.push({ parts });
    }
    // the loader's own copies are not needed (instances are made per placement)
    for (const m of all) if (!(m instanceof Mesh)) m.setEnabled(false);
    return templates;
  }

  /** put the props in the world; returns the meshes (shadow casters) */
  place(list: PropPlacement[]) {
    const t = new Vector3();
    const q = new Quaternion();
    const sc = new Vector3();
    list.forEach((p, i) => {
      const set = this.templates.get(p.kind);
      if (!set?.length) return;
      const tpl = set[(p.variant ?? i) % set.length];
      const node = new TransformNode(p.tag === "entrance" ? "prop_entrance" : `prop_${p.kind}_${i}`, this.scene);
      node.position.set(p.x, p.y, p.z);
      node.rotation.y = p.rotY;
      if (p.stretch) node.scaling.z = p.stretch;
      for (const part of tpl.parts) {
        const inst = part.mesh.createInstance(`${node.name}_${part.mesh.name}`);
        part.local.decompose(sc, q, t);
        inst.parent = node;
        inst.position.copyFrom(t);
        inst.rotationQuaternion = q.clone();
        inst.scaling.copyFrom(sc);
        inst.isPickable = false;
        inst.receiveShadows = true;
        inst.computeWorldMatrix(true);
        if (p.tag !== "entrance") inst.freezeWorldMatrix();
        this.meshes.push(inst);
      }
    });
    // the source meshes must render for their instances
    for (const set of this.templates.values()) for (const tpl of set) for (const part of tpl.parts) {
      part.mesh.setEnabled(true);
      part.mesh.isVisible = true;
      part.mesh.position.set(0, -500, 0);
      part.mesh.setParent(null);
      part.mesh.scaling.setAll(0.0001);
    }
    return this.meshes;
  }
}
