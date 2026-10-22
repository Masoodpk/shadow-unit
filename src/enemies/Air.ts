import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Node } from "@babylonjs/core/node";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { AudioEngine } from "../audio/AudioEngine";
import { BodyZone, HitKind } from "../config/game";
import { NavGraph } from "../level/NavGraph";
import { SpriteStream } from "../fx/SuperFx";
import { extFor } from "../weapons/ArmsRig";
import type { Combatant } from "./Hulk";
import gunshipUrl from "../assets/characters/heli_gunship.glb?url";
import mi28Url from "../assets/characters/heli_mi28.glb?url";
import f15Url from "../assets/characters/jet_f15.glb?url";
import yf23Url from "../assets/characters/jet_yf23.glb?url";
import f50Url from "../assets/characters/jet_f50.glb?url";
import b2Url from "../assets/characters/jet_b2.glb?url";

/**
 * THE AIR WAR over Red Dune: once the Hulk has landed, the sky is the other side's too.
 *
 *  - two gunships ("Helicopter Gunship" by DavidFischer, CC BY 4.0; "Mil Mi-28NM Havoc" by VTX,
 *    CC BY-NC-SA 4.0) hold off 35–50 m out and 18–28 m up, circling, nose on whoever they're after:
 *    chain-gun bursts, rocket pairs;
 *  - jets on strafing runs ("F-15 free rig" by ARAZ BASIC; "rigged Northrop YF-23" by
 *    metlocaypsecrasy; "Viettel F50 Red Eagle" by thientrung2004pr; CC BY 4.0): in fast and low,
 *    two missiles and the cannon, up and away, and round for another pass;
 *  - a bomber ("b-2 spirit" by Kevin Love, CC BY 4.0): one run straight over the fight, a stick
 *    of bombs walking across the ground.
 *
 * Bullets, rockets and the heroes all hurt them: a gunship breaks up, burning, and spins down; a
 * jet falls out of the sky trailing smoke and hits the ground in a fireball. Superman can take a
 * jet apart with his hands (it splits in two — `rip`), Iron Man shoots them down.
 */

export interface AirHost {
  scene: Scene;
  nav: NavGraph;
  audio: AudioEngine;
  player: Combatant & { camera: { position: Vector3 } };
  /** the heroes, alive (they're targets too) */
  allies: () => Combatant[];
  /** a blast from the air: it hurts you and the heroes (not their own side) */
  blast: (pos: Vector3, radius: number, damage: number) => void;
  tracer: (from: Vector3, to: Vector3) => void;
  /** a big fireball (a wreck coming down, a jet torn apart) */
  fireball: (pos: Vector3, power: number) => void;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

type Kind = "heli" | "jet" | "bomber";
interface Spec {
  url: string;
  kind: Kind;
  label: string;
  /** the nose: which axis of the model, which way */
  nose: "+z" | "-z" | "-x";
  length: number;
  health: number;
  /** only these parts (by centre, in model units) — one of several airframes in the file */
  keep?: (c: Vector3) => boolean;
  /** rotor parts: spun about their own centres (model units) */
  rotor?: (c: Vector3, e: Vector3) => boolean;
}
const SPECS: Spec[] = [
  { url: gunshipUrl, kind: "heli", label: "HELI", nose: "+z", length: 13, health: 900, rotor: (c, e) => Math.abs(Math.abs(c.x) - 2.4) < 0.3 && c.y > 1.6 && e.y < 0.35 },
  { url: mi28Url, kind: "heli", label: "HAVOC", nose: "+z", length: 17, health: 1100, rotor: (c, e) => c.y > 1.8 && e.y < 0.2 && e.x > 5 },
  { url: f15Url, kind: "jet", label: "F-15", nose: "-z", length: 19.4, health: 600 },
  { url: yf23Url, kind: "jet", label: "YF-23", nose: "-x", length: 20.5, health: 600 },
  { url: f50Url, kind: "jet", label: "F-50", nose: "+z", length: 18, health: 600, keep: (c) => Math.abs(c.x) < 30 },
  { url: b2Url, kind: "bomber", label: "B-2", nose: "+z", length: 21, health: 2200 },
];

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const flat = (v: Vector3) => new Vector3(v.x, 0, v.z);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** a loaded airframe: its parts under one node, nose along +Z, centred, to scale */
class Airframe {
  private constructor(readonly spec: Spec, readonly c: AssetContainer) {}
  static async load(scene: Scene, spec: Spec) {
    const c = await LoadAssetContainerAsync(spec.url, scene, { pluginExtension: extFor(spec.url) });
    for (const g of c.animationGroups) g.stop();
    for (const m of c.materials)
      if (m instanceof PBRMaterial) {
        m.maxSimultaneousLights = 4;
        m.environmentIntensity = 1.2;
      }
    return new Airframe(spec, c);
  }
  /** a copy in the scene: { root (the anchor), parts, rotors } */
  build(scene: Scene, tag: string) {
    const inst = this.c.instantiateModelsToScene((n) => `${n}#${tag}`, false, { doNotInstantiate: true });
    const anchor = new TransformNode("air_" + tag, scene);
    anchor.rotationQuaternion = new Quaternion();
    const model = new TransformNode("airModel_" + tag, scene);
    model.parent = anchor;
    const turn = this.spec.nose === "-z" ? Math.PI : this.spec.nose === "-x" ? Math.PI / 2 : 0;
    model.rotation.y = turn;
    for (const r of inst.rootNodes) r.parent = model;
    model.computeWorldMatrix(true);
    const meshes: AbstractMesh[] = [];
    for (const r of inst.rootNodes) for (const m of r.getChildMeshes(false)) if (m.getTotalVertices() > 0) meshes.push(m);
    // each part's centre and extent in the file's own axes and units (the model turned back)
    const inv = model.getWorldMatrix().clone().invert();
    const swap = Math.abs(Math.sin(turn)) > 0.5;
    const info = new Map<AbstractMesh, { c: Vector3; e: Vector3 }>();
    for (const m of meshes) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const e = bb.extendSizeWorld;
      info.set(m, { c: Vector3.TransformCoordinates(bb.centerWorld, inv), e: swap ? V(e.z, e.y, e.x) : e.clone() });
    }
    const parts: AbstractMesh[] = [];
    // (in flight: the landing gear's up — the parts named for it, down, are hidden)
    const gear = (m: AbstractMesh) => {
      for (let n: Node | null = m; n; n = n.parent) if (/landingOn|^lg |gear|^wheel/i.test(n.name.replace(/#.*$/, ""))) return true;
      return false;
    };
    for (const m of meshes) {
      if ((this.spec.keep && !this.spec.keep(info.get(m)!.c)) || (this.spec.kind !== "heli" && gear(m))) m.setEnabled(false);
      else parts.push(m);
    }
    let lo = V(Infinity, Infinity, Infinity), hi = V(-Infinity, -Infinity, -Infinity);
    for (const m of parts) {
      const bb = m.getBoundingInfo().boundingBox;
      lo = Vector3.Minimize(lo, bb.minimumWorld);
      hi = Vector3.Maximize(hi, bb.maximumWorld);
    }
    const k = this.spec.length / Math.max(1e-3, hi.z - lo.z);
    model.scaling.setAll(k);
    model.position.set(-((lo.x + hi.x) / 2) * k, -((lo.y + hi.y) / 2) * k, -((lo.z + hi.z) / 2) * k);
    model.computeWorldMatrix(true);
    for (const n of model.getDescendants(false)) (n as TransformNode).computeWorldMatrix?.(true);
    // rotors: a pivot at each one's centre, spun about the airframe's up
    const rotors: TransformNode[] = [];
    if (this.spec.rotor) {
      const groups: { at: Vector3; ms: AbstractMesh[] }[] = [];
      for (const m of parts) {
        const { c, e } = info.get(m)!;
        if (!this.spec.rotor(c, e)) continue;
        const near = groups.find((g) => Vector3.Distance(g.at, c) < 1.2);
        if (near) near.ms.push(m);
        else groups.push({ at: c, ms: [m] });
      }
      for (const g of groups) {
        let a = V(Infinity, Infinity, Infinity), b = V(-Infinity, -Infinity, -Infinity);
        for (const m of g.ms) {
          m.computeWorldMatrix(true);
          const bb = m.getBoundingInfo().boundingBox;
          a = Vector3.Minimize(a, bb.minimumWorld);
          b = Vector3.Maximize(b, bb.maximumWorld);
        }
        const pivot = new TransformNode("rotor_" + tag, scene);
        pivot.position.copyFrom(a.add(b).scale(0.5));
        pivot.rotationQuaternion = new Quaternion();
        pivot.setParent(anchor);
        for (const m of g.ms) m.setParent(pivot);
        rotors.push(pivot);
      }
    }
    for (const m of parts) {
      m.isPickable = false;
      m.receiveShadows = false;
      m.alwaysSelectAsActiveMesh = true;
    }
    return { anchor, parts, rotors, size: hi.subtract(lo).scale(k) };
  }
}

interface Shot {
  m: Mesh;
  p: Vector3;
  v: Vector3;
  life: number;
  homing: Combatant | null;
  bomb: boolean;
}

export class AirUnit {
  readonly position = V();
  readonly v = V();
  heading = 0;
  health: number;
  readonly maxHealth: number;
  alive = false;
  /** not flown by its pilot right now (Superman has hold of it) */
  scripted = false;
  readonly label: string;
  readonly kind: Kind;
  private anchor: TransformNode;
  private parts: AbstractMesh[];
  private rotors: TransformNode[];
  private hitbox: Mesh;
  private state: "off" | "in" | "fight" | "pass" | "leave" | "falling" | "wreck" = "off";
  private t = 0;
  private fireT = 2;
  private rocketT = 5;
  private target: Combatant | null = null;
  private orbit = Math.random() * 6.28;
  private passes = 0;
  private fired = false;
  private spin = 0;
  private bank = 0;
  private bombs = 0;
  private smokeT = 0;
  readonly size: Vector3;
  /** after `rip`: the two halves, flying apart */
  private halves: { node: TransformNode; v: Vector3; spin: Vector3 }[] = [];
  constructor(private air: AirForce, private host: AirHost, frame: Airframe, tag: string) {
    const b = frame.build(host.scene, tag);
    this.anchor = b.anchor;
    this.parts = b.parts;
    this.rotors = b.rotors;
    this.size = b.size;
    this.kind = frame.spec.kind;
    this.label = frame.spec.label;
    this.health = this.maxHealth = frame.spec.health;
    // one hit box round the airframe: your bullets find it
    this.hitbox = MeshBuilder.CreateBox("airHit_" + tag, { width: b.size.x * 0.75, height: Math.max(1.5, b.size.y * 0.8), depth: b.size.z * 0.85 }, host.scene);
    this.hitbox.isVisible = false;
    this.hitbox.isPickable = false;
    this.hitbox.parent = this.anchor;
    this.hitbox.metadata = { kind: HitKind.EnemyPart, enemy: this, zone: "torso" as BodyZone };
    this.anchor.setEnabled(false);
  }
  get flying() {
    return this.alive;
  }
  /** how close a bolt must pass to hit it (Iron Man's) */
  get hitR() {
    return Math.max(this.size.x, this.size.z) * 0.35;
  }
  get active() {
    return this.state !== "off";
  }

  /** in from far off, toward `at` */
  launch(at: Vector3) {
    const dir = V(Math.cos(this.orbit), 0, Math.sin(this.orbit));
    this.alive = true;
    this.health = this.maxHealth;
    this.scripted = false;
    this.passes = 0;
    this.halves = [];
    this.anchor.setEnabled(true);
    for (const p of this.parts) p.setEnabled(true);
    this.hitbox.isPickable = true;
    if (this.kind === "heli") {
      this.position.copyFrom(at.add(dir.scale(180))).addInPlaceFromFloats(0, 45, 0);
      this.state = "in";
    } else {
      const alt = this.kind === "bomber" ? 120 : 75;
      this.position.copyFrom(at.add(dir.scale(this.kind === "bomber" ? 700 : 900))).addInPlaceFromFloats(0, alt, 0);
      const to = flat(at.subtract(this.position)).normalize();
      this.v.copyFrom(to.scale(this.kind === "bomber" ? 85 : 150));
      this.heading = Math.atan2(to.x, to.z);
      this.state = "pass";
      this.fired = false;
      this.bombs = 0;
      this.host.audio.play("rocketWhoosh", { x: at.x, y: at.y + 30, z: at.z, volume: 0.9, rate: 0.5 });
    }
    this.t = 0;
  }

  // ------------------------------------------------------------------ the bullet target (EnemyHitTarget)
  applyHit(damage: number, _zone: BodyZone, _dir: Vector3, point: Vector3, info?: { kind: string; force?: number; source?: unknown }) {
    if (!this.alive) return false;
    const bullet = !info || info.kind === "bullet";
    this.health -= damage * (bullet ? 0.6 : 1);
    if (Math.random() < 0.3) this.host.audio.play("impactMetal", { x: point.x, y: point.y, z: point.z, volume: 0.5, rate: 0.8 });
    if (this.health <= 0) {
      this.shotDown();
      return true;
    }
    return false;
  }
  inBlast(pos: Vector3, radius: number) {
    return this.alive && Vector3.Distance(pos, this.position) < radius + Math.max(this.size.x, this.size.z) * 0.4;
  }
  /** hit: it's going down */
  shotDown() {
    if (!this.alive) return;
    this.alive = false;
    this.scripted = false;
    this.hitbox.isPickable = false;
    this.state = "falling";
    this.t = 0;
    this.host.fireball(this.position.clone(), this.kind === "heli" ? 0.9 : 1.2);
    this.host.audio.play("rocketBlast", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 1.2, rate: 0.7 });
    this.air.onDown(this);
  }
  /**
   * Torn in two (Superman): the airframe's parts split by the side they're on, the halves thrown
   * apart, burning, as it explodes.
   */
  rip(left: Vector3) {
    const L = new TransformNode("airHalfL", this.host.scene);
    const R = new TransformNode("airHalfR", this.host.scene);
    for (const n of [L, R]) {
      n.position.copyFrom(this.position);
      n.rotationQuaternion = this.anchor.rotationQuaternion!.clone();
    }
    this.anchor.computeWorldMatrix(true);
    const side = left.normalizeToNew();
    for (const p of this.parts) {
      const c = p.getBoundingInfo().boundingBox.centerWorld;
      p.setParent(Vector3.Dot(c.subtract(this.position), side) > 0 ? L : R);
    }
    for (const r of this.rotors) r.setParent(R);
    this.halves = [
      { node: L, v: side.scale(9).addInPlaceFromFloats(0, 3, 0).addInPlace(this.v.scale(0.2)), spin: V(rnd(-1, 1), rnd(-1, 1), rnd(1.5, 3)) },
      { node: R, v: side.scale(-9).addInPlaceFromFloats(0, 2, 0).addInPlace(this.v.scale(0.2)), spin: V(rnd(-1, 1), rnd(-1, 1), -rnd(1.5, 3)) },
    ];
    this.health = 0;
    this.shotDown();
    // (torn open: the fuel goes up in a string of blasts along the airframe)
    const f = this.anchor.getDirection(Vector3.Forward());
    for (const k of [-0.35, 0, 0.3]) this.host.fireball(this.position.add(f.scale(this.size.z * k)).addInPlaceFromFloats(0, Math.random(), 0), 1.4);
  }
  /** Superman's grip: it stops where he holds it, shaking */
  hold(at: Vector3, shake: number) {
    this.scripted = true;
    this.position.copyFrom(at).addInPlaceFromFloats((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    this.v.scaleInPlace(0.85);
  }

  update(dt: number) {
    if (this.state === "off") return;
    this.t += dt;
    if (this.alive && !this.scripted) {
      if (this.kind === "heli") this.flyHeli(dt);
      else this.flyJet(dt);
    } else if (!this.alive) this.fall(dt);
    // the airframe: placed, nose along its heading, banked into its turns
    if (this.halves.length === 0) {
      this.anchor.position.copyFrom(this.position);
      const pitch = this.kind === "heli" ? Math.min(0.25, flat(this.v).length() * 0.012) : -Math.atan2(this.v.y, Math.max(1, flat(this.v).length())) * 0.9;
      this.anchor.rotationQuaternion!.copyFrom(Quaternion.RotationYawPitchRoll(this.heading, pitch, this.bank + this.spin));
    }
    for (const r of this.rotors) r.rotationQuaternion!.multiplyInPlace(Quaternion.RotationAxis(Vector3.UpReadOnly, dt * (this.alive ? 32 : 10)));
    // smoke off a wreck (or a badly hurt gunship)
    this.smokeT -= dt;
    if (this.smokeT <= 0 && (!this.alive || this.health < this.maxHealth * 0.35)) {
      this.smokeT = 0.04;
      for (const h of this.halves.length ? this.halves.map((x) => x.node.position) : [this.position])
        this.air.smoke.emit(h.add(V(rnd(-0.6, 0.6), rnd(-0.3, 0.3), rnd(-0.6, 0.6))), V(rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1)), rnd(2, 3.5), rnd(0.7, 1.2), 3, !this.alive ? new Color3(0.25, 0.22, 0.2) : new Color3(0.4, 0.4, 0.42), new Color3(0.12, 0.12, 0.12), 0.8, 0.8, 0.6);
    }
  }

  /** whoever it's after: you mostly, the heroes too */
  private pickTarget() {
    const all = [this.host.player, ...this.host.allies()].filter((c) => c.alive);
    if (!all.length) return null;
    if (Math.random() < 0.55 && this.host.player.alive) return this.host.player;
    return all[Math.floor(Math.random() * all.length)];
  }

  /** home: the gunship turns away and climbs out (gone in a few seconds) */
  leave() {
    this.state = "leave";
    this.t = 0;
  }
  private flyHeli(dt: number) {
    if (this.state === "leave") {
      this.v.addInPlace(V(Math.sin(this.heading) * 30, 12, Math.cos(this.heading) * 30).subtract(this.v).scale(Math.min(1, dt)));
      this.position.addInPlace(this.v.scale(dt));
      if (this.t > 14) {
        this.state = "off";
        this.alive = false;
        this.anchor.setEnabled(false);
        this.hitbox.isPickable = false;
      }
      return;
    }
    if (!this.target?.alive || Math.random() < dt * 0.08) this.target = this.pickTarget();
    const tgt = this.target;
    const focus = tgt ? tgt.feet : this.host.player.feet;
    // a station off the target: circling slowly, high enough to see over the containers
    this.orbit += dt * 0.12;
    const r = this.state === "in" ? 42 : 40 + Math.sin(this.t * 0.3) * 8;
    const goal = focus.add(V(Math.cos(this.orbit) * r, 22 + Math.sin(this.t * 0.4) * 4, Math.sin(this.orbit) * r));
    const B = this.host.bounds;
    goal.x = Math.max(B.minX - 10, Math.min(B.maxX + 10, goal.x));
    goal.z = Math.max(B.minZ - 10, Math.min(B.maxZ + 10, goal.z));
    const to = goal.subtract(this.position);
    const want = to.scale(Math.min(18, to.length() * 0.8) / Math.max(1e-3, to.length()));
    this.v.addInPlace(want.subtract(this.v).scale(Math.min(1, dt * 1.5)));
    this.position.addInPlace(this.v.scale(dt));
    if (this.state === "in" && to.length() < 15) this.state = "fight";
    // nose on the target
    const look = flat(focus.subtract(this.position));
    const wantH = Math.atan2(look.x, look.z);
    const dh = Math.atan2(Math.sin(wantH - this.heading), Math.cos(wantH - this.heading));
    this.heading += Math.sign(dh) * Math.min(Math.abs(dh), dt * 1.2);
    this.bank = Math.max(-0.3, Math.min(0.3, -dh * 0.5));
    if (this.state !== "fight" || !tgt) return;
    const aimed = Math.abs(dh) < 0.35;
    // the chain gun: a burst of eight
    this.fireT -= dt;
    if (this.fireT <= 0 && aimed) {
      this.fireT = rnd(2, 3.2);
      this.burst(tgt, 8);
    }
    // a pair of rockets
    this.rocketT -= dt;
    if (this.rocketT <= 0 && aimed) {
      this.rocketT = rnd(6, 9);
      this.air.missile(this.nose(-1), tgt, false);
      this.air.after(0.22, () => this.alive && this.air.missile(this.nose(1), tgt, false));
    }
  }
  private nose(side = 0) {
    const f = V(Math.sin(this.heading), 0, Math.cos(this.heading));
    const r = V(f.z, 0, -f.x);
    return this.position.add(f.scale(this.size.z * 0.45)).addInPlace(r.scale(side * this.size.x * 0.2)).addInPlaceFromFloats(0, -this.size.y * 0.25, 0);
  }
  private burst(tgt: Combatant, n: number) {
    for (let i = 0; i < n; i++)
      this.air.after(i * 0.07, () => {
        if (!this.alive || !tgt.alive) return;
        const from = this.nose();
        const aim = tgt.feet.add(V(rnd(-1.6, 1.6), rnd(0.4, 1.6), rnd(-1.6, 1.6)));
        const hit = Vector3.Distance(aim, tgt.feet.add(V(0, 1, 0))) < 1.1 && this.host.nav.clear(from, tgt.feet.add(V(0, 1.2, 0)));
        this.host.tracer(from, hit ? tgt.feet.add(V(0, 1, 0)) : aim);
        this.host.audio.play("enemyShot", { x: from.x, y: from.y, z: from.z, volume: 0.9, rate: 0.75 });
        if (hit) tgt.takeDamage(tgt === this.host.player ? 3 : 7, from);
      });
  }

  private flyJet(dt: number) {
    const tgtPoint = (this.target ?? (this.target = this.pickTarget()))?.feet ?? this.host.player.feet;
    const to = tgtPoint.subtract(this.position);
    const dH = flat(to).length();
    if (this.state === "pass") {
      if (this.kind === "bomber") {
        // level, high, straight over: the bombs walk across the fight
        this.v.y += (120 + tgtPoint.y - this.position.y) * dt * 0.5 - this.v.y * dt;
        if (dH < 90 && this.bombs < 10 && this.t > 0.3 + this.bombs * 0.35) {
          this.bombs++;
          this.air.bomb(this.position.add(V(0, -3, 0)), this.v.clone());
        }
      } else {
        // in fast and low on the target, missiles at 350 m, the cannon, then up and away
        const ahead = Vector3.Dot(flat(to), flat(this.v)) > 0;
        const alt = ahead && dH < 600 ? 26 : 75;
        this.v.y += (tgtPoint.y + alt - this.position.y) * dt * 0.8 - this.v.y * dt * 1.2;
        if (ahead && dH < 380 && !this.fired && this.target) {
          this.fired = true;
          this.air.missile(this.nose(-1), this.target, true);
          this.air.missile(this.nose(1), this.target, true);
          this.burst(this.target, 10);
          this.host.audio.play("rocketMotor", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 1, rate: 1.3 });
        }
        // steer at it on the way in (no turning back once past)
        if (ahead) {
          const want = Math.atan2(to.x, to.z);
          const d = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
          this.heading += Math.sign(d) * Math.min(Math.abs(d), dt * 0.35);
          this.bank = -d * 1.2;
        } else this.bank *= 0.95;
        const sp = flat(this.v).length();
        this.v.x = Math.sin(this.heading) * sp;
        this.v.z = Math.cos(this.heading) * sp;
      }
      // the roar as it goes over
      if (dH < 120 && !this.roared) {
        this.roared = true;
        this.host.audio.play("rocketWhoosh", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 1.4, rate: 0.45 });
        this.host.audio.play("sonicBoom", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 0.5, rate: 1.4 });
      }
      this.position.addInPlace(this.v.scale(dt));
      // far past: round again (from somewhere else), three passes, then home
      if (Vector3.Dot(flat(to), flat(this.v)) < 0 && dH > 800) {
        this.passes++;
        if (this.passes >= (this.kind === "bomber" ? 1 : 3)) {
          this.state = "off";
          this.alive = false;
          this.anchor.setEnabled(false);
          this.hitbox.isPickable = false;
          this.air.onGone(this);
          return;
        }
        this.orbit += rnd(1.2, 2.4);
        this.target = this.pickTarget();
        this.roared = false;
        this.launch(this.target?.feet ?? this.host.player.feet);
      }
    }
  }
  private roared = false;

  private fall(dt: number) {
    if (this.state === "wreck") {
      if (this.t > 10) {
        this.state = "off";
        this.anchor.setEnabled(false);
        for (const h of this.halves) h.node.dispose(false, true);
        this.halves = [];
      }
      return;
    }
    const nav = this.host.nav;
    const hit = (p: Vector3) => {
      const fy = nav.floorAt(p.x, p.y + 1, p.z, 3);
      return fy !== null && p.y <= fy + 1;
    };
    if (this.halves.length) {
      let down = 0;
      for (const h of this.halves) {
        h.v.y -= 18 * dt;
        h.node.position.addInPlace(h.v.scale(dt));
        h.node.rotationQuaternion!.multiplyInPlace(Quaternion.RotationYawPitchRoll(h.spin.y * dt, h.spin.x * dt, h.spin.z * dt));
        if (hit(h.node.position) || h.node.position.y < -30) {
          if (h.v.y < -1) {
            this.host.fireball(h.node.position.clone(), 1.0);
            this.host.blast(h.node.position.clone(), 7, 30);
          }
          h.v.setAll(0);
          h.spin.setAll(0);
          down++;
        }
      }
      if (down === this.halves.length) {
        this.state = "wreck";
        this.t = 0;
      }
      return;
    }
    // the whole thing coming down: spinning (a gunship), nose-down (a jet)
    this.v.y -= 16 * dt;
    if (this.kind === "heli") {
      this.heading += dt * 4.5;
      this.v.x *= Math.exp(-dt * 0.8);
      this.v.z *= Math.exp(-dt * 0.8);
    } else this.spin += dt * 2.5;
    this.position.addInPlace(this.v.scale(dt));
    if (hit(this.position) || this.position.y < -30) {
      this.host.fireball(this.position.clone(), 1.5);
      this.host.blast(this.position.clone(), 9, 45);
      this.host.audio.play("rocketBlast", { x: this.position.x, y: this.position.y, z: this.position.z, volume: 1.4, rate: 0.6 });
      this.state = "wreck";
      this.t = 0;
      this.v.setAll(0);
      // jets go to pieces on the ground; a gunship's wreck stays a while, burning
      if (this.kind !== "heli") this.anchor.setEnabled(false);
    }
  }
  reset() {
    this.state = "off";
    this.alive = false;
    this.scripted = false;
    this.anchor.setEnabled(false);
    this.hitbox.isPickable = false;
    for (const h of this.halves) h.node.dispose(false, true);
    this.halves = [];
  }
}

/** the air war's director: who's up, when the next one comes, the missiles and bombs in flight */
export class AirForce {
  readonly list: AirUnit[] = [];
  readonly smoke: SpriteStream;
  private fire: SpriteStream;
  private shots: Shot[] = [];
  private on = false;
  private t = 0;
  private nextJet = 25;
  private jetIdx = 0;
  private bomberDone = false;
  private heliWave = 0;
  private constructor(private host: AirHost, frames: Airframe[]) {
    frames.forEach((f, i) => this.list.push(new AirUnit(this, host, f, "air" + i)));
    this.smoke = new SpriteStream(host.scene, "airSmoke", 400, false);
    this.fire = new SpriteStream(host.scene, "airFire", 200, true);
    const mm = new StandardMaterial("missileMat", host.scene);
    mm.diffuseColor = new Color3(0.75, 0.76, 0.78);
    for (let i = 0; i < 16; i++) {
      const m = MeshBuilder.CreateCylinder("missile" + i, { height: 1.6, diameter: 0.18, tessellation: 8 }, host.scene);
      m.material = mm;
      m.rotationQuaternion = new Quaternion();
      m.isPickable = false;
      m.setEnabled(false);
      this.shots.push({ m, p: V(), v: V(), life: 0, homing: null, bomb: false });
    }
  }
  static async load(host: AirHost) {
    const frames = await Promise.all(SPECS.map((s) => Airframe.load(host.scene, s).catch((e) => (console.warn("aircraft failed to load", s.label, e), null))));
    return new AirForce(host, frames.filter((f): f is Airframe => !!f));
  }
  get helis() {
    return this.list.filter((u) => u.kind === "heli");
  }
  /** anything up and fighting */
  get up() {
    return this.list.filter((u) => u.alive);
  }
  /** the fight's begun: the gunships come in now, the jets on a clock */
  start() {
    if (this.on) return;
    this.on = true;
    this.t = 0;
    this.nextJet = 22;
    this.heliWave = 1;
    this.helis.forEach((h, i) => this.after(i * 9, () => this.on && h.launch(this.host.player.feet)));
  }
  /** it's over (the foes are down): whatever's still up turns for home */
  stop() {
    if (!this.on) return;
    this.on = false;
    for (const u of this.list) if (u.alive && u.kind === "heli") u.leave();
  }
  /** things to do a little later (game time: pauses and slow motion hold them too) */
  private later: { t: number; fn: () => void }[] = [];
  after(sec: number, fn: () => void) {
    this.later.push({ t: sec, fn });
  }
  onDown(u: AirUnit) {
    void u;
  }
  onGone(u: AirUnit) {
    void u;
  }
  update(dt: number) {
    for (const l of [...this.later]) {
      l.t -= dt;
      if (l.t <= 0) {
        this.later.splice(this.later.indexOf(l), 1);
        l.fn();
      }
    }
    if (this.on) {
      this.t += dt;
      // a jet every 25–35 s (the three in turn); the bomber once, after a minute and a half
      this.nextJet -= dt;
      const jets = this.list.filter((u) => u.kind === "jet");
      if (this.nextJet <= 0 && jets.length) {
        this.nextJet = rnd(25, 35);
        const j = jets[this.jetIdx++ % jets.length];
        if (!j.active) j.launch(this.host.player.feet);
      }
      if (!this.bomberDone && this.t > 90) {
        this.bomberDone = true;
        this.list.find((u) => u.kind === "bomber")?.launch(this.host.player.feet);
      }
      // gunships shot down come back once, a minute later
      if (this.heliWave === 1 && this.helis.length && this.helis.every((h) => !h.alive && !h.active) ) {
        this.heliWave = 2;
        this.after(60, () => this.on && this.helis.forEach((h, i) => this.after(i * 6, () => this.on && h.launch(this.host.player.feet))));
      }
    }
    for (const u of this.list) u.update(dt);
    this.flyShots(dt);
    this.smoke.update(dt);
    this.fire.update(dt);
  }
  /** a missile (homing, from a jet) or a rocket (straighter, from a gunship) at `tgt` */
  missile(from: Vector3, tgt: Combatant, homing: boolean) {
    const s = this.shots.find((x) => x.life <= 0);
    if (!s) return;
    s.p.copyFrom(from);
    const aim = tgt.feet.add(V(0, 0.8, 0)).subtract(from).normalize();
    s.v.copyFrom(aim.scale(homing ? 95 : 70));
    s.life = 6;
    s.homing = homing ? tgt : null;
    s.bomb = false;
    s.m.setEnabled(true);
    this.host.audio.play("rocketWhoosh", { x: from.x, y: from.y, z: from.z, volume: 0.8, rate: 1.2 });
  }
  bomb(from: Vector3, vel: Vector3) {
    const s = this.shots.find((x) => x.life <= 0);
    if (!s) return;
    s.p.copyFrom(from);
    s.v.copyFrom(vel).scaleInPlace(0.9);
    s.life = 12;
    s.homing = null;
    s.bomb = true;
    s.m.setEnabled(true);
  }
  private flyShots(dt: number) {
    const nav = this.host.nav;
    for (const s of this.shots) {
      if (s.life <= 0) continue;
      s.life -= dt;
      if (s.bomb) s.v.y -= 9.8 * dt;
      else if (s.homing?.alive) {
        // a gentle homing (it can be outrun)
        const want = s.homing.feet.add(V(0, 0.8, 0)).subtract(s.p).normalize().scale(s.v.length());
        s.v.addInPlace(want.subtract(s.v).scale(Math.min(1, dt * 1.6)));
      }
      const prev = s.p.clone();
      s.p.addInPlace(s.v.scale(dt));
      s.m.position.copyFrom(s.p);
      const d = s.v.normalizeToNew();
      const c = Vector3.Dot(Vector3.UpReadOnly, d);
      if (Math.abs(c) < 0.9999) Quaternion.RotationAxisToRef(Vector3.Cross(Vector3.UpReadOnly, d).normalize(), Math.acos(c), s.m.rotationQuaternion!);
      // the motor's flame and its smoke trail
      if (!s.bomb) {
        this.fire.emit(s.p.subtract(d.scale(0.9)), d.scale(-6), 0.08, 0.22, 1, new Color3(1, 0.85, 0.5), new Color3(1, 0.35, 0.05), 1, 2, 0);
        this.smoke.emit(s.p.subtract(d.scale(1)), V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), rnd(-0.3, 0.3)), rnd(1.4, 2.2), 0.35, 4, new Color3(0.85, 0.85, 0.85), new Color3(0.6, 0.6, 0.62), 0.55, 0.5, 0.4);
      }
      // into the ground, a wall, or right by someone
      const blocked = nav.rayLevel(prev, s.p) >= 0;
      const fy = nav.floorAt(s.p.x, s.p.y + 0.5, s.p.z, 2);
      const near = [this.host.player, ...this.host.allies()].some((t) => t.alive && Vector3.Distance(t.feet.add(V(0, 1, 0)), s.p) < 1.5);
      if (blocked || (fy !== null && s.p.y <= fy + 0.2) || near || s.life <= 0) {
        s.life = 0;
        s.m.setEnabled(false);
        this.host.blast(s.p.clone(), s.bomb ? 8 : 5, s.bomb ? 55 : 32);
      }
    }
  }
  reset() {
    this.on = false;
    this.later = [];
    this.bomberDone = false;
    this.heliWave = 0;
    for (const u of this.list) u.reset();
    for (const s of this.shots) {
      s.life = 0;
      s.m.setEnabled(false);
    }
    this.smoke.reset();
    this.fire.reset();
  }
}
