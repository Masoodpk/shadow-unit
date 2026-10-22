import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HitKind } from "../config/game";
import { NavGraph } from "./NavGraph";

/**
 * A locked steel double gate across a street (Sandstorm's west gate on the long road): two
 * painted sheet-steel leaves on ribbed frames, hinged on the street's walls, a chain and padlock
 * where they meet. Shut, it stops you, the soldiers, their routes (the nav links through it are
 * cut), bullets and sight; unlocked, the leaves swing back against the walls and all of that opens.
 */
export class Gate {
  /** movement colliders (the player's and the soldiers' collision sets) */
  readonly colliders: Mesh[] = [];
  readonly centre: Vector3;
  open = false;
  private leaves: TransformNode[] = [];
  private lock: Mesh[] = [];
  private swing = 0;
  private cut: [number, number][] = [];
  private x0: number;
  private x1: number;
  private y0: number;
  private y1: number;
  private z: number;

  /** spans x0 … x1 at z, standing on `floor` */
  constructor(scene: Scene, private nav: NavGraph, g: { z: number; x0: number; x1: number; floor: number; height: number }) {
    this.x0 = g.x0;
    this.x1 = g.x1;
    this.y0 = g.floor;
    this.y1 = g.floor + g.height;
    this.z = g.z;
    this.centre = new Vector3((g.x0 + g.x1) / 2, g.floor, g.z);
    const paint = new PBRMaterial("gatePaint", scene);
    paint.albedoColor = new Color3(0.2, 0.24, 0.2);
    paint.metallic = 0.55;
    paint.roughness = 0.62;
    paint.maxSimultaneousLights = 4;
    const frame = new PBRMaterial("gateFrame", scene);
    frame.albedoColor = new Color3(0.12, 0.13, 0.12);
    frame.metallic = 0.8;
    frame.roughness = 0.5;
    frame.maxSimultaneousLights = 4;
    const rust = new PBRMaterial("gateRust", scene);
    rust.albedoColor = new Color3(0.35, 0.17, 0.08);
    rust.metallic = 0.3;
    rust.roughness = 0.85;
    rust.maxSimultaneousLights = 4;
    const W = (g.x1 - g.x0) / 2 - 0.02, H = g.height;
    for (const side of [-1, 1]) {
      // a leaf hinged on its wall: x runs from the hinge (0) towards the middle (W)
      const hinge = new TransformNode("gateHinge", scene);
      hinge.position.set(side < 0 ? g.x0 : g.x1, g.floor, g.z);
      hinge.rotation.y = side < 0 ? 0 : Math.PI;
      const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: PBRMaterial) => {
        const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
        m.position.set(x, y, z);
        m.material = mat;
        return m;
      };
      const parts: Mesh[] = [];
      // the sheet, a little off the ground
      parts.push(box("gateSheet", W - 0.08, H - 0.16, 0.03, W / 2, H / 2 + 0.04, 0, paint));
      // frame: stiles, rails, a diagonal brace each side, vertical ribs on the sheet
      for (const x of [0.05, W - 0.05]) parts.push(box("gateStile", 0.1, H, 0.12, x, H / 2, 0, frame));
      for (const y of [0.1, H / 2, H - 0.06]) parts.push(box("gateRail", W, 0.1, 0.1, W / 2, y, 0, frame));
      for (let x = 0.45; x < W - 0.3; x += 0.42) for (const z of [-0.03, 0.03]) parts.push(box("gateRib", 0.05, H - 0.4, 0.03, x, H / 2, z, frame));
      const diag = Math.hypot(W, H / 2 - 0.1);
      for (const [y, z] of [[H * 0.25, -0.065], [H * 0.75, -0.065], [H * 0.25, 0.065], [H * 0.75, 0.065]]) {
        const b = box("gateBrace", diag, 0.08, 0.03, W / 2, y + 0.02, z, frame);
        b.rotation.z = Math.atan2(H / 2 - 0.1, W) * (y < H / 2 ? 1 : -1);
        parts.push(b);
      }
      // rust bleeding from the bolts along the bottom rail
      for (let x = 0.3; x < W - 0.2; x += 0.9) for (const z of [-0.018, 0.018]) parts.push(box("gateRust", 0.18, 0.5 + ((x * 7) % 0.4), 0.004, x, 0.38, z, rust));
      const leaf = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
      leaf.name = "gateLeaf";
      leaf.parent = hinge;
      leaf.isPickable = true;
      leaf.checkCollisions = true;
      leaf.metadata = { kind: HitKind.Level, surface: "metal" };
      this.colliders.push(leaf);
      this.leaves.push(hinge);
    }
    // chain and padlock where the leaves meet (both sides)
    const steel = new PBRMaterial("gateChain", scene);
    steel.albedoColor = new Color3(0.55, 0.56, 0.58);
    steel.metallic = 1;
    steel.roughness = 0.35;
    steel.maxSimultaneousLights = 4;
    const cx = this.centre.x;
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const link = MeshBuilder.CreateTorus("gateLink", { diameter: 0.07, thickness: 0.014, tessellation: 10 }, scene);
        link.position.set(cx - 0.12 + i * 0.06, g.floor + 1.18 - Math.sin((i / 4) * Math.PI) * 0.05, g.z + s * 0.08);
        link.rotation.set(Math.PI / 2, i % 2 ? Math.PI / 2 : 0, 0);
        link.material = steel;
        link.isPickable = false;
        this.lock.push(link);
      }
    }
    const body = MeshBuilder.CreateBox("padlock", { width: 0.07, height: 0.08, depth: 0.03 }, scene);
    body.position.set(cx, g.floor + 1.05, g.z + 0.11);
    body.material = steel;
    const shackle = MeshBuilder.CreateTorus("padlockShackle", { diameter: 0.05, thickness: 0.01, tessellation: 12 }, scene);
    shackle.position.set(cx, g.floor + 1.1, g.z + 0.11);
    shackle.rotation.x = Math.PI / 2;
    shackle.material = steel;
    this.lock.push(body, shackle);
    for (const m of this.lock) m.isPickable = false;
    this.close();
  }

  /** shut and locked (a new attempt) */
  close() {
    this.open = false;
    this.swing = 0;
    this.pose();
    for (const c of this.colliders) c.checkCollisions = true;
    for (const m of this.lock) m.setEnabled(true);
    // the routes through it go
    if (!this.cut.length)
      for (const n of this.nav.nodes)
        for (const l of n.links) {
          const m = this.nav.nodes[l];
          if (n.id < l && (n.p.z - this.z) * (m.p.z - this.z) < 0) {
            const t = (this.z - n.p.z) / (m.p.z - n.p.z);
            const x = n.p.x + (m.p.x - n.p.x) * t;
            if (x > this.x0 - 0.5 && x < this.x1 + 0.5) this.cut.push([n.id, l]);
          }
        }
    for (const [a, b] of this.cut) {
      const na = this.nav.nodes[a], nb = this.nav.nodes[b];
      na.links = na.links.filter((l) => l !== b);
      nb.links = nb.links.filter((l) => l !== a);
    }
  }

  /** unlocked: the chain drops and the leaves swing back (`now`: already open, a checkpoint past it) */
  unlock(now = false) {
    if (now) {
      this.swing = 1;
      this.pose();
    }
    if (this.open) return;
    this.open = true;
    for (const m of this.lock) m.setEnabled(false);
    for (const c of this.colliders) c.checkCollisions = false;
    for (const [a, b] of this.cut) this.nav.link(a, b);
  }

  update(dt: number) {
    if (!this.open || this.swing >= 1) return;
    // a heavy start, then it swings (pushed open away from you, towards the yard)
    this.swing = Math.min(1, this.swing + dt * 0.55);
    this.pose();
  }

  private pose() {
    const e = 1 - Math.pow(1 - this.swing, 3);
    this.leaves.forEach((h, i) => (h.rotation.y = (i === 0 ? 0 : Math.PI) + (i === 0 ? 1 : -1) * e * 1.52));
  }

  /** shut gates stop sight and bullets: distance along the ray, or -1 */
  blockRay(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) {
    if (this.open || Math.abs(dz) < 1e-6) return -1;
    const t = (this.z - oz) / dz;
    if (t < 0 || t > len) return -1;
    const x = ox + dx * t, y = oy + dy * t;
    return x > this.x0 && x < this.x1 && y > this.y0 && y < this.y1 ? t : -1;
  }
}
