import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { WEAPONS, WeaponId } from "../config/weapons";
import type { WeaponRig } from "../weapons/WeaponModels";
import { mulberry32 } from "../core/math";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
// the "AMMO" pack uses the specular-glossiness workflow
import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_pbrSpecularGlossiness";
import { extFor } from "../weapons/ArmsRig";
import type { WallSpot } from "./Spots";
import canUrl from "../assets/props/ammo_can.glb?url";
import crateUrl from "../assets/props/ammo_crate.glb?url";
import packUrl from "../assets/props/ammo_pack.glb?url";

export type PickupKind = "weapon" | "ammo" | "rockets" | "grenades";

export interface Pickup {
  kind: PickupKind;
  /** weapon pickups: which gun and the rounds in it */
  id?: WeaponId;
  mag: number;
  reserve: number;
  node: TransformNode;
  /** what disappears when taken (the gun; the crate under it stays) */
  model: TransformNode;
  pos: Vector3;
  /** placed by the stage (comes back on restart) or dropped during play (removed on restart) */
  placed: boolean;
  taken: boolean;
  onTaken?: () => void;
}

/** real overall lengths (m) the world models are scaled to */
const LENGTH: Partial<Record<WeaponId, number>> = { rifle: 0.84, ak47: 0.88, m5: 0.74, vssk: 1.0, glock: 0.19, vector: 0.62, m72: 0.88, dzj08: 1.0 };

/**
 * Things lying around the stage to pick up, like any shooter: guns (on a crate, or dropped by a dead
 * soldier, or the one you swapped away), ammo boxes, rocket crates and grenade crates.
 *
 * Gun models are copied from the first-person rigs (just the gun's own meshes, arms left out) and
 * scaled to the real weapon's length; boxes are simple painted crates. Ammo, rocket and grenade boxes
 * are taken by walking into them (only if you need what's inside); guns are taken with the use key.
 */
export class Pickups {
  readonly items: Pickup[] = [];
  /** crates you bump into (added to the player's collision set) */
  readonly solids: AbstractMesh[] = [];
  private models = new Map<WeaponId, TransformNode>();
  private boxes = new Map<string, TransformNode>();
  private crate: TransformNode;
  /** height of the crate a gun rests on, and its depth (out from the wall) */
  private crateH = 0.5;
  private crateD = 0.55;
  /** footprint depth of each box kind (how far it stands out from the wall) */
  private depth: Record<string, number> = { ammo: 0.16, rockets: 0.32, grenades: 0.34 };
  private n = 0;

  constructor(private scene: Scene, rigs: Partial<Record<WeaponId, WeaponRig>>) {
    for (const id of Object.keys(LENGTH) as WeaponId[]) {
      const rig = rigs[id];
      if (rig) this.models.set(id, this.worldModel(id, rig));
    }
    const mat = (name: string, c: Color3, rough = 0.8, metal = 0) => {
      const m = new PBRMaterial(name, scene);
      m.albedoColor = c;
      m.roughness = rough;
      m.metallic = metal;
      m.maxSimultaneousLights = 4;
      return m;
    };
    const olive = mat("pkOlive", new Color3(0.2, 0.24, 0.13), 0.6, 0.3);
    const wood = mat("pkWood", new Color3(0.36, 0.25, 0.14));
    const yellow = mat("pkYellow", new Color3(0.75, 0.6, 0.1), 0.6);
    const red = mat("pkRed", new Color3(0.5, 0.08, 0.06), 0.6);
    const box = (name: string, w: number, h: number, d: number, m: PBRMaterial, parent: TransformNode, y = h / 2) => {
      const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      b.material = m;
      b.position.y = y;
      b.parent = parent;
      b.isPickable = false;
      return b;
    };
    const tpl = (name: string) => {
      const t = new TransformNode(name, scene);
      t.setEnabled(false);
      return t;
    };
    // ammo can: olive steel, a yellow band
    const ammo = tpl("pkAmmoTpl");
    box("pkAmmo", 0.32, 0.2, 0.16, olive, ammo);
    box("pkAmmoBand", 0.33, 0.04, 0.17, yellow, ammo, 0.15);
    this.boxes.set("ammo", ammo);
    // rocket crate: long wooden box with a red stencil band
    const rockets = tpl("pkRocketTpl");
    box("pkRocket", 1.05, 0.22, 0.32, wood, rockets);
    box("pkRocketBand", 0.12, 0.23, 0.33, red, rockets, 0.11);
    this.boxes.set("rockets", rockets);
    // grenade crate: squat olive box, yellow band
    const nades = tpl("pkNadeTpl");
    box("pkNade", 0.46, 0.26, 0.34, olive, nades);
    box("pkNadeBand", 0.47, 0.05, 0.35, yellow, nades, 0.2);
    this.boxes.set("grenades", nades);
    // the crate a placed gun lies on
    this.crate = tpl("pkCrateTpl");
    box("pkCrate", 1.1, 0.5, 0.55, wood, this.crate);
  }

  /**
   * The real supply models (CC BY 4.0, see credits): a steel ammo can, a box of rifle ammunition and
   * a long wooden ammunition crate (guns rest on it; rockets come in it). Each is re-rooted, turned
   * so its long side runs along local X, scaled to real size and stood on the floor. A model that
   * fails to load keeps the painted stand-in box.
   */
  async loadModels() {
    const load = async (url: string, long: number, kind: "ammo" | "pack" | "crate") => {
      try {
        const c = await LoadAssetContainerAsync(url, this.scene, { pluginExtension: extFor(url) });
        c.addAllToScene();
        const t = new TransformNode("pkGlb_" + kind, this.scene);
        const holder = new TransformNode("pkGlbHolder_" + kind, this.scene);
        holder.parent = t;
        for (const m of c.rootNodes) m.parent = holder;
        for (const m of c.meshes) {
          m.isPickable = false;
          m.receiveShadows = true;
          const mat = m.material as PBRMaterial | null;
          if (mat && "maxSimultaneousLights" in mat) mat.maxSimultaneousLights = 4;
        }
        holder.computeWorldMatrix(true);
        let { min, max } = holder.getHierarchyBoundingVectors(true);
        // long side along X
        if (max.z - min.z > max.x - min.x) {
          holder.rotation.y = Math.PI / 2;
          holder.computeWorldMatrix(true);
          ({ min, max } = holder.getHierarchyBoundingVectors(true));
        }
        const k = long / Math.max(1e-4, max.x - min.x);
        holder.scaling.scaleInPlace(k);
        holder.computeWorldMatrix(true);
        ({ min, max } = holder.getHierarchyBoundingVectors(true));
        holder.position.set(-(min.x + max.x) / 2, -min.y + 0.003, -(min.z + max.z) / 2);
        t.setEnabled(false);
        return { t, h: max.y - min.y, d: max.z - min.z };
      } catch (e) {
        console.warn("supply model failed to load", url, e);
        return null;
      }
    };
    const [can, pack, crate] = await Promise.all([load(canUrl, 0.32, "ammo"), load(packUrl, 0.36, "pack"), load(crateUrl, 1.05, "crate")]);
    if (can) {
      this.boxes.set("ammo", can.t);
      this.depth.ammo = can.d;
    }
    if (pack) {
      this.boxes.set("pack", pack.t);
      this.depth.pack = pack.d;
    }
    if (crate) {
      this.crate = crate.t;
      this.crateH = crate.h;
      this.crateD = crate.d;
      this.boxes.set("rockets", crate.t);
      this.depth.rockets = crate.d;
    }
  }

  /** the gun's own meshes from a first-person rig, re-rooted, laid on its side, real size */
  /** a gun's world model, for a soldier's hand (the boss's sidearm): a fresh copy, centred, +Z its muzzle */
  sidearm(id: WeaponId): TransformNode | null {
    const t = this.models.get(id);
    if (!t) return null;
    const c = t.instantiateHierarchy(null, undefined, (src, clone) => (clone.name = src.name + "_side"));
    if (!c) return null;
    c.setEnabled(true);
    for (const m of c.getChildMeshes(false)) m.setEnabled(true);
    // (the pickup lies on its side, raised to rest on the ground: in a hand it's upright, centred)
    const model = c.getChildren()[0] as TransformNode | undefined;
    if (model) {
      model.rotation.z = 0;
      model.position.y = 0;
    }
    return c;
  }
  private worldModel(id: WeaponId, rig: WeaponRig): TransformNode {
    const scene = this.scene;
    const root = new TransformNode("pkModel_" + id, scene);
    const inner = new TransformNode("pkModelInner_" + id, scene);
    inner.parent = root;
    const was = rig.root.isEnabled();
    rig.root.setEnabled(true);
    rig.root.computeWorldMatrix(true);
    const inv = Matrix.Invert(rig.root.getWorldMatrix());
    const parts: AbstractMesh[] = [];
    for (const m of rig.meshes) {
      if (!(m instanceof Mesh) || m.skeleton || !m.getTotalVertices() || !m.isEnabled() || !m.isVisible) continue;
      m.computeWorldMatrix(true);
      const c = m.clone(m.name + "_pk", null, true);
      if (!c) continue;
      c.parent = inner;
      const rel = m.getWorldMatrix().multiply(inv);
      const s = new Vector3(), q = new Quaternion(), p = new Vector3();
      rel.decompose(s, q, p);
      c.scaling.copyFrom(s);
      c.rotationQuaternion = q;
      c.position.copyFrom(p);
      c.renderingGroupId = 0;
      c.alwaysSelectAsActiveMesh = false;
      c.doNotSyncBoundingInfo = false;
      c.isPickable = false;
      c.receiveShadows = true;
      c.setEnabled(true);
      parts.push(c);
    }
    rig.root.setEnabled(was);
    if (!parts.length) {
      // no usable geometry: a plain dark stand-in the size of the gun
      const b = MeshBuilder.CreateBox("pkStandIn_" + id, { width: 0.05, height: 0.15, depth: LENGTH[id] ?? 0.8 }, scene);
      b.parent = inner;
      parts.push(b);
    }
    // centre it and scale its length (rigs point down +Z) to the real weapon
    root.computeWorldMatrix(true);
    let mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const p of parts) {
      p.computeWorldMatrix(true);
      p.refreshBoundingInfo({});
      const bb = p.getBoundingInfo().boundingBox;
      mn = Vector3.Minimize(mn, bb.minimumWorld);
      mx = Vector3.Maximize(mx, bb.maximumWorld);
    }
    const len = Math.max(1e-3, mx.z - mn.z);
    const k = (LENGTH[id] ?? 0.8) / len;
    const centre = mn.add(mx).scale(0.5);
    inner.position.copyFrom(centre.scale(-1));
    // lying on its side: half its width above the surface
    const halfW = ((mx.x - mn.x) / 2) * k;
    root.scaling.setAll(k);
    // rotate the scaled model onto its side (roll 90°), raised so it rests on the surface
    const holder = new TransformNode("pkModelHolder_" + id, scene);
    root.parent = holder;
    root.rotation.z = Math.PI / 2;
    root.position.y = halfW + 0.01;
    holder.setEnabled(false);
    return holder;
  }

  private instance(tpl: TransformNode, name: string) {
    // clones, not instances: a disabled template would hide instances (there are only a few dozen)
    const n = tpl.instantiateHierarchy(null, { doNotInstantiate: true }, (src, clone) => {
      clone.name = src.name + "_" + name;
    })!;
    n.setEnabled(true);
    for (const m of n.getChildMeshes()) m.isPickable = false;
    // solid crates: a box collider round the whole crate (the model's own meshes stay visual)
    if (tpl === this.crate) {
      const b = MeshBuilder.CreateBox("pkCrateCol", { width: 1.05, height: this.crateH, depth: this.crateD }, this.scene);
      b.parent = n;
      b.position.y = this.crateH / 2;
      b.isVisible = false;
      b.isPickable = false;
      b.checkCollisions = true;
      this.solids.push(b);
    }
    return n;
  }

  /** a gun on the ground (or on a crate when `onCrate`) */
  addWeapon(id: WeaponId, pos: Vector3, yaw: number, mag: number, reserve: number, placed: boolean, onCrate = false, onTaken?: () => void) {
    const tpl = this.models.get(id);
    if (!tpl) return null;
    const node = new TransformNode("pickup" + this.n++, this.scene);
    node.position.copyFrom(pos);
    node.rotation.y = yaw;
    let y = 0;
    if (onCrate) {
      const c = this.instance(this.crate, "crate" + this.n);
      c.parent = node;
      y = this.crateH;
    }
    const g = this.instance(tpl, "gun" + this.n);
    g.parent = node;
    g.position.y = y;
    // laid along the crate (or across your path on the floor), never perfectly square
    g.rotation.y = (onCrate ? Math.PI / 2 : 0) + (Math.random() - 0.5) * 0.3;
    const p: Pickup = { kind: "weapon", id, mag, reserve, node, model: g, pos: pos.add(new Vector3(0, y + 0.05, 0)), placed, taken: false, onTaken };
    this.items.push(p);
    return p;
  }

  addBox(kind: Exclude<PickupKind, "weapon">, pos: Vector3, yaw: number, look: string = kind) {
    const node = this.instance(this.boxes.get(look) ?? this.boxes.get(kind)!, kind + this.n++);
    node.position.copyFrom(pos);
    node.rotation.y = yaw;
    const p: Pickup = { kind, mag: 0, reserve: 0, node, model: node, pos: pos.add(new Vector3(0, 0.15, 0)), placed: true, taken: false };
    this.items.push(p);
    return p;
  }

  take(p: Pickup) {
    p.taken = true;
    p.model.setEnabled(false);
    p.onTaken?.();
    if (!p.placed) {
      p.node.dispose();
      this.items.splice(this.items.indexOf(p), 1);
    }
  }

  /** the gun you're looking at within reach (aim ray close to it, or standing right over it) */
  lookAt(eye: Vector3, dir: Vector3, reach = 2.2): Pickup | null {
    let best: Pickup | null = null;
    let bestScore = Infinity;
    for (const p of this.items) {
      if (p.taken || p.kind !== "weapon") continue;
      const tx = p.pos.x - eye.x, ty = p.pos.y - eye.y, tz = p.pos.z - eye.z;
      const d = Math.hypot(tx, ty, tz);
      if (d > reach) continue;
      const along = (tx * dir.x + ty * dir.y + tz * dir.z) / Math.max(1e-3, d);
      // within ~35° of the view, or practically at your feet
      if (along < 0.82 && Math.hypot(tx, tz) > 0.7) continue;
      const score = d * (1.6 - along);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /** boxes you're standing at (walk-over pickups) */
  touching(feet: Vector3, r = 1.0): Pickup[] {
    return this.items.filter((p) => !p.taken && p.kind !== "weapon" && Math.hypot(p.pos.x - feet.x, p.pos.z - feet.z) < r && Math.abs(p.pos.y - feet.y) < 1.2);
  }

  /** restart: everything the stage placed comes back, everything dropped during play goes */
  reset() {
    for (const p of [...this.items]) {
      if (p.placed) {
        p.taken = false;
        p.model.setEnabled(true);
      } else {
        p.node.dispose();
        this.items.splice(this.items.indexOf(p), 1);
      }
    }
  }

  /**
   * The stage's supplies, the way a base keeps them: caches stood against the walls of its rooms
   * (outdoors only where a stage has too few rooms) — a gun laid on an ammunition crate with a can
   * of ammo or a crate of grenades beside it, rocket crates, ammo stacked by the wall. The first
   * cache is near the insertion point; the rest are spread over the base (farthest-point).
   */
  populate(walls: WallSpot[], start: Vector3, seed: number, fits: (p: Vector3) => boolean = () => true) {
    const rnd = mulberry32(seed);
    const caches: ({ kind: "weapon"; id: WeaponId } | { kind: Exclude<PickupKind, "weapon">; look?: string })[][] = [
      [{ kind: "ammo" }, { kind: "ammo", look: "pack" }],
      [{ kind: "weapon", id: "ak47" }, { kind: "ammo" }],
      [{ kind: "weapon", id: "m72" }, { kind: "rockets" }],
      [{ kind: "weapon", id: "vector" }, { kind: "grenades" }],
      [{ kind: "weapon", id: "vssk" }, { kind: "ammo", look: "pack" }],
      [{ kind: "rockets" }, { kind: "ammo" }],
      [{ kind: "weapon", id: "m5" }, { kind: "grenades" }],
      [{ kind: "weapon", id: "dzj08" }, { kind: "rockets" }],
      [{ kind: "ammo", look: "pack" }, { kind: "grenades" }],
    ];
    const away = walls.filter((w) => Vector3.Distance(w.pos, start) > 5);
    if (!away.length) return;
    const chosen: WallSpot[] = [];
    // rooms first; walls outside only once every room that's far enough from the others is used
    const first = [...away].sort((a, b) => Number(b.indoor) - Number(a.indoor) || Vector3.Distance(a.pos, start) - Vector3.Distance(b.pos, start))[0];
    chosen.push(first);
    while (chosen.length < caches.length && chosen.length < away.length) {
      const rooms = away.filter((w) => w.indoor && chosen.every((c) => Vector3.DistanceSquared(c.pos, w.pos) > 64));
      const pool = rooms.length ? rooms : away;
      let best = pool[0], bestD = -1;
      for (const w of pool) {
        let d = Infinity;
        for (const c of chosen) d = Math.min(d, Vector3.DistanceSquared(w.pos, c.pos));
        d = Math.min(d, Vector3.DistanceSquared(w.pos, start) * 0.6) * (0.85 + rnd() * 0.3);
        if (d > bestD) {
          bestD = d;
          best = w;
        }
      }
      chosen.push(best);
    }
    chosen.forEach((w, i) => {
      const items = caches[i];
      if (!items) return;
      // along the wall: the first item at the spot, the next one beside it
      const tx = w.normal.z, tz = -w.normal.x;
      let along = 0;
      items.forEach((it, j) => {
        const isGun = it.kind === "weapon";
        const look = isGun ? "crate" : (it as { look?: string }).look ?? it.kind;
        const depth = isGun ? this.crateD : this.depth[look] ?? 0.3;
        const width = isGun || look === "rockets" ? 1.1 : 0.45;
        if (j > 0) along += width / 2 + 0.12;
        const out = depth / 2 + 0.04;
        // beside the first on one side, else the other (a corner, a doorway)
        let p = new Vector3(w.wall.x + w.normal.x * out + tx * along, w.pos.y, w.wall.z + w.normal.z * out + tz * along);
        if (j > 0 && !fits(p)) p = new Vector3(w.wall.x + w.normal.x * out - tx * along, w.pos.y, w.wall.z + w.normal.z * out - tz * along);
        if (j > 0 && !fits(p)) return;
        along += width / 2;
        const yaw = w.yaw + (isGun ? 0 : (rnd() - 0.5) * 0.25);
        if (it.kind === "weapon") {
          const cfg = WEAPONS[it.id];
          this.addWeapon(it.id, p, yaw, cfg.magSize, cfg.reserveStart, true, true);
        } else this.addBox(it.kind, p, yaw, look);
      });
    });
  }
}
