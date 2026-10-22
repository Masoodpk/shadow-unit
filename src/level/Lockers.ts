import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { extFor } from "../weapons/ArmsRig";
import lockerUrl from "../assets/props/locker.glb?url";

/**
 * A row of steel lockers against a wall ("Locker room - 1mb", CC BY 4.0): the cell's stash in the
 * tunnels under the town. Each
 * one can be searched (its door swings open); one holds the dossier and the key ring — a manila
 * folder with a ring of keys on it, on the shelf, taken when you search that locker.
 *
 * The model is a pair of lockers, one shut and one with its door open: the shut one is the
 * template, and the open one shows which edge its door hangs on.
 */
export class LockerModel {
  private constructor(private c: AssetContainer) {}
  static async load(scene: Scene) {
    const c = await LoadAssetContainerAsync(lockerUrl, scene, { pluginExtension: extFor(lockerUrl) });
    for (const m of c.materials) {
      if (!(m instanceof PBRMaterial)) continue;
      m.maxSimultaneousLights = 4;
      // (they stand underground: the sun mustn't light them like the street outside)
      m.environmentIntensity = 0.35;
      m.directIntensity = 0.35;
    }
    return new LockerModel(c);
  }

  /** `count` lockers side by side, backs on the wall at `at`, fronts facing `yaw` */
  place(scene: Scene, at: Vector3, yaw: number, count: number, width: number, depth: number) {
    return new Lockers(scene, this.c, at, yaw, count, width, depth);
  }
}

interface Locker {
  hinge: TransformNode;
  /** door swing sign and progress (0 shut … 1 open) */
  dir: number;
  open: number;
  opening: boolean;
  searched: boolean;
  /** where you stand to search it (in front of its door, at chest height) */
  front: Vector3;
}

const find = (all: AbstractMesh[], name: string) => {
  const m = all.find((x) => x.name.startsWith(name + "#") || x.name === name);
  if (!m) throw new Error("locker model: missing " + name);
  return m;
};

/** height of the floor inside a locker (the model's plinth) */
const FLOOR = 0.507;

export class Lockers {
  readonly list: Locker[] = [];
  /** the one with the dossier */
  intel = 0;
  private folder: TransformNode;
  private fwd: Vector3;

  constructor(scene: Scene, c: AssetContainer, at: Vector3, yaw: number, count: number, width: number, depth: number) {
    this.fwd = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let i = 0; i < count; i++) {
      const inst = c.instantiateModelsToScene((n) => `${n}#${i}`, false, { doNotInstantiate: true });
      // (the glTF root carries the file's handedness as a quaternion: turn and move a holder instead)
      const root = new TransformNode(`locker${i}`, scene);
      (inst.rootNodes[0] as TransformNode).parent = root;
      const all = root.getChildMeshes(false);
      for (const m of all) m.isPickable = false;
      const body = find(all, "02__0"), door = find(all, "02_2__0");
      const body2 = find(all, "01__0"), door2 = find(all, "01_2__0");
      root.computeWorldMatrix(true);
      for (const m of all) m.computeWorldMatrix(true);
      const box = (m: AbstractMesh) => {
        m.refreshBoundingInfo({});
        return m.getBoundingInfo().boundingBox;
      };
      // the model's own frame: its front (towards the shut door) and which side the doors hang on
      const bb = box(body), db = box(door);
      const front = db.centerWorld.subtract(bb.centerWorld);
      front.y = 0;
      front.normalize();
      const side = Vector3.Cross(Vector3.Up(), front); // (to the model's right, seen from the front: LH)
      const hangs = Math.sign(Vector3.Dot(box(door2).centerWorld.subtract(box(body2).centerWorld), side)) || 1;
      // the second (open) locker isn't used
      body2.setEnabled(false);
      door2.setEnabled(false);
      // turn the model so its front faces `yaw`, then put its back on the wall at its slot
      root.rotation.y += yaw - Math.atan2(front.x, front.z);
      root.computeWorldMatrix(true);
      for (const m of all) m.computeWorldMatrix(true);
      const c0 = box(body).centerWorld;
      const slot = at.add(right.scale((i - (count - 1) / 2) * width)).add(this.fwd.scale(depth / 2));
      root.position.addInPlace(new Vector3(slot.x - c0.x, at.y - box(body).minimumWorld.y, slot.z - c0.z));
      root.computeWorldMatrix(true);
      for (const m of all) m.computeWorldMatrix(true);
      // the door on a hinge at its hanging edge, at the front
      const sideW = Vector3.TransformNormal(side, Matrix.RotationY(yaw - Math.atan2(front.x, front.z)));
      const d = box(door);
      const hingeAt = new Vector3(slot.x, at.y, slot.z).add(sideW.scale((hangs * width) / 2)).add(this.fwd.scale(Vector3.Dot(d.centerWorld.subtract(slot), this.fwd)));
      const hinge = new TransformNode(`lockerHinge${i}`, scene);
      hinge.position.copyFrom(hingeAt);
      door.setParent(hinge);
      // which way it swings: the way that brings the door's middle out in front
      const arm = d.centerWorld.subtract(hingeAt);
      const test = Vector3.TransformCoordinates(arm, Matrix.RotationY(1));
      const dir = Vector3.Dot(test, this.fwd) > 0 ? 1 : -1;
      this.list.push({ hinge, dir, open: 0, opening: false, searched: false, front: slot.add(this.fwd.scale(depth / 2 + 0.6)).addInPlaceFromFloats(0, 1.2, 0) });
    }
    this.folder = this.makeFolder(scene);
    this.reset(0);
  }

  /** a manila folder with a ring of keys on it */
  private makeFolder(scene: Scene) {
    const node = new TransformNode("dossier", scene);
    const paper = new PBRMaterial("dossierPaper", scene);
    paper.albedoColor = new Color3(0.6, 0.47, 0.27);
    paper.metallic = 0;
    paper.roughness = 0.9;
    paper.maxSimultaneousLights = 4;
    const f = MeshBuilder.CreateBox("dossierFolder", { width: 0.24, height: 0.025, depth: 0.32 }, scene);
    f.material = paper;
    f.parent = node;
    const stamp = new PBRMaterial("dossierStamp", scene);
    stamp.albedoColor = new Color3(0.55, 0.08, 0.06);
    stamp.metallic = 0;
    stamp.roughness = 0.9;
    stamp.maxSimultaneousLights = 4;
    const s = MeshBuilder.CreateBox("dossierStamp", { width: 0.12, height: 0.002, depth: 0.05 }, scene);
    s.material = stamp;
    s.parent = node;
    s.position.set(0, 0.0135, -0.08);
    const steel = new PBRMaterial("keySteel", scene);
    steel.albedoColor = new Color3(0.72, 0.66, 0.45);
    steel.metallic = 1;
    steel.roughness = 0.35;
    steel.maxSimultaneousLights = 4;
    const ring = MeshBuilder.CreateTorus("keyRing", { diameter: 0.05, thickness: 0.005, tessellation: 14 }, scene);
    ring.material = steel;
    ring.parent = node;
    ring.position.set(0.05, 0.016, 0.07);
    for (const [a, l] of [[0.4, 0.07], [-0.5, 0.06]]) {
      const k = MeshBuilder.CreateBox("key", { width: 0.012, height: 0.003, depth: l }, scene);
      k.material = steel;
      k.parent = node;
      k.rotation.y = a;
      k.position.set(0.05 + Math.sin(a) * (0.025 + l / 2), 0.016, 0.07 + Math.cos(a) * (0.025 + l / 2));
    }
    for (const m of node.getChildMeshes()) m.isPickable = false;
    return node;
  }

  /** shut them all; the dossier goes in locker `intel` */
  reset(intel: number) {
    this.intel = intel;
    for (const l of this.list) {
      l.open = 0;
      l.opening = false;
      l.searched = false;
      l.hinge.rotation.y = 0;
    }
    // on the locker's floor (0.51 m up, over its plinth), towards the back
    const f = this.list[intel].front;
    this.folder.position.copyFrom(f.subtract(this.fwd.scale(0.6 + 0.28)));
    this.folder.position.y += FLOOR - 1.2 + 0.013;
    this.folder.rotation.y = Math.atan2(this.fwd.x, this.fwd.z) + 0.2;
    this.folder.setEnabled(true);
  }

  /** back to a checkpoint: these lockers stand open (and the dossier's gone if its locker was opened) */
  restore(searched: boolean[]) {
    this.reset(this.intel);
    searched.forEach((s, i) => {
      if (!s) return;
      const l = this.list[i];
      l.searched = true;
      l.open = 1;
      l.hinge.rotation.y = l.dir * 1.85;
      if (i === this.intel) this.folder.setEnabled(false);
    });
  }

  /** the unsearched locker you're at and facing (within reach), or -1 */
  facing(eye: Vector3, dir: Vector3) {
    let best = -1, bestD = Infinity;
    this.list.forEach((l, i) => {
      if (l.searched) return;
      const to = l.front.subtract(this.fwd.scale(0.6)).subtract(eye);
      const d = Math.hypot(to.x, to.z);
      if (d > 2.5 || Math.abs(eye.y - l.front.y - 0.4) > 1.4) return;
      // in front of it, looking at it
      if (Vector3.Dot(to.normalizeToNew(), dir) < 0.55 || Vector3.Dot(eye.subtract(l.front), this.fwd) < -0.3) return;
      if (d < bestD) (bestD = d), (best = i);
    });
    return best;
  }

  /** open locker `i`; true if it held the dossier (it's taken) */
  search(i: number) {
    const l = this.list[i];
    l.searched = true;
    l.opening = true;
    return i === this.intel;
  }

  /** the folder's gone from the shelf (picked up a moment after the door opens) */
  takeIntel() {
    this.folder.setEnabled(false);
  }

  get searchedCount() {
    return this.list.filter((l) => l.searched).length;
  }

  update(dt: number) {
    for (const l of this.list) {
      if (!l.opening || l.open >= 1) continue;
      l.open = Math.min(1, l.open + dt * 2.2);
      const e = 1 - Math.pow(1 - l.open, 3);
      l.hinge.rotation.y = l.dir * e * 1.85;
    }
  }

  /** the row's middle at chest height (the objective marker) */
  get marker() {
    const a = this.list[0].front, b = this.list[this.list.length - 1].front;
    return a.add(b).scale(0.5).subtract(this.fwd.scale(0.4));
  }
}
