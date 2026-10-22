import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import HavokPhysics from "@babylonjs/havok";
import havokWasmUrl from "@babylonjs/havok/lib/esm/HavokPhysics.wasm?url";
import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
import { PhysicsMotionType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PhysicsShapeBox, PhysicsShapeContainer, PhysicsShapeMesh } from "@babylonjs/core/Physics/v2/physicsShape";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { PhysicsEngine } from "@babylonjs/core/Physics/v2/physicsEngine";
import { COLLIDE } from "./CollisionGroups";

/**
 * Havok (Physics V2) for the things that should tumble: ragdolls and dropped
 * rifles. The level's box colliders become one static compound body.
 *
 * The engine is stepped from the game's own simulation step (fixed, pausable,
 * slow-motion aware) instead of the render loop, so physics and gameplay
 * never drift apart. If the WASM can't load, `ready` stays false and callers
 * fall back to the procedural death fall.
 */
export class PhysicsService {
  ready = false;
  plugin: HavokPlugin | null = null;
  private engine: PhysicsEngine | null = null;
  private levelBody: PhysicsBody | null = null;
  /** dynamic bodies alive right now (for the debug overlay) */
  activeBodies = 0;

  constructor(private scene: Scene) {}

  async init() {
    try {
      const wasm = await (await fetch(havokWasmUrl)).arrayBuffer();
      const hk = await HavokPhysics({ wasmBinary: wasm } as never);
      this.plugin = new HavokPlugin(true, hk);
      this.scene.enablePhysics(new Vector3(0, -9.81, 0), this.plugin);
      this.engine = this.scene.getPhysicsEngine() as unknown as PhysicsEngine;
      if (!this.engine) throw new Error("physics engine not created");
      // we step it ourselves (see step())
      this.scene.physicsEnabled = false;
      this.ready = true;
    } catch (e) {
      console.warn("Havok unavailable — ragdolls fall back to the procedural death", e);
      this.ready = false;
    }
    return this.ready;
  }

  /** Static compound of every solid level collider box (walls, floors, crates, stairs). */
  buildLevel(colliders: Mesh[]) {
    if (!this.ready) return;
    const node = new TransformNode("levelPhysics", this.scene);
    const container = new PhysicsShapeContainer(this.scene);
    const q = new Quaternion();
    let n = 0;
    for (const c of colliders) {
      if (!c.checkCollisions) continue;
      c.computeWorldMatrix(true);
      // a terrain (not a box): its own triangles
      if (c.metadata?.meshShape) {
        container.addChild(new PhysicsShapeMesh(c, this.scene), Vector3.Zero(), Quaternion.Identity());
        n++;
        continue;
      }
      const ext = c.getBoundingInfo().boundingBox.extendSize.scale(2);
      const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), ext, this.scene);
      Quaternion.FromEulerAnglesToRef(c.rotation.x, c.rotation.y, c.rotation.z, q);
      container.addChild(box, c.position.clone(), q.clone());
      n++;
    }
    container.filterMembershipMask = COLLIDE.level.membership;
    container.filterCollideMask = COLLIDE.level.collideWith;
    container.material = { friction: 0.85, restitution: 0.05 };
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = container;
    this.levelBody = body;
    return n;
  }

  /**
   * Static level from triangle meshes (the voxel-built stage's collision chunks): one mesh shape per
   * chunk. Building a compound of ~30k boxes took ~37 s; mesh shapes take well under a second.
   */
  buildLevelMeshes(meshes: Mesh[], physicsOnly: Mesh[] = []) {
    if (!this.ready) return;
    const node = new TransformNode("levelPhysics", this.scene);
    const container = new PhysicsShapeContainer(this.scene);
    let n = 0;
    for (const m of [...meshes, ...physicsOnly]) {
      if (!physicsOnly.includes(m) && (!m.checkCollisions || !m.isPickable)) continue;
      if (m.getTotalIndices() === 0) continue;
      const shape = new PhysicsShapeMesh(m, this.scene);
      container.addChild(shape, Vector3.Zero(), Quaternion.Identity());
      n++;
    }
    container.filterMembershipMask = COLLIDE.level.membership;
    container.filterCollideMask = COLLIDE.level.collideWith;
    container.material = { friction: 0.85, restitution: 0.05 };
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = container;
    this.levelBody = body;
    return n;
  }

  /** Static level from axis-aligned boxes (voxel-built stages): min/max per box, flags & 2 = solid. */
  buildLevelBoxes(boxes: Float32Array, flags: Uint8Array) {
    if (!this.ready) return;
    const node = new TransformNode("levelPhysics", this.scene);
    const container = new PhysicsShapeContainer(this.scene);
    const id = Quaternion.Identity();
    let n = 0;
    for (let i = 0; i < flags.length; i++) {
      if (!(flags[i] & 2)) continue;
      const b = i * 6;
      const ext = new Vector3(boxes[b + 3] - boxes[b], boxes[b + 4] - boxes[b + 1], boxes[b + 5] - boxes[b + 2]);
      // tiny clutter doesn't matter to a falling body
      if (ext.x * ext.y * ext.z < 0.004 && Math.max(ext.x, ext.y, ext.z) < 0.4) continue;
      const box = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), ext, this.scene);
      container.addChild(box, new Vector3((boxes[b] + boxes[b + 3]) / 2, (boxes[b + 1] + boxes[b + 4]) / 2, (boxes[b + 2] + boxes[b + 5]) / 2), id);
      n++;
    }
    container.filterMembershipMask = COLLIDE.level.membership;
    container.filterCollideMask = COLLIDE.level.collideWith;
    container.material = { friction: 0.85, restitution: 0.05 };
    const body = new PhysicsBody(node, PhysicsMotionType.STATIC, false, this.scene);
    body.shape = container;
    this.levelBody = body;
    return n;
  }

  /** Advance the simulation (called from Game.step with the gameplay dt). */
  step(dt: number) {
    if (!this.ready || !this.engine || dt <= 0) return;
    // two substeps keep fast-falling limbs from tunnelling through thin walls
    const h = Math.min(dt, 1 / 20) / 2;
    (this.engine as unknown as { _step(d: number): void })._step(h);
    (this.engine as unknown as { _step(d: number): void })._step(h);
  }

  dispose() {
    this.levelBody?.dispose();
  }
}
