import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import "./babylon";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Frustum } from "@babylonjs/core/Maths/math.frustum";
import { BoundingSphere } from "@babylonjs/core/Culling/boundingSphere";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AK47_ATLAS } from "../audio/samples";
import { PhysicsService } from "../physics/PhysicsService";
import { AudioEngine } from "../audio/AudioEngine";
import { ENEMY, PLAYER, RENDER } from "../config/game";
import { EnemyManager } from "../enemies/EnemyManager";
import { Effects } from "../fx/Effects";
import { LevelData, buildKestrelPoint } from "../level/KestrelPoint";
import { buildWhiteout, plantWhiteoutTrees } from "../level/Whiteout";
import { Snowfall } from "../fx/Snowfall";
import { buildOffice } from "../level/Office";
import { SANDSTORM, buildDust2, hostageSpot, DUST, LOCKER_D, LOCKER_W } from "../level/Dust2";
import { buildMetro } from "../level/Metro";
import { MetroMission } from "./MetroMission";
import { Gate } from "../level/Gate";
import { LockerModel } from "../level/Lockers";
import { Hulk, HulkModel, type Combatant, type Foe } from "../enemies/Hulk";
import { byId, heroes as rosterHeroes, villains as rosterVillains, type CharacterDef } from "../characters/roster";
import { ALL_KITS } from "../characters/allKits";
import { Wolverine, WolverineModel } from "../enemies/Wolverine";
import { Batman, BatmanModel } from "../enemies/Batman";
import { Superman, SupermanModel } from "../allies/Superman";
import { IceFx, ShockRing, SpriteStream } from "../fx/SuperFx";
import { Bolts, Lightning } from "../fx/HeroFx";
import { RosterHero, RosterModel, type RosterHost } from "../allies/RosterHero";
import { RosterVillain, type VillainHost } from "../enemies/RosterVillain";
import { hostile, setSide } from "../characters/factions";
import { TeamBoard as VillainBoard } from "../allies/Team";
import { AirForce } from "../enemies/Air";
import spideyRiggedUrl from "../assets/characters/spiderman_rigged.glb?url";
import { SpiderMan } from "../allies/SpiderMan";
import { IronMan } from "../allies/IronMan";
import { TeamBoard } from "../allies/Team";
import { Deadpool, DeadpoolModel } from "../allies/Deadpool";
import deadpoolUrl from "../assets/characters/deadpool2.glb?url";
import ironUrl from "../assets/characters/ironman_rigged.glb?url";
import { SkinnedModel, SkinnedRig } from "../allies/HeroRig";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Hostage, HostageModel } from "../level/Hostage";
import { Mission } from "./Mission";
import { TapeMission } from "./TapeMission";
import { StationModel } from "../level/PlaybackStation";
import { OFFICE_STATION } from "../level/Office";
import { Glass } from "../level/Glass";
import { Doors } from "../level/Doors";
import { Props } from "../level/Props";
import { PlayerController } from "../player/PlayerController";
import { Environment } from "../render/Environment";
import { Materials } from "../render/Materials";
import { DebugOverlay } from "../ui/DebugOverlay";
import { Hud } from "../ui/Hud";
import { WeaponManager } from "../weapons/WeaponManager";
import { SLOT_LABEL, SLOT_ORDER, WEAPONS, slotOf } from "../config/weapons";
import { buildArmsRig, loadArmsTemplate, loadGunContainer } from "../weapons/ArmsRig";
import { buildVectorRig, loadVectorContainer } from "../weapons/VectorRig";
import { buildGrenadeRig, loadFlashbangContainer } from "../weapons/GrenadeRig";
import { buildKnifeRigFP, loadKnifeFPContainer } from "../weapons/KnifeRigFP";
import { RocketBlast, Rockets } from "../fx/Rockets";
import { Detonation, Grenades } from "../fx/Grenades";
import { Explosions } from "../fx/Explosions";
import { Footprints } from "../fx/Footprints";
import { secureStart } from "../level/startSafety";
import { wallSpots } from "../level/Spots";
import { Pickup, Pickups } from "../level/Pickups";
import { loadGrenadeSet } from "../weapons/GrenadeModels";
import { GRENADE_TYPES, GrenadeType } from "../config/weapons";
import { SoldierSkins } from "../enemies/SoldierSkin";
import { Minimap } from "../ui/Minimap";
import { Ray } from "@babylonjs/core/Culling/ray";
import { HitKind } from "../config/game";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { GUNS } from "../config/guns";
import type { WeaponRig } from "../weapons/WeaponModels";
import type { WeaponId } from "../config/weapons";
import { Input } from "./Input";
import { StageId, stageInfo } from "../config/stages";
import { bindings } from "./Bindings";
import { DevMode } from "./DevMode";
import { CineDirector } from "../characters/cinematics";
import { Difficulty, difficulty } from "../config/difficulty";

export type GameState = "loading" | "ready" | "playing" | "paused" | "dead" | "won";

export interface GameSettings {
  stage: StageId;
  quality: "high" | "low";
  sensitivity: number;
  /** vertical field of view, degrees */
  fov?: number;
  /** master, ambience and music volume 0..1 */
  volume?: number;
  ambience?: number;
  music?: number;
  muted?: boolean;
  /** aim: toggle (click once) instead of hold */
  aimToggle?: boolean;
  devMode?: boolean;
}

export interface GameCallbacks {
  onStateChange(state: GameState, stats?: RoundStats): void;
  /** a setting was flipped from inside the game (hotkey) — keep menus in sync */
  onSettingChange?(key: "muted" | "devMode" | "god" | "arsenal", value: boolean): void;
}

export interface RoundStats {
  /** a mission's own result line ("MISSION COMPLETE" / "THE BOMBS WENT OFF") */
  title?: string;
  kicker?: string;
  time: number;
  /** hostiles on this stage */
  total: number;
  kills: number;
  headshots: number;
  accuracy: number;
  damageTaken: number;
}

const DEBUG_ENABLED = import.meta.env.DEV || import.meta.env.VITE_DEBUG_OVERLAY === "true";
const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Composition root: creates engine/scene and all systems once, then runs the
 * frame loop. Restart = reset every system in place (nothing is rebuilt).
 */
export class Game {
  engine!: Engine;
  scene!: Scene;
  input: Input;
  audio!: AudioEngine;
  state: GameState = "loading";
  private mats!: Materials;
  private env!: Environment;
  private level!: LevelData;
  physics!: PhysicsService;
  private player!: PlayerController;
  private fx!: Effects;
  private weapons!: WeaponManager;
  private enemies!: EnemyManager;
  /**
   * An ally's entrance (Spider-Man on his container, Iron Man out of the sky): letterboxed, your
   * view turns to follow them; the fight holds. When it ends, you're looking where it left you.
   */
  private allyCinematic(on: boolean, dt: number) {
    const hud = this.hulk?.hud;
    if (on && !this.allyCineOn) {
      hud?.letterbox(true, false);
      this.cineFov = this.player.camera.fov;
      this.weapons.viewmodel.base.setEnabled(false);
      this.cineCut = true;
    }
    if (!on && this.allyCineOn) {
      hud?.letterbox(false, false);
      this.player.yaw = this.player.camera.rotation.y;
      this.player.pitch = this.player.camera.rotation.x;
      if (this.cineFov > 0) this.player.camera.fov = this.cineFov;
      this.weapons.viewmodel.base.setEnabled(true);
      this.scene.activeCamera = this.player.camera;
    }
    this.allyCineOn = on;
    if (!on) return;
    const who = this.director.current()?.actor;
    if (!who) return;
    const who0 = () => (who as unknown as { feet?: Vector3 }).feet?.add(new Vector3(0, 1.2, 0)) ?? null;
    // (an entrance can be skipped: F or Space)
    if ((this.input.hit("use") || this.input.hit("jump")) && who.skip) {
      who.skip();
      return;
    }
    // a shot of their own (a drone above Spider-Man, the cuts of Iron Man's landing): the cinema camera
    const shot = who.cineShot();
    if (shot) {
      const cc = this.cineCamera();
      this.scene.activeCamera = cc;
      // (a spring arm: something between the subject and where the camera wants to be pulls it in)
      const nav = this.level.nav;
      const toCam = shot.pos.subtract(shot.target);
      const len = toCam.length();
      const block = len > 0.1 ? nav.rayLevel(shot.target, shot.pos) : -1;
      if (block >= 0) shot.pos = shot.target.add(toCam.scale(Math.max(0.6, block - 0.35) / len));
      // (and nobody standing in the way: the Hulk between the camera and the star of the shot puts
      // the camera in front of him)
      {
        const L = Vector3.Distance(shot.pos, shot.target);
        const dir = shot.pos.subtract(shot.target).scaleInPlace(1 / Math.max(L, 1e-3));
        let keep = L;
        const star = who0();
        for (const [c, r] of this.occluders()) {
          // (not the one being filmed)
          if (star && (c.x - star.x) ** 2 + (c.z - star.z) ** 2 < 0.5) continue;
          const t = Vector3.Dot(c.subtract(shot.target), dir);
          // (someone right at the lens counts too)
          if (t < 0.8 || t > keep + r) continue;
          const off = c.subtract(shot.target.add(dir.scale(t))).length();
          if (off < r) keep = Math.max(0.8, t - r - 0.2);
        }
        if (keep < L) shot.pos = shot.target.add(dir.scale(keep));
      }
      const cut = this.cineCut || ("cut" in shot && !!shot.cut);
      this.cineCut = false;
      const k = cut ? 1 : 1 - Math.exp(-5 * dt);
      Vector3.LerpToRef(cc.position, shot.pos, k, cc.position);
      this.cineLook = cut || !this.cineLook ? shot.target.clone() : Vector3.Lerp(this.cineLook, shot.target, 1 - Math.exp(-8 * dt));
      cc.setTarget(this.cineLook);
      cc.fov = cut ? shot.fov : cc.fov + (shot.fov - cc.fov) * (1 - Math.exp(-3 * dt));
      return;
    }
    const cam = this.player.camera;
    const at = (who.cineFocus ? who.cineFocus() : (who.position ?? cam.position).add(new Vector3(0, 1.2, 0))).subtract(cam.position);
    const yaw = Math.atan2(at.x, at.z), pitch = -Math.atan2(at.y, Math.hypot(at.x, at.z));
    let dy = yaw - cam.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const k = 1 - Math.exp(-4 * dt);
    cam.rotation.y += dy * k;
    cam.rotation.x += (Math.max(-1.2, Math.min(1.2, pitch)) - cam.rotation.x) * k;
    cam.rotation.z = 0;
    // zoomed in to frame them (about 4 m of picture wherever they are), never wider than your own view
    const dist = at.length();
    const fov = Math.max(0.22, Math.min(this.cineFov || cam.fov, 2 * Math.atan(2.4 / Math.max(1, dist))));
    cam.fov += (fov - cam.fov) * (1 - Math.exp(-2.5 * dt));
  }
  /** every entrance the game films, in priority order (roster characters register here too) */
  private director = (() => {
    const d = new CineDirector();
    d.register("superman", () => this.sm, 6);
    d.register("batman", () => this.bat, 5);
    d.register("wolverine", () => this.wolv, 4);
    d.register("deadpool", () => this.dp, 3);
    d.register("ironman", () => this.iron, 2);
    d.register("spiderman", () => this.spidey, 1);
    return d;
  })();
  /**
   * The characters are skinned, so their meshes are drawn every frame wherever they are (a skinned
   * mesh's bounds are its rest pose: Babylon can't cull it reliably). With a dozen heroes, seven
   * foes and the soldiers that's most of the frame. So each character is culled here, as a whole:
   * a sphere round him against the camera's view (and nothing past 160 m); outside it, his meshes
   * are left out of that camera's render by their layer mask — what they are and do is untouched.
   */
  private cullList: { meshes: AbstractMesh[] }[] = [];
  /**
   * The characters' materials frozen once they're ready: no per-draw re-check of their shader set-up
   * (their colours, a hit flash, a glow, still change — only what the shader is compiled for is fixed)
   */
  private freezeCharacterMaterials() {
    const seen = new Set<object>();
    for (const c of this.cullList)
      for (const m of c.meshes) {
        const mats = m.material && "subMaterials" in m.material ? ((m.material as unknown as { subMaterials: (import("@babylonjs/core/Materials/material").Material | null)[] }).subMaterials) : [m.material];
        for (const mt of mats) {
          if (!mt || seen.has(mt)) continue;
          seen.add(mt);
          mt.freeze();
        }
      }
  }
  private setupCulling() {
    if (!this.heroStage) return;
    SkinnedRig.viewer = () => this.scene.activeCamera?.globalPosition ?? null;
    const list: { meshes: AbstractMesh[]; at: () => Vector3; r: number; small?: AbstractMesh[]; key?: object }[] = [];
    const add = (meshes: AbstractMesh[] | undefined, at: () => Vector3, r: number, small?: AbstractMesh[], key?: object) => {
      if (meshes?.length) list.push({ meshes, at, r, small, key });
    };
    // (a soldier is eighteen parts: past 30 m the small ones — patches, pouches, gloves — aren't drawn)
    for (const e of this.enemies.enemies)
      if (e.skin) add([...e.skin.meshes, e.skin.gun], () => e.position, 1.8, e.skin.meshes.filter((m) => m.getTotalIndices() / 3 < 2500), e);
    // the soldiers on the same update-rate scale as the heroes (see lodStep)
    this.enemies.lodOf = (e) => {
      const cam = this.scene.activeCamera;
      if (!cam || this.allyCineOn) return 0;
      const d = Vector3.Distance(cam.globalPosition, e.position);
      // (on screen they move every frame — stepping them at 30 Hz against a 60 Hz picture read as a
      // shiver; only off screen, or a speck 90 m off, do they update less often — 40 m on the
      // Playground, where they share the frame with the whole cast)
      return !(this.onScreen.get(e) ?? true) ? 1 / 15 : d > (this.heroStage ? 40 : 90) ? 1 / 30 : 0;
    };
    for (const h of [...this.squad, ...this.villains]) add(h.rig.meshes, () => h.p, h.def.height + 1.5, undefined, h);
    if (this.spidey) add(this.spidey.rig.meshes, () => this.spidey!.p, 3, undefined, this.spidey);
    if (this.iron) add(this.iron.rig.meshes, () => this.iron!.p, 3, undefined, this.iron);
    if (this.dp) add([...this.dp.rig.meshes, ...this.dp.weaponMeshes], () => this.dp!.p, 3, undefined, this.dp);
    if (this.sm) add(this.sm.meshes, () => this.sm!.p, 3.5, undefined, this.sm);
    if (this.wolv) add(this.wolv.meshes, () => this.wolv!.position, 3, undefined, this.wolv);
    if (this.bat) add(this.bat.meshes, () => this.bat!.position, 3, undefined, this.bat);
    this.cullList = list;
    // (their bounds aren't used — they're always selected, culled here instead: don't keep them in sync)
    for (const c of list) for (const m of c.meshes) m.doNotSyncBoundingInfo = true;
    const sphere = new BoundingSphere(Vector3.Zero(), Vector3.Zero());
    const lo = new Vector3(), hi = new Vector3();
    const SHOW = 0x0fffffff, HIDE = 0x10000000;
    // shadows: the level and the props always; a character only within 15 m of you (a shadow 60 m
    // off is a pixel — and every caster is drawn again in the shadow pass, every frame)
    const sm = this.env.shadows.getShadowMap();
    const chars = new Set<AbstractMesh>(list.flatMap((c) => c.meshes));
    const statics = (sm?.renderList ?? []).filter((m) => !chars.has(m));
    let shadowTick = 0;
    this.scene.onBeforeRenderObservable.add(() => {
      if (!sm || ++shadowTick % 10) return;
      const me = this.player.feet;
      const near: AbstractMesh[] = [];
      // (a giant's shadow from further off: it's as big as he is)
      for (const c of list) if (Vector3.DistanceSquared(c.at(), me) < (13.5 + c.r) ** 2) for (const m of c.meshes) if (m.isEnabled() && m.isVisible) near.push(m);
      sm.renderList = statics.concat(near);
    });
    this.scene.onBeforeActiveMeshesEvaluationObservable.add(() => {
      const cam = this.scene.activeCamera;
      if (!cam) return;
      const planes = Frustum.GetPlanes(this.scene.getTransformMatrix());
      const cp = cam.globalPosition;
      for (const c of list) {
        const at = c.at();
        lo.set(at.x - c.r, at.y - 0.5, at.z - c.r);
        hi.set(at.x + c.r, at.y + c.r * 1.6, at.z + c.r);
        sphere.reConstruct(lo, hi);
        const d2 = Vector3.DistanceSquared(at, cp);
        const show = d2 < 160 * 160 && sphere.isInFrustum(planes);
        const mask = show ? SHOW : HIDE;
        if (c.key) this.onScreen.set(c.key, show);
        if (c.meshes[0].layerMask !== mask) for (const m of c.meshes) m.layerMask = mask;
        if (show && c.small) {
          const sm2 = d2 < 30 * 30 ? SHOW : HIDE;
          if (c.small[0] && c.small[0].layerMask !== sm2) for (const m of c.small) m.layerMask = sm2;
        }
      }
    });
  }
  /**
   * Update-rate level of detail: a character on screen within 15 m (or being filmed) thinks and moves
   * every frame; on screen 15–50 m, at 30 Hz; further, or off screen, at 15 Hz — handed the time it
   * skipped, so nothing runs slow, it only runs in fewer, bigger steps where you can't see it.
   */
  private lodAcc = new Map<object, number>();
  private onScreen = new Map<object, boolean>();
  private lodStep(key: object, at: Vector3, dt: number, fn: (dt: number) => void, filmed: boolean) {
    const cam = this.scene.activeCamera;
    let step = 0;
    if (!filmed && cam && this.heroStage && !this.allyCineOn) {
      const d = Vector3.Distance(cam.globalPosition, at);
      const seen = this.onScreen.get(key) ?? true;
      step = !seen || d > 50 ? 1 / 15 : d > 15 ? 1 / 30 : 0;
    }
    const acc = (this.lodAcc.get(key) ?? 0) + dt;
    if (acc < step - 1e-6) {
      this.lodAcc.set(key, acc);
      return;
    }
    this.lodAcc.set(key, 0);
    fn(Math.min(acc, 1 / 12));
  }
  /** big bodies a cinematic camera mustn't sit behind: the heroes and foes (chest centre, radius) */
  private occluders(): [Vector3, number][] {
    const out: [Vector3, number][] = [];
    if (this.hulk && this.hulk.state !== "dormant") out.push([this.hulk.position.add(new Vector3(0, 1.6, 0)), 1.5]);
    // (each as big as they are: Godzilla in the way is a wall, not a man)
    for (const x of [...this.squad, ...this.villains]) if (x.active) out.push([x.p.add(new Vector3(0, x.def.height * 0.6, 0)), Math.max(0.6, x.def.height * 0.3)]);
    for (const f of [this.wolv, this.bat]) if (f && f.state !== "dormant") out.push([f.position.add(new Vector3(0, 1.2, 0)), 0.6]);
    return out;
  }
  private cineFov = 0;
  private cineCut = false;
  private cineLook: Vector3 | null = null;
  private cineCam?: UniversalCamera;
  /** the camera the entrances are shot with (the game's post-processing on it too) */
  private cineCamera() {
    if (!this.cineCam) {
      const cc = (this.cineCam = new UniversalCamera("cineCam", this.player.camera.position.clone(), this.scene));
      cc.minZ = 0.05;
      cc.maxZ = 3000;
      cc.inputs.clear();
      const pm = this.scene.postProcessRenderPipelineManager;
      for (const p of pm.supportedPipelines) pm.attachCamerasToRenderPipeline(p.name, cc);
    }
    return this.cineCam;
  }

  /** where Spider-Man starts: beside you, on the nav node nearest a couple of metres to your right */
  /** the stage the super-powered fight plays on (the Heroes Playground; Red Dune is soldiers only again) */
  private get heroStage() {
    return this.settings.stage === "whiteout";
  }
  /** the stage's own soldiers (not the reinforcements held back for the heroes' arrivals) */
  private baseSoldiers() {
    return this.level.enemySpawns.filter((s) => s.group !== "reinforce").length;
  }
  /** reinforcements: queued as each hero turns up, then in one at a time */
  private reinforceQ = 0;
  private reinforceT = 0;
  private heroesIn = new Set<object>();
  private reinforcements(dt: number) {
    for (const h of this.heroesUp()) {
      if (this.heroesIn.has(h)) continue;
      this.heroesIn.add(h);
      this.reinforceQ += 3;
    }
    if (this.reinforceQ <= 0) return;
    this.reinforceT -= dt;
    if (this.reinforceT > 0) return;
    this.reinforceT = 2.6;
    const e = this.enemies.enemies.find((x) => x.dormant && x.spawn.group === "reinforce");
    if (!e) {
      this.reinforceQ = 0;
      return;
    }
    // somewhere on the ground 26–60 m off, out of your sight if there's such a place
    const nav = this.level.nav;
    const me = this.player.feet, eye = this.player.camera.position;
    let best: Vector3 | null = null, bs = -Infinity;
    for (let k = 0; k < 40; k++) {
      const n = nav.nodes[Math.floor(Math.random() * nav.nodes.length)];
      const d = Vector3.Distance(n.p, me);
      if (d < 26 || d > 60 || Math.abs(n.p.y - me.y) > 1.5) continue;
      if (nav.embedded(n.p.x, n.p.y + 1, n.p.z)) continue;
      const s = (nav.clear(eye, n.p.add(new Vector3(0, 1.4, 0))) ? 0 : 10) - Math.abs(d - 38) * 0.1 + Math.random();
      if (s > bs) (bs = s), (best = n.p.clone());
    }
    if (!best) return;
    this.reinforceQ--;
    e.wake(best, Math.atan2(me.x - best.x, me.z - best.z));
    e.engage();
    this.stats.total++;
  }
  /**
   * Everyone on one side in at once, straight onto the field (their entrances skipped — with the
   * whole line-up arriving, nobody would see them anyway): the heroes, or the villains with Thanos.
   */
  private launchAll(side: "heroes" | "villains") {
    if (this.allyCineOn || this.hulk?.cinematic) {
      // (finish whatever's being filmed first)
      this.director.current()?.actor.skip?.();
    }
    let n = 0;
    const go = (ok: boolean, a: { skip?(): void } | null | undefined) => {
      if (!ok) return;
      n++;
      a?.skip?.();
    };
    if (side === "heroes") {
      // (the Hulk's landing has no skip: he comes down as he always does, alongside the rest)
      if (this.hulk && this.hulk.state === "dormant") go(this.summonHulk(), null);
      if (this.spidey && !this.spidey.active) {
        this.spidey.enter(this.allySpawn(), this.player.feet.clone());
        go(true, this.spidey);
      }
      if (this.iron && !this.iron.active) go(this.summonIron(), this.iron);
      if (this.dp && !this.dp.active) go(this.summonDeadpool() !== false, this.dp);
      if (this.sm && !this.sm.active) go(this.summonSuperman(), this.sm);
      for (const h of this.squad) if (!h.active) go(this.summonSquad(h.def.id), h);
    } else {
      if (this.wolv && this.wolv.state === "dormant") go(this.summonWolverine(), this.wolv as unknown as { skip?(): void });
      if (this.bat && this.bat.state === "dormant") go(this.summonBatman(), this.bat as unknown as { skip?(): void });
      for (const v of this.villains) if (!v.active && !v.defeated) go(this.summonVillain(v.def.id), v);
    }
    // (their skipped entrances each put up a name card: none of them, with everyone arriving at once)
    this.hulk?.hud.card("", "", 0);
    this.hud.flashPrompt(n ? `${n} ${side === "heroes" ? "HEROES" : "VILLAINS"} IN` : `ALL ${side === "heroes" ? "HEROES" : "VILLAINS"} ALREADY IN`);
  }
  /** a villain's own guard (Red Skull's call): reserve soldiers woken round him, a few metres out */
  private callGuards(at: Vector3, n: number) {
    const nav = this.level.nav, me = this.player.feet;
    let came = 0;
    for (const e of this.enemies.enemies) {
      if (came >= n) break;
      if (!e.dormant || e.spawn.group !== "reinforce") continue;
      let spot: Vector3 | null = null;
      for (let k = 0; k < 12 && !spot; k++) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 6;
        const p = at.add(new Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
        const fy = nav.floorAt(p.x, at.y + 2, p.z, 4);
        if (fy === null || nav.embedded(p.x, fy + 1, p.z)) continue;
        spot = new Vector3(p.x, fy, p.z);
      }
      if (!spot) continue;
      e.wake(spot, Math.atan2(me.x - spot.x, me.z - spot.z));
      e.engage();
      this.stats.total++;
      came++;
    }
    return came;
  }
  /** Wolverine's still to come (Spider-Man's in and he isn't, yet) */
  private wolvPending() {
    return (!!this.wolv && this.wolv.state === "dormant" && !!this.spidey?.active) || (!!this.bat && this.bat.state === "dormant" && !!this.dp?.active);
  }
  private summonBatman() {
    if (!this.bat || this.bat.state !== "dormant") return false;
    this.scaleFoe(this.bat);
    let route = this.bat.entryRoute(this.player.feet.clone());
    for (const p of [...this.foesUp().map((f) => f.position), this.level.playerSpawn.pos]) {
      if (route) break;
      route = this.bat.entryRoute(p.clone());
    }
    if (!route) return false;
    return this.bat.enter(route);
  }
  private summonSuperman() {
    if (!this.sm || this.sm.active) return false;
    let at = this.sm.landingSpot(this.player.feet.clone(), this.player.camera.getDirection(Vector3.Forward()));
    for (const p of [...this.foesUp().map((f) => f.position), this.level.playerSpawn.pos]) {
      if (at) break;
      at = this.sm.landingSpot(p.clone(), new Vector3(1, 0, 0));
    }
    if (!at) return false;
    this.sm.enter(at);
    this.bat?.greetClark();
    return true;
  }
  /** a missile, a rocket, a bomb from the sky: you and the heroes are what it hurts */
  private airBlast(pos: Vector3, radius: number, damage: number) {
    this.explosions.rocket(pos, Vector3.Up(), false);
    const fy = this.level.nav.floorAt(pos.x, pos.y + 0.6, pos.z, 1.5);
    if (fy !== null) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), Math.min(2, radius * 0.25));
    this.audio.play("rocketBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 1, reverb: 1.3, pitchVar: 0.05 });
    const v = this.blastVisibility(pos);
    if (this.player.alive && v.d < radius && (v.d < 1.5 || v.los)) this.player.takeDamage(damage * Math.pow(1 - v.d / radius, 1.2), pos);
    this.player.shake(Math.min(0.9, 1.4 * Math.max(0, 1 - v.d / 35)));
    for (const a of this.heroesUp()) {
      const d = Vector3.Distance(a.feet.add(new Vector3(0, 1, 0)), pos);
      if (d > radius) continue;
      a.takeDamage(damage * (1 - d / radius), pos);
      if (d < radius * 0.6) a.knock(a.feet.subtract(pos).normalize().scale(6), 3);
    }
  }
  /** Iron Man takes shots at what's in the sky, between his own moves */
  private antiAir(dt: number) {
    const air = this.air;
    if (!air || !this.iron?.alive) return;
    this.antiAirT -= dt;
    if (this.antiAirT > 0) return;
    this.antiAirT = 2.2;
    let best = null as (typeof air.list)[number] | null, bd = 150;
    for (const u of air.up) {
      const d = Vector3.Distance(u.position, this.iron.p);
      if (d < bd && this.level.nav.clear(this.iron.p, u.position)) (bd = d), (best = u);
    }
    if (best && Math.random() < 0.7) this.iron.shootAir(best);
  }
  /** every foe that's up (Superman's freeze breath, the win) */
  private foesUp(): Foe[] {
    const hulkFoe = this.hulk && !this.hulk.ally ? this.hulk : undefined;
    const up: Foe[] = [hulkFoe, this.wolv, this.bat].filter((f): f is Hulk & Wolverine & Batman => !!f && f.alive && !f.cinematic && f.state !== "dormant");
    for (const v of this.villains) if (v.alive && !v.cinematic) up.push(v);
    return up;
  }
  /**
   * The Playground's clock runs faster in a lull (nobody left to fight, and someone still to come):
   * the next arrival isn't kept waiting.
   */
  private get lull() {
    return this.heroStage && this.enemies.awakeCount === 0 && !this.foesUp().length ? 5 : 1;
  }
  /** everyone on your side who's coming has come (the fight ends with the whole line-up in it) */
  private allArrived() {
    // (the final boss beaten: the line-up's as complete as it's going to be)
    if (this.thanos()?.defeated) return true;
    // (come at some point: Iron Man flies off when his fight's done — he still came)
    const all = [this.spidey, this.iron, this.dp, this.sm, ...this.squad];
    for (const h of all) if (h?.active) this.everIn.add(h);
    return all.every((h) => !h || this.everIn.has(h));
  }
  private everIn = new Set<object>();
  /** the big foes that are still to come or still fighting (none left: the air war and the fight can end) */
  private foesDone() {
    const hulkFoe = this.hulk && !this.hulk.ally ? this.hulk : undefined;
    // (Thanos down: anyone who never came no longer counts)
    const skip = this.thanos()?.defeated ? "dormant" : "";
    return [hulkFoe, this.wolv, this.bat, ...this.villains].every((f) => !f || f.state === "down" || f.state === skip);
  }
  /**
   * Everyone on your side who's in the fight (the one list: the foes, the jets and the blasts all
   * read it — a new hero is added here once).
   */
  private heroesUp(): Combatant[] {
    const out: Combatant[] = [];
    for (const a of [this.spidey, this.iron, this.dp, this.sm]) if (a?.alive) out.push(a);
    if (this.hulk?.ally && this.hulk.alive && !this.hulk.cinematic && this.hulk.state !== "dormant") out.push(this.hulk);
    for (const h of this.squad) if (h.alive) out.push(h);
    return out;
  }
  /**
   * The order the Phase-2 heroes come in: each a few seconds after someone else has arrived (and
   * never during anyone's entrance) — so the arrivals stay one at a time.
   */
  private readonly SQUAD_PLAN: { id: string; after: () => boolean; delay: number }[] = [
    { id: "cap", after: () => !!this.hulk && this.hulk.state !== "dormant" && !this.hulk.cinematic, delay: 20 },
    { id: "thor", after: () => !!this.wolv && this.wolv.state !== "dormant" && !this.wolv.cinematic, delay: 20 },
    { id: "starlord", after: () => !!this.iron?.active && !this.iron.cinematic, delay: 15 },
    { id: "rocket", after: () => !!this.squadIn("starlord"), delay: 12 },
    { id: "drax", after: () => !!this.dp?.active && !this.dp.cinematic, delay: 15 },
    { id: "flash", after: () => !!this.bat && this.bat.state !== "dormant" && !this.bat.cinematic, delay: 12 },
    { id: "marvel", after: () => !!this.sm?.active && !this.sm.cinematic, delay: 15 },
    // the second wave (round 10): a lane of its own on the Playground's clock, alongside the first —
    // so they're all in long before the finale (still one entrance at a time)
    { id: "strange", after: () => this.stageClock > 60, delay: 6 },
    { id: "ironhide", after: () => this.stageClock > 105, delay: 6 },
    { id: "surfer", after: () => this.stageClock > 150, delay: 6 },
    { id: "torch", after: () => this.stageClock > 195, delay: 6 },
    { id: "fantastic", after: () => this.stageClock > 235, delay: 6 },
    { id: "toothless", after: () => this.stageClock > 270, delay: 6 },
    { id: "antman", after: () => this.stageClock > 300, delay: 6 },
    // (Venom, if a mission has put him on your side)
    { id: "venom", after: () => this.stageClock > 215, delay: 6 },
  ];
  /**
   * The villains' arrivals (Phase 3), each a little after a hero has come in — so every new hero
   * walks into someone worth fighting, and the arrivals stay one at a time.
   */
  private readonly VILLAIN_PLAN: { id: string; after: () => boolean; delay: number }[] = [
    { id: "joker", after: () => !!this.squadIn("cap"), delay: 25 },
    { id: "ronan", after: () => !!this.squadIn("thor"), delay: 22 },
    { id: "ultron", after: () => !!this.iron?.active && !this.iron.cinematic, delay: 20 },
    { id: "darkseid", after: () => !!this.sm?.active && !this.sm.cinematic, delay: 20 },
    { id: "doom", after: () => !!this.squadIn("marvel"), delay: 20 },
    // the second wave's villains, on the clock (Megatron for Ironhide; Godzilla the last before Thanos)
    { id: "hela", after: () => this.stageClock > 85, delay: 8 },
    { id: "redskull", after: () => this.stageClock > 130, delay: 8 },
    { id: "megatron", after: () => !!this.squadIn("ironhide") && this.stageClock > 160, delay: 10 },
    { id: "venom", after: () => this.stageClock > 215, delay: 8 },
    { id: "godzilla", after: () => this.stageClock > 320, delay: 10 },
    // the finale: when every other foe is down and the whole line-up has come, Thanos
    // (or, nine minutes after the Hulk's landing, the moment nobody else is fighting — whoever is still to come
    // is skipped: he's the last one in, however the run has gone)
    { id: "thanos", after: () => this.thanosReady(), delay: 8 },
  ];
  private skyWant = 0;
  private skyK = 0;
  private skyBase?: { sun: number; hemi: number; fog: Color3; clear: Color4 };
  private updateSky(dt: number) {
    if (this.skyK === this.skyWant) return;
    this.skyK += (this.skyWant - this.skyK) * (1 - Math.exp(-2 * dt));
    if (Math.abs(this.skyWant - this.skyK) < 0.002) this.skyK = this.skyWant;
    this.applySky(this.skyK);
  }
  /** 0: the stage's own light; 1: a dark purple storm */
  private applySky(k: number) {
    const sc = this.scene, env = this.env;
    const B = (this.skyBase ??= { sun: env.sun.intensity, hemi: env.hemi.intensity, fog: sc.fogColor.clone(), clear: sc.clearColor.clone() });
    env.sun.intensity = B.sun * (1 - 0.65 * k);
    env.hemi.intensity = B.hemi * (1 - 0.5 * k);
    Color3.LerpToRef(B.fog, new Color3(0.28, 0.2, 0.36), k, sc.fogColor);
    Color4.LerpToRef(B.clear, new Color4(0.2, 0.14, 0.28, 1), k, sc.clearColor);
  }
  /** the other big foes: everyone Thanos waits on */
  private beforeThanos() {
    return [this.wolv, this.bat, ...this.villains.filter((v) => v.def.id !== "thanos")].filter((f) => !!f) as { state: string }[];
  }
  private thanosReady() {
    const others = this.beforeThanos();
    if (this.allArrived() && others.every((f) => f.state === "down")) return true;
    return this.stageClock >= this.THANOS_BY && others.every((f) => f.state === "down" || f.state === "dormant");
  }
  /** seconds after the Hulk's landing by which Thanos comes in regardless of who's still to come */
  private readonly THANOS_BY = 540;
  /** seconds since the Hulk's landing (the Playground's clock) */
  private stageClock = 0;
  private thanos() {
    return this.villains.find((v) => v.def.id === "thanos");
  }
  /** whom a villain fights: you and the heroes — and an independent (Doom) the villains too, if the faction table says so */
  private targetsOf(me: RosterVillain): Combatant[] {
    const out: Combatant[] = [];
    if (this.player.alive) out.push(this.player as unknown as Combatant);
    out.push(...this.heroesUp());
    // (the other foes, each by its own faction: Godzilla is everyone's enemy, Doom nobody's friend)
    for (const v of this.villains) if (v !== me && v.alive && !v.cinematic && hostile(me.def.faction, v.def.faction)) out.push(v);
    return out;
  }
  /** the villains who are up (they keep apart from each other on the move) */
  private villainsUp(): Combatant[] {
    return this.villains.filter((v) => v.alive);
  }
  /** a hero's roster id (the old heroes' classes have none of their own) */
  private idOf(x: unknown) {
    if (x === this.spidey) return "spiderman";
    if (x === this.iron) return "ironman";
    if (x === this.dp) return "deadpool";
    if (x === this.sm) return "superman";
    if (x === this.hulk) return "hulk";
    return (x as RosterHero | undefined)?.def?.id;
  }
  private rivalOf(v: RosterVillain): Combatant | null {
    const id = v.kit.rival;
    if (!id) return null;
    return this.heroesUp().find((c) => this.idOf(c) === id) ?? null;
  }
  private summonVillain(id: string) {
    const v = this.villains.find((x) => x.def.id === id);
    if (!v || v.active || v.defeated) return false;
    // (as strong as the team he walks into needs him to be)
    const base = v.def.stats.health;
    v.maxHealth = Math.round(base * this.teamScale());
    return v.enter();
  }
  private updateVillains(dt: number) {
    const th = this.thanos();
    // (a lull runs the clock fast too: nobody to fight, the next one comes sooner)
    if (this.hulk && this.hulk.state !== "dormant" && !this.allyCineOn) this.stageClock += dt * this.lull;
    for (const p of this.VILLAIN_PLAN) {
      const v = this.villains.find((x) => x.def.id === p.id);
      if (!v || v.active || v.defeated || !p.after()) continue;
      // (nobody new once the final boss is in)
      if (p.id !== "thanos" && th && (th.active || th.defeated)) continue;
      let due = this.villainDue.get(p.id) ?? p.delay;
      if (!this.allyCineOn && !this.hulk?.cinematic) due -= dt * this.lull;
      if (due <= 0) due = this.summonVillain(p.id) ? 0 : 1;
      this.villainDue.set(p.id, due);
    }
    for (const v of this.villains) this.lodStep(v, v.p, dt, (d) => v.update(d), v.cinematic);
    this.villainTeam.update(dt);
    // (the sky: the finale's entrance darkens it; it stays a storm while he's up)
    if (th && th.introT < 0) this.skyWant = th.active && !th.defeated ? 0.45 : 0;
    this.updateSky(dt);
    // (the objective: the final boss on the way, then in)
    const obj = document.getElementById("obj-text");
    if (obj && th) {
      let want = "";
      if (th.active || th.defeated) want = th.defeated ? "THANOS IS DOWN" : "DEFEAT THANOS";
      else if (this.hulk && this.hulk.state !== "dormant") {
        const ready = this.thanosReady();
        const due = ready ? this.villainDue.get("thanos") : undefined;
        const left = this.beforeThanos().filter((f) => f.state !== "down").length;
        const clock = Math.max(0, Math.ceil(this.THANOS_BY - this.stageClock));
        if (due !== undefined && due > 0) want = `THANOS ARRIVES IN ${Math.ceil(due)}s`;
        else if (ready) want = "THANOS IS COMING";
        // (the clock only while it's still counting: past it, it's the foes still up that he waits on)
        else want = `FINAL BOSS: THANOS · ${left} FOE${left === 1 ? "" : "S"} TO GO` + (clock > 0 ? ` · ${Math.floor(clock / 60)}:${String(clock % 60).padStart(2, "0")}` : "");
      }
      if (want && obj.textContent !== want) obj.textContent = want;
    }
  }
  /** a villain's explosion: you and the heroes are what it hurts */
  private villainBlast(pos: Vector3, radius: number, damage: number) {
    this.explosions.rocket(pos, Vector3.Up(), false);
    this.audio.play("rocketBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 0.9, reverb: 1.3, pitchVar: 0.05 });
    const v = this.blastVisibility(pos);
    if (this.player.alive && v.d < radius && (v.d < 1.5 || v.los)) this.player.takeDamage(damage * Math.pow(1 - v.d / radius, 1.2), pos);
    for (const a of this.heroesUp()) {
      const d = Vector3.Distance(a.feet.add(new Vector3(0, 1, 0)), pos);
      if (d < radius) a.takeDamage(damage * (1 - d / radius), pos);
    }
  }
  private squadIn(id: string) {
    const h = this.squad.find((x) => x.def.id === id);
    return h && h.active && !h.cinematic ? h : null;
  }
  private summonSquad(id: string) {
    const h = this.squad.find((x) => x.def.id === id);
    if (!h || h.active) return false;
    return h.enter();
  }
  private updateSquad(dt: number) {
    for (const p of this.SQUAD_PLAN) {
      const h = this.squad.find((x) => x.def.id === p.id);
      if (!h || h.active || !p.after()) continue;
      let due = this.squadDue.get(p.id) ?? p.delay;
      if (!this.allyCineOn && !this.hulk?.cinematic) due -= dt * this.lull;
      if (due <= 0) due = this.summonSquad(p.id) ? 0 : 1;
      this.squadDue.set(p.id, due);
    }
    for (const h of this.squad) {
      this.lodStep(h, h.p, dt, (d) => h.update(d), h.cinematic);
      this.squadBars.get(h)?.(h.health / h.maxHealth, h.state);
    }
    const fx = this.heroFx;
    if (fx) {
      fx.bolts.update(dt);
      fx.lightning.update(dt);
      fx.rings.update(dt);
      fx.glow.update(dt);
      fx.smoke.update(dt);
    }
  }
  /** an explosion on your side's terms (Rocket's rounds, Star-Lord's mine, Thor's storm): the soldiers, the foes and the aircraft — never you or the heroes */
  private heroBlast(pos: Vector3, radius: number, damage: number) {
    this.explosions.rocket(pos, Vector3.Up(), false);
    this.audio.play("rocketBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 0.9, reverb: 1.3, pitchVar: 0.05 });
    const fy = this.level.nav.floorAt(pos.x, pos.y + 0.6, pos.z, 1.5);
    if (fy !== null) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), Math.min(1.6, radius * 0.3));
    this.enemies.explosion(pos, radius, damage, this.losClear);
    for (const u of this.air?.up ?? []) if (u.inBlast(pos, radius)) u.applyHit(damage, "torso", Vector3.Up(), pos, { kind: "blast" });
    for (const f of [this.wolv, this.bat, ...this.villains]) {
      if (!f?.inBlast(pos, radius)) continue;
      const d = Vector3.Distance(pos, f.position.add(new Vector3(0, 1, 0)));
      f.applyHit(damage * Math.max(0.25, 1 - d / (radius + 1)), "torso", f.position.subtract(pos).normalize(), pos, { kind: "blast", force: d < radius * 0.5 ? 2 : 0 });
    }
    this.player.shake(Math.min(0.5, Math.max(0, 1 - Vector3.Distance(pos, this.player.feet) / 30) * 0.6));
  }
  /** (the ally Hulk) whoever's against you, as things he can hit: the foes, and the soldiers that are up */
  private hostiles(): Combatant[] {
    const out: Combatant[] = [];
    for (const f of this.foesUp()) out.push(this.asCombatant(f));
    for (const e of this.enemies.enemies) if (e.alive && !e.dormant) out.push(this.asCombatant(e));
    return out;
  }
  private adapters = new WeakMap<object, Combatant>();
  /** a foe or a soldier seen as a Combatant (a Hulk-sized blow on it); one per thing, kept */
  private asCombatant(x: Foe | import("../enemies/Enemy").Enemy): Combatant {
    let c = this.adapters.get(x);
    if (c) return c;
    const hulk = () => this.hulk;
    if ("size" in x) {
      const f = x as Foe & { launch?(v: Vector3): void };
      c = {
        get feet() { return f.position; },
        get alive() { return f.alive; },
        get state() { return f.state; },
        takeDamage(amount: number, from: Vector3) {
          const dir = f.position.subtract(from);
          dir.y = 0;
          if (dir.lengthSquared() < 1e-4) dir.set(0, 0, 1);
          dir.normalize();
          f.applyHit(amount, "torso", dir, f.position.add(new Vector3(0, 1.1, 0)), { kind: "melee", force: 3, source: hulk() });
        },
        knock(vel: Vector3, up = 0) {
          f.launch?.(new Vector3(vel.x, up, vel.z));
        },
      } as Combatant;
    } else {
      const e = x;
      c = {
        get feet() { return e.position.subtract(new Vector3(0, 0.9, 0)); },
        get alive() { return e.alive; },
        takeDamage(amount: number, from: Vector3) {
          const dir = e.position.subtract(from);
          dir.y = 0;
          if (dir.lengthSquared() < 1e-4) dir.set(0, 0, 1);
          dir.normalize();
          // (a blow from the Hulk: a soldier doesn't get up from it — the body goes flying)
          e.applyHit(amount * 4, "torso", dir, e.position.clone(), { kind: "melee", force: 3, launch: dir.scale(9).addInPlaceFromFloats(0, 6, 0) });
        },
        knock() {},
      };
    }
    this.adapters.set(x, c);
    return c;
  }
  /** each one's entrance, now (the arrival clock, or a developer key) */
  private summonHulk() {
    if (!this.hulk || this.hulk.state !== "dormant") return false;
    this.hulkDue = 0.01;
    return true;
  }
  private summonSpidey() {
    if (!this.spidey || this.spidey.active) return false;
    const h = this.hulk && this.hulk.state !== "dormant" ? this.hulk.position : null;
    const at = this.spidey.entrySpot(this.player.feet.clone(), this.player.camera.position, h);
    if (at) this.spidey.enter(at, this.player.feet.clone());
    else this.spidey.enter(this.allySpawn(), (h ?? this.player.feet).clone());
    return true;
  }
  private summonIron() {
    if (!this.iron || this.iron.active) return false;
    const look = this.player.camera.getDirection(Vector3.Forward());
    const h = this.hulk && this.hulk.state !== "dormant" ? this.hulk.position : null;
    let at = this.iron.landingSpot(this.player.feet.clone(), this.player.camera.position, look, h);
    // (nowhere open by you — pinned in a corner: somewhere open by the fight, or by the start)
    for (const p of [...this.foesUp().map((f) => f.position), this.level.playerSpawn.pos]) {
      if (at) break;
      at = this.iron.landingSpot(p.clone(), p.add(new Vector3(0, 1.6, 0)), look, null);
    }
    if (!at) return false;
    this.iron.enter(at);
    return true;
  }
  /**
   * A foe walks into however many heroes are up: 12% more of him for each (the Playground's line-up
   * is eleven strong now; without this Wolverine and Batman last seconds).
   */
  private scaleFoe(f: { maxHealth: number }) {
    const base = ((f as { baseHealth?: number }).baseHealth ??= f.maxHealth);
    f.maxHealth = Math.round(base * this.teamScale());
  }
  /**
   * How much tougher a foe comes in for the team he walks into: 10% a hero, up to eight (×1.8) —
   * past that the line-up is so big an uncapped scale (×3+ with nineteen) only makes a slog.
   */
  private teamScale() {
    return 1 + 0.1 * Math.min(8, this.heroesUp().length);
  }
  private summonWolverine() {
    if (!this.wolv || this.wolv.state !== "dormant") return false;
    this.scaleFoe(this.wolv);
    const h = this.hulk && this.hulk.alive ? this.hulk.position : null;
    const spot = this.wolv.entrySpot(this.player.feet.clone(), this.player.camera.position, h);
    if (spot) return this.wolv.enter(spot.perch, spot.land);
    // (nowhere up high in sight: he comes over the ground at you, 9 m out)
    const yaw = this.player.yaw;
    const at = this.player.feet.add(new Vector3(Math.sin(yaw) * 9, 0, Math.cos(yaw) * 9));
    const fy = this.level.nav.floorAt(at.x, at.y + 2, at.z, 4);
    if (fy === null || this.level.nav.embedded(at.x, fy + 1, at.z)) return false;
    at.y = fy;
    const land = this.player.feet.add(at.subtract(this.player.feet).scale(0.6));
    land.y = fy;
    return this.wolv.enter(at, land);
  }
  private summonDeadpool() {
    if (!this.dp || this.dp.active) return false;
    this.dpCame = true;
    this.dp.enter();
    this.wolv?.greetWade();
    return true;
  }

  /**
   * Who a hero fights: of the Hulk, Wolverine and Batman (whoever's up and out of his entrance), the one
   * that's after them, else the nearer — kept for a couple of seconds so nobody dithers. With both
   * down it's the Hulk (down: the heroes' "it's over" checks read that).
   */
  private foeFor(me: { feet: Vector3 } | undefined): Foe | null {
    const h = this.hulk && !this.hulk.ally ? this.hulk : null;
    const up = this.foesUp();
    // (nobody up: the one who went down last — the heroes' "it's over" checks read that)
    if (!up.length) return h ?? (this.bat?.state === "down" ? this.bat : this.wolv) ?? null;
    if (!me || up.length === 1) return up[0];
    // (game time: a pause or slow motion holds the choice too)
    const now = this.stats.time;
    const held = this.foeOf.get(me);
    if (held && held.t > now && held.f && up.includes(held.f as never)) return held.f;
    // (old scores to settle: Deadpool goes for Wolverine, Superman for Batman)
    const rival = (f: Foe) =>
      ((me as unknown) === this.dp && f === this.wolv) || ((me as unknown) === this.sm && f === this.bat) || (f instanceof RosterVillain && !!f.kit.rival && f.kit.rival === this.idOf(me));
    const d = (f: Foe) => Vector3.Distance(f.position, me.feet) - ((f.target as unknown) === me ? 8 : 0) - (rival(f) ? 30 : 0);
    let f: Foe = up[0];
    for (const x of up) if (d(x) < d(f)) f = x;
    this.foeOf.set(me, { f, t: now + 2.5 });
    return f;
  }
  /** (the ally Hulk's panel) */
  private hulkBar?: (frac: number, state: string) => void;
  /** a hero's health panel in the heroes' column (bottom left); returns its updater */
  private allyBar(id: string, name: string, color: string) {
    const el = document.createElement("div");
    el.id = id;
    el.className = "ally-hud ally-gen";
    el.style.setProperty("--ally", color);
    el.innerHTML = `<div class="ally-name">${name}</div><div class="ally-track"><div class="ally-bar"></div></div><div class="ally-state"></div>`;
    el.style.display = "none";
    document.getElementById("hud")?.appendChild(el);
    const bar = el.querySelector(".ally-bar") as HTMLDivElement, st = el.querySelector(".ally-state") as HTMLDivElement;
    this.allyBars.push(el);
    return (frac: number, state: string) => {
      el.style.display = state === "dormant" || state === "hidden" ? "none" : "";
      bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
      el.classList.toggle("ko", state === "down");
      st.textContent = state === "down" ? "KNOCKED OUT" : state === "rise" ? "BACK UP" : "";
    };
  }
  private allyBars: HTMLElement[] = [];
  private allySpawn() {
    const sp = this.level.playerSpawn;
    const want = sp.pos.add(new Vector3(Math.cos(sp.yaw) * 2.2, 0, -Math.sin(sp.yaw) * 2.2));
    const fy = this.level.nav.floorAt(want.x, want.y + 1, want.z, 2);
    if (fy !== null && !this.level.nav.embedded(want.x, fy + 1, want.z)) return new Vector3(want.x, fy, want.z);
    return sp.pos.add(new Vector3(0.8, 0, -1));
  }
  private hud!: Hud;
  private debug?: DebugOverlay;
  readonly dev = new DevMode();
  private grenades!: Grenades;
  /** soldier character templates (debug/tests) */
  skins?: SoldierSkins;
  private minimap!: Minimap;
  private nadeTpls!: Record<GrenadeType, Mesh>;
  private explosions!: Explosions;
  private rockets!: Rockets;
  private glass?: Glass;
  /** guns, ammo and crates lying around the stage */
  private pickups!: Pickups;
  private lookPickup: Pickup | null = null;
  /** soldiers' rifles to drop where they fell (after the body has come down) */
  private drops: { e: import("../enemies/Enemy").Enemy; t: number }[] = [];
  /** boot prints in the snow (snow stage only) */
  private prints?: Footprints;
  private doors?: Doors;
  private lookDoor: import("../level/Doors").Door | null = null;
  /** brief whole-frame exposure boost from nearby blasts */
  private expoKick = 0;
  private burnAcc = 0;
  /** flashbang exposure on the player: white-out level and remaining time */
  private flash = { amount: 0, hold: 0 };
  private losRay = new Ray(Vector3.Zero(), Vector3.Forward(), 1);
  private stats: RoundStats = { time: 0, total: 0, kills: 0, headshots: 0, accuracy: 0, damageTaken: 0 };
  private endTimer = -1;
  /** a story mission on this stage (Sandstorm, Frostline): objectives, cinematics, its own ending */
  private mission?: Mission | TapeMission | MetroMission;
  /** Frostline's Betamax deck (the tape's sound follows the game's volume) */
  private station?: import("../level/PlaybackStation").PlaybackStation;
  /** the mission's hostage (Sandstorm) */
  private hostage?: Hostage;
  /** Red Dune's Hulk (comes in halfway through the fight) */
  private hulk?: Hulk;
  /** Red Dune's ally: Spider-Man fights the Hulk alongside you */
  private spidey?: SpiderMan;
  /** seconds till he shows up (−1: the clock hasn't started) */
  private spideyDue = -1;
  /**
   * The order they come in: the Hulk; Spider-Man 45 s after he lands; Wolverine (against you) 40 s
   * after Spider-Man; Iron Man 30 s after Wolverine; Deadpool (out of a container) 30 s after Iron Man.
   */
  private iron?: IronMan;
  private ironDue = -1;
  private wolv?: Wolverine;
  private wolvDue = -1;
  /** Batman (with the Hulk), 30 s after Deadpool; Superman (with you), 25 s after Batman lands */
  private bat?: Batman;
  private batDue = -1;
  private sm?: Superman;
  /**
   * The Phase-2 heroes (RosterHero + their kits): Captain America, Thor, Star-Lord, Rocket, Drax,
   * the Flash and Captain Marvel — each coming in a little after one of the others (SQUAD_PLAN).
   */
  private squad: RosterHero[] = [];
  private squadDue = new Map<string, number>();
  private squadBars = new Map<RosterHero, (frac: number, state: string) => void>();
  /** the Phase-3 villains (RosterVillain + their kits): the Joker, Ronan, Ultron, Darkseid, Doctor Doom */
  private villains: RosterVillain[] = [];
  private villainDue = new Map<string, number>();
  private villainTeam = new VillainBoard();
  private heroFx?: { bolts: Bolts; lightning: Lightning; rings: ShockRing; glow: SpriteStream; smoke: SpriteStream };
  private smDue = -1;
  private ice?: IceFx;
  private snowfall?: Snowfall;
  /** the gunships and jets (from the Hulk's landing on) */
  private air?: AirForce;
  private antiAirT = 0;
  private dp?: Deadpool;
  private dpDue = -1;
  private dpCame = false;
  private ironLanded = false;
  /** each hero's foe, held a little while (the Hulk or Wolverine) */
  private foeOf = new Map<object, { f: Foe | null; t: number }>();
  private team = new TeamBoard();
  /** an ally's entrance was playing last frame (the camera's on them) */
  private allyCineOn = false;
  /** seconds until he comes in (-1: not yet due) */
  private hulkDue = -1;
  /** slow motion (mission cinematics) */
  private timeScale = 1;

  constructor(private canvas: HTMLCanvasElement, private settings: GameSettings, private cb: GameCallbacks) {
    this.input = new Input(canvas);
    this.input.aimToggle = settings.aimToggle ?? true;
  }

  setAimToggle(on: boolean) {
    this.settings.aimToggle = on;
    this.input.aimToggle = on;
    this.input.adsHeld = false;
  }

  async load(progress: (p: number, label: string) => void) {
    const low = this.settings.quality === "low";
    progress(0.02, "Starting renderer");
    this.engine = new Engine(this.canvas, false, { stencil: true, powerPreference: "high-performance", preserveDrawingBuffer: false, audioEngine: false, antialias: false }, false);
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(low ? 1 : 1 / Math.min(dpr, 1.5));
    this.engine.useReverseDepthBuffer = false;
    window.addEventListener("resize", () => this.engine.resize());

    const scene = (this.scene = new Scene(this.engine));
    scene.skipPointerMovePicking = true;
    scene.skipPointerDownPicking = true;
    scene.skipPointerUpPicking = true;
    scene.collisionsEnabled = true;
    scene.blockMaterialDirtyMechanism = true;
    scene.setRenderingAutoClearDepthStencil(RENDER.viewmodelGroup, true, true, true);
    scene.detachControl();

    progress(0.06, "Synthesising audio");
    this.audio = new AudioEngine();
    await this.audio.init((p) => progress(0.06 + p * 0.14, "Synthesising audio"));
    await this.audio.loadAtlas(AK47_ATLAS.url, AK47_ATLAS.table);
    await this.audio.loadOverrides(["m72Launch", "dzjLaunch", "rocketBlast", "rocketMotor", "rocketWhoosh", "hulkRoar"]);
    // the Hulk's footfalls: four heavy steps cut from "Heavy Walking Footsteps" (Universfield, Pixabay)
    if (this.heroStage) await this.audio.loadVariants("hulkThud", "hulkStep", 4);
    this.audio.volume = this.settings.volume ?? 1;
    this.audio.ambienceLevel = this.settings.ambience ?? 1;
    this.audio.musicLevel = this.settings.music ?? 0.6;
    this.audio.setMuted(!!this.settings.muted);

    progress(0.2, "Authoring surfaces");
    this.mats = await Materials.create(scene, low, (p) => progress(0.2 + p * 0.22, "Authoring surfaces"));
    this.env = new Environment(scene);
    this.env.build(low);
    // (Red Dune runs from the sea to the arena: the shadows follow you rather than cover it all thinly)
    if (this.heroStage || this.settings.stage === "kestrel") {
      this.env.shadowFollow = true;
      if (this.settings.stage === "whiteout") {
        // Whiteout: a cold bright afternoon, and snow coming down
        this.env.winter();
        this.snowfall = new Snowfall(scene);
      } else this.env.brighter();
    }
    await tick();

    // soldier characters download while the level and weapons are built
    // (the Underground's soldiers are its own: the Polish soldier, the soldier girl, the Winter Soldier)
    const skinsP = this.settings.stage === "metro" ? SoldierSkins.load(scene, undefined, ["polish", "girl", "winter"]) : SoldierSkins.load(scene);
    const hostageP = this.settings.stage === "dust2" ? HostageModel.load(scene) : null;
    const stationP = this.settings.stage === "office" ? StationModel.load(scene) : null;
    const hulkP = this.heroStage ? HulkModel.load(scene) : null;
    // (Spider-Man: the rigged model, its own skeleton and clips)
    const spideyP = this.heroStage ? SkinnedModel.load(scene, spideyRiggedUrl, 1.78, (m) => {
      m.maxSimultaneousLights = 4;
      m.environmentIntensity = 1.1;
    }) : null;
    // Wolverine (against you): his own Biped skeleton (and the stage plays without him if he fails)
    const wolvP = this.heroStage ? WolverineModel.load(scene).catch((e) => (console.warn("wolverine failed to load", e), null)) : null;
    const batP = this.heroStage ? BatmanModel.load(scene).catch((e) => (console.warn("batman failed to load", e), null)) : null;
    const smP = this.heroStage ? SupermanModel.load(scene).catch((e) => (console.warn("superman failed to load", e), null)) : null;
    // (if anything about Deadpool fails to load, the stage still plays — without him)
    const dpP = this.heroStage ? DeadpoolModel.load(scene, deadpoolUrl).catch((e) => (console.warn("deadpool failed to load", e), null)) : null;
    // the Phase-2 heroes (each optional: one that fails to load is left out, the rest still come)
    // (a mission's call, or ?venom=ally to try it: Venom on your side — the same character, the same kit)
    if (new URLSearchParams(location.search).get("venom") === "ally") setSide("venom", "hero");
    // (which side each is built on is the faction table's call — factions.sideOf — not which file its kit is in)
    const kitIds = (list: CharacterDef[]) => list.filter((c) => c.model && ALL_KITS[c.id]).map((c) => c.id);
    const villainP = this.heroStage
      ? Promise.all(kitIds(rosterVillains()).map((id) => RosterModel.load(scene, byId(id)!, ALL_KITS[id]).then((m) => [id, m] as const).catch((e) => (console.warn(id + " failed to load", e), null))))
      : null;
    const squadP = this.heroStage
      ? Promise.all(kitIds(rosterHeroes()).map((id) => RosterModel.load(scene, byId(id)!, ALL_KITS[id]).then((m) => [id, m] as const).catch((e) => (console.warn(id + " failed to load", e), null))))
      : null;
    const ironP =
      this.heroStage
        ? SkinnedModel.load(scene, ironUrl, 1.95, (m) => {
            // his armour's own maps; a touch more of the sky in the metal so he reads at sunset
            m.maxSimultaneousLights = 4;
            m.environmentIntensity = 1.6;
          })
        : null;
    const lockersP = this.settings.stage === "dust2" ? LockerModel.load(scene) : null;
    const info = stageInfo(this.settings.stage);
    const office = info.id === "office";
    progress(0.42, `Loading ${info.name[0] + info.name.slice(1).toLowerCase()}`);
    // the downloaded maps are the long part on a first visit: give them most of the bar
    const loadBar = (p: number, label?: string) => progress(0.42 + p * 0.3, label ?? "Loading");
    this.level =
      info.id === "office"
        ? await buildOffice(scene, this.env, loadBar)
        : info.id === "dust2"
          ? await buildDust2(scene, this.env, this.mats, low, loadBar)
          : info.id === "metro"
            ? await buildMetro(scene, this.env, this.mats, low, loadBar)
          : info.id === "whiteout"
            ? buildWhiteout(scene, this.mats, this.env)
            : buildKestrelPoint(scene, this.mats, this.env);
    if (info.id === "whiteout") await plantWhiteoutTrees(scene).catch((e) => console.warn("pines failed to load", e));
    await tick();
    // authored set dressing (containers, trucks)
    let propMeshes: import("@babylonjs/core/Meshes/abstractMesh").AbstractMesh[] = [];
    if (this.level.props?.length) {
      const props = new Props(scene);
      await props.load(
        this.level.props.map((p) => p.kind),
        (p) => progress(0.43 + p * 0.04, "Bringing in the trucks"),
      );
      propMeshes = props.place(this.level.props);
    }
    if (office) {
      progress(0.47, "Composing the score");
      await tick();
      // the player's own track (public/music/frostline.mp3) if there is one, else the procedural score
      let own = false;
      try {
        const r = await fetch(import.meta.env.BASE_URL + "music/frostline.mp3");
        if (r.ok && (r.headers.get("content-type") ?? "").startsWith("audio")) {
          await this.audio.setMusicFile(await r.arrayBuffer());
          own = true;
        }
      } catch {
        /* none */
      }
      if (!own) {
        const { composeOfficeTheme } = await import("../audio/Music");
        this.audio.setMusic(composeOfficeTheme(this.audio.ctx.sampleRate));
      }
    }
    progress(0.48, "Starting physics");
    this.physics = new PhysicsService(scene);
    if (await this.physics.init()) {
      if (this.level.boxes) this.physics.buildLevelMeshes(this.level.colliders, this.level.physicsOnly);
      else this.physics.buildLevel(this.level.colliders);
    }

    // breakable windows (after physics: ragdolls don't need panes)
    if (this.level.glassMesh) {
      this.glass = new Glass(scene, this.mats, this.audio);
      this.glass.groundAt = (x, y, z, drop) => this.level.nav.floorAt(x, y, z, drop);
      this.glass.build(this.level.glassMesh);
      this.level.colliders.push(...this.glass.colliders);
    }
    // hinged doors in the doorways
    if (this.level.doors?.length) {
      const doors = (this.doors = new Doors(scene, this.mats, this.audio));
      doors.build(this.level.doors);
      this.level.colliders.push(...doors.colliders);
      this.level.nav.extraBlock = (ox, oy, oz, dx, dy, dz, len) => doors.blockRay(ox, oy, oz, dx, dy, dz, len);
      // a door onto a room you can't get into (taped off, blocked by a ladder, a dead-end recess) never opens
      const nav = this.level.nav;
      const a = new Vector3(), b = new Vector3();
      doors.seal((d, nx, nz) => {
        const fy = d.centre.y - d.height / 2;
        // walk-through at chest height (tape, a ladder or a wall right behind the door blocks it; a chair
        // by the door doesn't), then floor and walkable space on that side
        a.set(d.centre.x, fy + 1.3, d.centre.z);
        b.set(d.centre.x + nx * 1.8, fy + 1.3, d.centre.z + nz * 1.8);
        if (nav.moveRay(a, b, false) >= 0) return false;
        // a floor to stand on in there (looked for from knee height down: a chair's seat isn't floor)
        return [0.9, 1.4, 1.8].some((k) => {
          const f = nav.floorAt(d.centre.x + nx * k, fy - 0.2, d.centre.z + nz * k, 0.8);
          return f !== null && Math.abs(f - fy) < 0.5;
        });
      });
    }
    progress(0.5, "Loading weapons");
    const rigs = await this.loadWeaponRigs((p) => progress(0.5 + p * 0.12, "Loading weapons"));
    progress(0.63, "Arming");
    this.player = new PlayerController(scene, this.input, this.audio);
    this.player.userSensitivity = this.settings.sensitivity;
    this.player.baseFov = this.settings.fov ?? PLAYER.baseFovDeg;
    if (this.level.floorRange) this.player.killY = this.level.floorRange[0] - 4;
    this.fx = new Effects(scene, this.mats, this.audio, info.lit);
    this.hud = new Hud(SLOT_ORDER.map((s, i) => ({ label: String(i + 1), grenade: s === "grenade", title: SLOT_LABEL[s] })));
    this.weapons = new WeaponManager(scene, this.input, this.player, this.fx, this.audio, this.mats, {
      onHit: (kind, killed) => {
        this.hud.hit(kind, killed);
        this.audio.play(kind === "head" ? "hitHead" : "hitMarker", { volume: kind === "head" ? 0.45 : 0.32, pitchVar: 0.02 });
      },
      onShot: (origin, noise) => this.enemies.onPlayerShot(origin, noise),
      onNoAmmo: () => this.hud.setPrompt("NO RESERVE AMMO", true),
      onThrow: (type, origin, vel) => this.grenades.throw(type, origin, vel),
      onNoGrenades: () => this.hud.flashPrompt("NO GRENADES"),
      onRocket: (origin, dir, cfg) => this.rockets.fire(origin, dir, cfg),
      onGlass: (mesh, point, dir) => !!this.glass?.hit(mesh as never, point, dir),
      onBackblast: (at, dir, muzzle) => {
        this.fx.backblast(at, dir);
        if (muzzle) this.explosions.launchFlash(muzzle);
      },
    }, rigs);
    // (the knife lunges at the soldiers who are up)
    this.weapons.lungeTargets = () => (this.enemies ? this.enemies.enemies.filter((e) => e.alive && !e.dormant).map((e) => e.collider.position) : []);
    this.pickups = new Pickups(scene, rigs);
    this.grenades = new Grenades(scene, this.nadeTpls, this.mats, this.fx, this.audio);
    this.grenades.onDetonate = (d) => this.onDetonate(d);
    if (this.level.floorRange) this.grenades.killY = this.level.floorRange[0] - 5;
    this.grenades.onGlass = (mesh, point, dir) => !!this.glass?.hit(mesh as never, point, dir);
    this.explosions = new Explosions(scene, this.mats);
    // Frostline's lighting is baked: the blast's own light is drawn on the ground instead
    this.explosions.unlit = !info.lit;
    const surfaceAt = this.level.surfaceAt;
    if (surfaceAt) this.explosions.surfaceY = (x, y, z) => surfaceAt(x, y, z)?.y ?? null;
    this.explosions.groundAt = (x, y, z, drop) => this.level.nav.floorAt(x, y, z, drop);
    this.explosions.rayLevel = (from, to) => this.level.nav.rayLevel(from, to);
    this.rockets = new Rockets(scene, this.mats, this.audio);
    this.rockets.onDetonate = (b) => this.onRocket(b);
    this.rockets.onGlass = (mesh, point, dir) => !!this.glass?.hit(mesh as never, point, dir);
    await tick();

    progress(0.72, "Deploying hostiles");
    // arrive unseen: no guard post or patrol leg overlooks the insertion point
    secureStart(this.level.nav, this.level.playerSpawn.pos, this.level.enemySpawns);
    this.enemies = new EnemyManager(scene, this.mats, this.level, this.player, this.fx, this.audio, this.physics);
    this.skins = await skinsP;
    this.enemies.attachSkins(this.skins);
    // the stage's boss carries a sidearm too (the Glock): he draws it when his rifle runs dry
    for (const e of this.enemies.enemies) {
      if (!e.boss || !e.skin) continue;
      const side = this.pickups.sidearm("glock");
      if (side) e.skin.setSidearm(side);
    }
    const solids = this.enemies.setCollisionSet(this.level.colliders, this.player.collider);
    this.player.collider.surroundingMeshes = [...solids, ...this.enemies.enemies.map((e) => e.collider)];
    const threatBuf: { pos: Vector3; fuse: number; key: object }[] = [];
    this.enemies.hooks = {
      threats: () => this.grenades.threats(threatBuf),
      throwGrenade: (from, vel, owner) => {
        this.grenades.throw("frag", from, vel, true, owner);
        this.audio.play("grenadeThrow", { x: from.x, y: from.y, z: from.z, volume: 0.5, pitchVar: 0.06 });
      },
      breakGlass: (from, to) => this.glass?.breakAlong(from, to),
      openDoor: (pos, dx, dz) => this.doors?.openNear(pos, dx, dz),
      footstep: (x, y, z, yaw, side, run) => this.footprint(x, y, z, yaw, side, run),
      throwClear: (a, b) => this.grenades.clear(a, b),
      grenadeProp: () => {
        const m = this.nadeTpls.frag.createInstance("enemyNade");
        m.isPickable = false;
        m.setEnabled(false);
        return m;
      },
    };
    this.enemies.onKilled = (e, hs, remaining) => {
      this.drops.push({ e, t: 1.4 });
      this.stats.kills++;
      if (hs) this.stats.headshots++;
      this.hud.kill(hs);
      this.audio.play("killConfirm", { volume: 0.35 });
      this.hud.setHostiles(this.enemies.awakeCount);
      // a mission ends on its own terms, not on the last soldier
      if (this.mission) this.mission.onKilled(e);
      else if (remaining === 0 && this.hulkDue < 0 && (!this.hulk?.alive || this.hulk.ally)) {
        // (the Playground: the Hulk still to come if they all went down before he did — and the foes)
        if (this.hulk && this.hulk.state === "dormant") this.hulkDue = 2;
        else if (this.foesDone() && this.allArrived()) this.endTimer = 1.4;
      }
      // Red Dune: once ~40% of them are down, the Hulk comes
      if (this.hulk && this.hulk.state === "dormant" && this.hulkDue < 0 && this.stats.kills >= Math.ceil(this.baseSoldiers() * 0.4)) this.hulkDue = 2.5;
    };

    // shadows: merged static level + soldier instances
    const sm = this.env.shadows.getShadowMap()!;
    for (const m of this.level.casters) sm.renderList!.push(m);
    for (const m of propMeshes) sm.renderList!.push(m);
    for (const e of this.enemies.enemies) {
      if (e.skin) {
        for (const m of e.skin.meshes) sm.renderList!.push(m);
        sm.renderList!.push(e.skin.gun);
      } else for (const m of e.parts.all) sm.renderList!.push(m);
    }
    // (the Playground, with its crowd: the shadows are redrawn every other frame — 30 Hz is plenty for
    // them, and the shadow pass is a second draw of everything that casts)
    sm.refreshRate = info.lit ? (this.heroStage ? 2 : 1) : 0;

    this.env.setupPostFX(this.player.camera, low);
    scene.activeCamera = this.player.camera;

    // stretches of wall in the rooms: the supply caches go there
    const walls = wallSpots(this.level);
    const start = this.level.playerSpawn.pos;
    // the stage's guns and supplies: caches against the walls of its rooms
    await this.pickups.loadModels();
    const nav = this.level.nav;
    // a box beside the first must stand on the same floor, clear of walls and the wall beside it
    const fits = (p: Vector3) => {
      const fy = nav.floorAt(p.x, p.y + 0.3, p.z, 0.6);
      return fy !== null && Math.abs(fy - p.y) < 0.12 && !nav.embedded(p.x, p.y + 0.15, p.z) && !nav.embedded(p.x, p.y + 0.5, p.z);
    };
    this.pickups.populate(walls, start, office ? 9 : info.id === "dust2" || info.id === "metro" ? 8 : 5, fits);
    this.player.collider.surroundingMeshes!.push(...this.pickups.solids);
    const lv = this.level;
    this.minimap = new Minimap(lv.colliders, lv.bounds, lv.boxes && lv.floorRange ? { boxes: lv.boxes.data, floorMin: lv.floorRange[0], floorMax: lv.floorRange[1] } : undefined);

    if (info.snow) {
      this.prints = new Footprints(scene, this.mats.particle);
    }

    this.minimap.supplies = () => this.pickups.items;
    // the heroes and the big foes on the radar and the map
    this.minimap.marks = () => {
      const out: { pos: Vector3; heading: number; color: string; label: string; big?: boolean }[] = [];
      const hero = (h: { active: boolean; p: Vector3; yaw: number } | undefined, label: string, color: string) => {
        if (h?.active) out.push({ pos: h.p, heading: h.yaw, color, label });
      };
      hero(this.spidey, "SP", "#4c9bff");
      hero(this.iron, "IM", "#f4c531");
      hero(this.dp, "DP", "#ff4d6a");
      hero(this.sm, "S", "#5aa8ff");
      for (const h of this.squad) if (h.active) out.push({ pos: h.p, heading: h.yaw, color: h.kit.color, label: h.kit.label });
      for (const v of this.villains) if (v.alive) out.push({ pos: v.p, heading: v.yaw, color: "#ff3b3b", label: v.kit.label, big: true });
      const foe = (f: { alive: boolean; state: string; position: Vector3; heading: number } | undefined, label: string, color: string) => {
        if (f && f.alive && f.state !== "dormant") out.push({ pos: f.position, heading: f.heading, color, label, big: true });
      };
      if (this.hulk?.ally) {
        if (this.hulk.state !== "dormant") out.push({ pos: this.hulk.position, heading: this.hulk.heading, color: "#7ee04a", label: "HULK" });
      } else foe(this.hulk, "HULK", "#7ee04a");
      foe(this.wolv, "W", "#ffd23a");
      foe(this.bat, "B", "#b8bec8");
      for (const a of this.air?.list ?? []) if (a.alive) out.push({ pos: a.position, heading: a.heading, color: "#ff8a3d", label: a.label, big: true });
      return out;
    };

    // (the heroes' hosts read their foe through this: it changes as Wolverine comes and goes)
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const game = this;
    if (hulkP) {
      const hulk = (this.hulk = (await hulkP).spawn({
        scene,
        nav: this.level.nav,
        audio: this.audio,
        player: this.player,
        // (Red Dune has no sky test of its own: open is nothing overhead, straight up)
        allies: () => this.heroesUp(),
        // (his side comes from the roster: the brief has him with you)
        ally: byId("hulk")?.faction === "hero",
        hostiles: () => this.hostiles(),
        onHealth: (frac, state) => this.hulkBar?.(frac, state),
        holdFight: () => this.allyCineOn,
        openSky:
          this.level.openSky ??
          ((x, y, z) => this.level.nav.clear(new Vector3(x, y + 1.2, z), new Vector3(x, y + 30, z))),
        slam: (pos, power) => {
          this.explosions.slam(pos, power);
          const fy = this.level.nav.floorAt(pos.x, pos.y + 0.5, pos.z, 1.5);
          if (fy !== null) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), 1.4 * power);
        },
        clap: (pos, dir) => {
          const fy = this.level.nav.floorAt(pos.x, pos.y, pos.z, 4) ?? pos.y - 1.7;
          this.explosions.clapBlast(pos, dir, fy);
        },
        onDown: () => {
          // (on your side he's only knocked out: no kill, nothing ends)
          if (this.hulk?.ally) return;
          this.stats.kills++;
          this.hud.kill(false);
          this.audio.play("killConfirm", { volume: 0.45 });
          if (this.enemies.awakeCount === 0) this.endTimer = 3;
        },
      }));
      if (hulk.ally) this.hulkBar = this.allyBar("ally-hud-hulk", "HULK", "#5fcf3a");
      this.player.collider.surroundingMeshes!.push(hulk.solid);
    }
    if (spideyP) {
      const spidey = (this.spidey = await SpiderMan.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          playerMaxHealth: PLAYER.maxHealth,
          get hulk() {
            return game.foeFor(game.spidey);
          },
          soldiers: () => this.enemies.enemies,
          dust: (pos, power) => this.explosions.slam(pos, power),
          team: this.team,
        },
        await spideyP,
      ));
      for (const m of spidey.rig.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
      // (he isn't here yet: he turns up 45 s after the Hulk does)
    }
    if (ironP) {
      const iron = (this.iron = await IronMan.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          playerMaxHealth: PLAYER.maxHealth,
          get hulk() {
            return game.foeFor(game.iron);
          },
          soldiers: () => this.enemies.enemies,
          spidey: () => (this.spidey?.alive ? this.spidey : null),
          team: this.team,
          bounds: this.level.bounds,
          energy: (pos, power) => this.explosions.energy(pos, power),
          dust: (pos, power) => this.explosions.slam(pos, power),
        },
        await ironP,
      ));
      for (const m of iron.rig.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
    }
    const dpModel = dpP ? await dpP : null;
    if (dpModel) {
      const dp = (this.dp = await Deadpool.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          playerMaxHealth: PLAYER.maxHealth,
          get hulk() {
            return game.foeFor(game.dp);
          },
          soldiers: () => this.enemies.enemies,
          team: this.team,
          container: scene.getTransformNodeByName("prop_entrance"),
          tracer: (a, b) => this.fx.tracer(a, b),
          dust: (pos, power) => this.explosions.slam(pos, power),
          spark: (pos, n) => this.fx.impact(pos, n, "metal", false),
        },
        dpModel,
      ));
      for (const m of [...dp.rig.meshes, ...dp.weaponMeshes]) this.env.shadows.getShadowMap()!.renderList!.push(m);
    }
    const wolvModel = wolvP ? await wolvP : null;
    if (wolvModel) {
      const wolv = (this.wolv = await Wolverine.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          allies: () => this.heroesUp(),
          holdFight: () => this.allyCineOn || !!this.hulk?.cinematic,
          rival: () => (this.dp?.alive ? this.dp : null),
          dust: (pos, power) => this.explosions.slam(pos, power),
          spark: (pos, n) => this.fx.impact(pos, n, "metal", false),
          blood: (pos, dir) => this.fx.bloodHit(pos, dir, false),
          onDown: () => {
            this.stats.kills++;
            this.hud.kill(false);
            this.audio.play("killConfirm", { volume: 0.45 });
            if (this.enemies.awakeCount === 0 && this.foesDone() && this.allArrived()) this.endTimer = 3;
          },
        },
        wolvModel,
      ));
      for (const m of wolv.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
      this.player.collider.surroundingMeshes!.push(wolv.solid);
    }
    const allies = () => this.heroesUp();
    const batModel = batP ? await batP : null;
    if (batModel) {
      const bat = (this.bat = await Batman.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          allies,
          holdFight: () => this.allyCineOn || !!this.hulk?.cinematic,
          rival: () => (this.sm?.alive ? this.sm : null),
          dust: (pos, power) => this.explosions.slam(pos, power),
          spark: (pos, n) => this.fx.impact(pos, n, "metal", false),
          blood: (pos, dir) => this.fx.bloodHit(pos, dir, false),
          tracer: (a, b) => this.fx.tracer(a, b),
          onDown: () => {
            this.stats.kills++;
            this.hud.kill(false);
            this.audio.play("killConfirm", { volume: 0.45 });
            if (this.enemies.awakeCount === 0 && this.foesDone() && this.allArrived()) this.endTimer = 3;
          },
        },
        batModel,
      ));
      for (const m of bat.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
      this.player.collider.surroundingMeshes!.push(bat.solid);
      if (bat.car) this.player.collider.surroundingMeshes!.push(bat.car.solid);
    }
    const smModel = smP ? await smP : null;
    if (smModel) {
      this.ice = new IceFx(scene, (name, at, vol) => this.audio.play(name, { x: at.x, y: at.y, z: at.z, volume: vol }));
      const sm = (this.sm = await Superman.create(
        {
          scene,
          nav: this.level.nav,
          audio: this.audio,
          player: this.player,
          foe: () => game.foeFor(game.sm),
          foes: () => this.foesUp(),
          air: () => this.air?.up ?? [],
          soldiers: () => this.enemies.enemies,
          team: this.team,
          ice: this.ice,
          bounds: this.level.bounds,
          dust: (pos, power) => this.explosions.slam(pos, power),
          slam: (pos, power) => {
            this.explosions.slam(pos, power);
            const fy = this.level.nav.floorAt(pos.x, pos.y + 0.5, pos.z, 1.5);
            if (fy !== null) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), 1.6 * power);
          },
          scorch: (pos) => {
            const fy = this.level.nav.floorAt(pos.x, pos.y + 0.5, pos.z, 1);
            if (fy !== null && Math.abs(fy - pos.y) < 0.6) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), 0.4);
          },
        },
        smModel,
      ));
      for (const m of sm.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
    }
    const squadModels = squadP ? await squadP : null;
    if (squadModels) {
      const fx = (this.heroFx = { bolts: new Bolts(scene), lightning: new Lightning(scene), rings: new ShockRing(scene), glow: new SpriteStream(scene, "heroGlow", 900, true), smoke: new SpriteStream(scene, "heroSmoke", 400, false) });
      const host: RosterHost & { gunTpl?: { mesh: Mesh; len: number } } = {
        scene,
        nav: this.level.nav,
        audio: this.audio,
        player: this.player,
        foe: (me) => game.foeFor(me),
        soldiers: () => this.enemies.enemies,
        air: () => this.air?.up ?? [],
        team: this.team,
        heroes: () => this.heroesUp(),
        ...fx,
        dust: (pos, power) => this.explosions.slam(pos, power),
        slam: (pos, power) => {
          this.explosions.slam(pos, power);
          const fy = this.level.nav.floorAt(pos.x, pos.y + 0.5, pos.z, 1.5);
          if (fy !== null) this.explosions.scorch(new Vector3(pos.x, fy, pos.z), Vector3.Up(), 0.55 * power);
        },
        spark: (pos, n) => this.fx.impact(pos, n, "metal", false),
        blast: (pos, radius, damage) => this.heroBlast(pos, radius, damage),
        bounds: this.level.bounds,
        gunTpl: dpModel ? { mesh: dpModel.gun, len: dpModel.muzzle } : undefined,
        card: (t, sub, secs) => this.hulk?.hud.card(t, sub, secs),
        sky: (k) => (this.skyWant = k),
      };
      for (const r of squadModels) {
        if (!r) continue;
        const [id, model] = r;
        const hero = await RosterHero.create(host, byId(id)!, ALL_KITS[id], model).catch((e) => (console.warn(id + " failed to set up", e), null));
        if (!hero) continue;
        this.squad.push(hero);
        for (const m of hero.rig.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
        this.director.register(id, () => hero, 0.5);
        this.squadBars.set(hero, this.allyBar("ally-hud-" + id, hero.def.name, hero.kit.color));
      }
      const villainModels = villainP ? await villainP : null;
      const vhost: VillainHost = {
        ...host,
        foe: () => null,
        team: this.villainTeam,
        heroes: () => this.villainsUp(),
        // (a villain's blast is on the villains' terms: you and the heroes)
        blast: (pos, radius, damage) => this.villainBlast(pos, radius, damage),
        targets: (me) => this.targetsOf(me as RosterVillain),
        guards: (at, n) => this.callGuards(at, n),
        rival: (me) => this.rivalOf(me),
        onDefeated: (me) => {
          // (the final boss: the result says who fell)
          if (me.def.tier === "final-boss") {
            this.stats.title = `${me.def.name} DEFEATED`;
            this.stats.kicker = "THE PLAYGROUND HOLDS";
          }
          this.stats.kills++;
          this.hud.kill(false);
          this.audio.play("killConfirm", { volume: 0.5 });
        },
      };
      for (const r of villainModels ?? []) {
        if (!r) continue;
        const [id, model] = r;
        const v = await RosterVillain.createVillain(vhost, byId(id)!, ALL_KITS[id], model).catch((e) => (console.warn(id + " failed to set up", e), null));
        if (!v) continue;
        v.setPlayer(this.player);
        this.villains.push(v);
        for (const m of v.rig.meshes) this.env.shadows.getShadowMap()!.renderList!.push(m);
        this.player.collider.surroundingMeshes!.push(v.solid);
        this.director.register(id, () => v, 0.8);
      }
    }
    if (this.heroStage) {
      this.air = await AirForce.load({
        scene,
        nav: this.level.nav,
        audio: this.audio,
        player: this.player,
        allies,
        blast: (pos, radius, damage) => this.airBlast(pos, radius, damage),
        tracer: (a, b) => this.fx.tracer(a, b),
        fireball: (pos, power) => {
          this.explosions.rocket(pos, Vector3.Up(), false);
          if (power > 1) this.explosions.rocket(pos.add(new Vector3(0.8, 0.5, -0.6)), Vector3.Up(), false);
          this.audio.play("rocketBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 1.2, rate: 0.7, reverb: 1.4 });
        },
        bounds: this.level.bounds,
      }).catch((e) => (console.warn("aircraft failed to load", e), undefined));
    }
    let sandstorm: Mission | undefined;
    if (info.id === "dust2" && hostageP && lockersP) {
      const objText = document.getElementById("obj-text")!;
      const hostage = (this.hostage = (await hostageP).place(scene, hostageSpot(this.level.nav), DUST.hostageYaw, () => sandstorm?.hostageKilled()));
      const L = DUST.lockers;
      const lockers = (await lockersP).place(scene, L.at, L.yaw, L.count, LOCKER_W, LOCKER_D);
      // the west gate: it stops sight and bullets too (alongside the doors)
      const gate = new Gate(scene, this.level.nav, DUST.gate);
      const doorRay = this.level.nav.extraBlock;
      this.level.nav.extraBlock = (ox, oy, oz, dx, dy, dz, len) => {
        const a = doorRay ? doorRay(ox, oy, oz, dx, dy, dz, len) : -1;
        const b = gate.blockRay(ox, oy, oz, dx, dy, dz, len);
        return a < 0 ? b : b < 0 ? a : Math.min(a, b);
      };
      this.mission = sandstorm = new Mission(
        {
          scene,
          camera: this.player.camera,
          player: this.player,
          enemies: this.enemies,
          nav: this.level.nav,
          audio: this.audio,
          input: this.input,
          hostage,
          lockers,
          gate,
          showHud: (on) => this.hud.show(on),
          showWeapon: (on) => this.weapons.viewmodel.base.setEnabled(on),
          setObjective: (t) => (objText.textContent = t),
          setTimeScale: (k) => (this.timeScale = k),
          respawn: (at, yaw) => this.player.reset(at, yaw),
          flash: (t) => this.hud.flashPrompt(t),
          finish: (won, title, kicker) => {
            this.stats.title = title;
            this.stats.kicker = kicker;
            if (!won) this.player.invulnerable = false;
            this.setState(won ? "won" : "dead");
          },
        },
        SANDSTORM,
      );
      // the objective on the radar and the map; the hostage's yard once you know it
      this.minimap.objective = () => this.mission?.marker ?? null;
      this.minimap.known = () => (this.mission?.knowsWhere ? [{ pos: hostage.position, label: SANDSTORM.hostage.short.toUpperCase() }] : []);
      for (const m of [hostage.solid, ...gate.colliders]) {
        this.player.collider.surroundingMeshes!.push(m);
        for (const e of this.enemies.enemies) e.collider.surroundingMeshes?.push(m);
      }
    }
    if (info.id === "office" && stationP) {
      // the Betamax deck and the Commodore, on a desk of their own in the middle of an office
      const S = OFFICE_STATION;
      const station = (await stationP).place(scene, S.at, S.yaw);
      station.setVolume(this.settings.volume ?? 1, !!this.settings.muted);
      // (the soldiers' routes go round the desk)
      const hw = Math.abs(Math.sin(S.yaw)) > 0.5 ? [S.d / 2, S.w / 2] : [S.w / 2, S.d / 2];
      this.level.nav.cutLinks(S.at.x - hw[0], S.at.z - hw[1], S.at.x + hw[0], S.at.z + hw[1]);
      const objText = document.getElementById("obj-text")!;
      this.mission = new TapeMission({
        scene,
        camera: this.player.camera,
        player: this.player,
        enemies: this.enemies,
        nav: this.level.nav,
        audio: this.audio,
        input: this.input,
        station,
        showHud: (on) => this.hud.show(on),
        showWeapon: (on) => this.weapons.viewmodel.base.setEnabled(on),
        setObjective: (t) => (objText.textContent = t),
        flash: (t) => this.hud.flashPrompt(t),
        finish: (won, title, kicker) => {
          this.stats.title = title;
          this.stats.kicker = kicker;
          this.setState(won ? "won" : "dead");
        },
      });
      this.station = station;
      this.minimap.objective = () => this.mission?.marker ?? null;
      this.minimap.known = () => [{ pos: station.deskFront, label: "BETAMAX DECK" }];
      this.player.collider.surroundingMeshes!.push(station.solid);
      for (const e of this.enemies.enemies) e.collider.surroundingMeshes?.push(station.solid);
    }
    if (info.id === "metro") {
      const objText = document.getElementById("obj-text")!;
      this.mission = new MetroMission({
        scene,
        camera: this.player.camera,
        player: this.player,
        enemies: this.enemies,
        nav: this.level.nav,
        audio: this.audio,
        showHud: (on) => this.hud.show(on),
        showWeapon: (on) => this.weapons.viewmodel.base.setEnabled(on),
        setObjective: (t) => (objText.textContent = t),
        setTimeScale: (k) => (this.timeScale = k),
        flash: (t) => this.hud.flashPrompt(t),
        finish: (won, title, kicker) => {
          this.stats.title = title;
          this.stats.kicker = kicker;
          this.setState(won ? "won" : "dead");
        },
      });
      this.minimap.objective = () => this.mission?.marker ?? null;
      this.minimap.known = () => [];
    }
    this.player.onDamaged = (amount, rel) => {
      this.stats.damageTaken += amount;
      this.fx.playerBleed(this.player.feet, amount > 12);
      this.hud.damage(amount, rel, this.player.health / PLAYER.maxHealth);
    };
    this.player.onFallDamage = (amount) => {
      this.stats.damageTaken += amount;
      this.hud.fallDamage(Math.max(amount, 10));
    };
    this.player.onDeath = () => {
      this.endTimer = 1.6;
      this.weapons.viewmodel.setActive(null);
    };

    // the heroes' panels: one column (bottom left, wrapping into a second as more of them arrive)
    const hudEl = document.getElementById("hud");
    if (hudEl && this.heroStage) {
      const stack = document.getElementById("ally-stack") ?? document.createElement("div");
      stack.id = "ally-stack";
      hudEl.appendChild(stack);
      for (const el of Array.from(hudEl.querySelectorAll(':scope > [id^="ally-hud"]'))) stack.appendChild(el);
      // (and the foes' bars: one column at the top — Wolverine's, Batman's, the villains')
      const bosses = document.getElementById("boss-stack") ?? document.createElement("div");
      bosses.id = "boss-stack";
      hudEl.appendChild(bosses);
      for (const el of Array.from(hudEl.querySelectorAll(":scope > .wolv-boss"))) bosses.insertBefore(el, bosses.firstChild);
    }

    this.setupCulling();

    // perf overlay: always available in dev builds, and in any build while developer mode is on
    this.debug = new DebugOverlay(this.engine, scene);
    this.dev.setEnabled(!!this.settings.devMode);

    progress(0.82, "Compiling shaders");
    scene.blockMaterialDirtyMechanism = false;
    this.resetRound();
    await this.warmup();
    this.mats.freezeStatic();
    this.freezeCharacterMaterials();
    progress(1, "Ready");

    this.engine.runRenderLoop(() => this.frame());
    this.setState("ready");
  }

  /** Arms template + every glTF gun (+ the Vector's own viewmodel and the flashbang), downloaded in parallel. */
  private async loadWeaponRigs(progress: (p: number) => void) {
    const ids = Object.keys(GUNS) as WeaponId[];
    const parts = new Array(ids.length + 5).fill(0);
    const report = () => progress(parts.reduce((a, b) => a + b, 0) / parts.length);
    const n = ids.length;
    const [tpl, vecC, flashC, lethal, knifeC, ...gunContainers] = await Promise.all([
      loadArmsTemplate(this.scene, (p) => ((parts[0] = p), report())),
      loadVectorContainer(this.scene, (p) => ((parts[n + 1] = p), report())),
      loadFlashbangContainer(this.scene, (p) => ((parts[n + 2] = p), report())),
      loadGrenadeSet(this.scene, (p) => ((parts[n + 3] = p), report())),
      loadKnifeFPContainer(this.scene, (p) => ((parts[n + 4] = p), report())),
      ...ids.map((id, i) => loadGunContainer(this.scene, GUNS[id]!, (p) => ((parts[i + 1] = p), report()))),
    ]);
    const rigs: Partial<Record<WeaponId, WeaponRig>> = { rifle: buildArmsRig(this.scene, tpl, "rifle", null, null) };
    ids.forEach((id, i) => (rigs[id] = buildArmsRig(this.scene, tpl, id, GUNS[id]!, gunContainers[i])));
    rigs.vector = buildVectorRig(this.scene, vecC);
    const g = buildGrenadeRig(this.scene, tpl, flashC, lethal);
    rigs.flashbang = g.rig;
    rigs.knife = buildKnifeRigFP(this.scene, knifeC);
    this.nadeTpls = g.parts.projectiles;
    return rigs;
  }

  // ------------------------------------------------------------------ flashbang
  private losClear = (from: Vector3, to: Vector3) => {
    const r = this.losRay;
    r.origin.copyFrom(from);
    to.subtractToRef(from, r.direction);
    const len = r.direction.length();
    if (len < 1e-3) return true;
    r.direction.scaleInPlace(1 / len);
    r.length = len - 0.05;
    const hit = this.scene.pickWithRay(r, (m) => m.metadata?.kind === HitKind.Level && m.isPickable, true);
    return !hit?.hit;
  };

  /** how much of a blast at `pos` the player actually sees (0..1): distance, facing, cover */
  private blastVisibility(pos: Vector3) {
    const eye = this.player.camera.position;
    const d = Vector3.Distance(eye, pos);
    const fwd = this.player.camera.getDirection(Vector3.Forward());
    const facing = Math.max(0, Vector3.Dot(fwd, pos.subtract(eye).normalize()));
    const los = d < 2 || this.losClear(pos.add(new Vector3(0, 0.3, 0)), eye);
    return { d, facing, los };
  }

  /** a rocket went off: the blast, plus extra damage to the soldier it struck */
  private onRocket(b: RocketBlast) {
    if (b.direct && b.direct.alive && b.directPoint) {
      const dir = b.directPoint.subtract(b.pos).normalize();
      const killed = b.direct.applyHit(b.cfg.direct, "torso", dir, b.directPoint);
      this.hud.hit("body", killed);
      this.weapons.shotsHit++;
    }
    this.blast(b.pos, b.normal, b.cfg.radius, b.cfg.damage, "rocket");
  }

  /** shared high-explosive blast (frag grenade, rocket): FX, sound, damage with cover, shake, deafening */
  private blast(pos: Vector3, normal: Vector3, radius: number, damage: number, kind: "frag" | "plasma" | "rocket", stuckTo?: Detonation["stuckTo"]) {
    // on the drawn ground, not the collision voxels under it (up to 12.5 cm lower: a scorch there is
    // buried under the snow); and is that ground snow?
    let snow = false;
    let surfaceY: number | null = null;
    if (normal.y > 0.6 && this.level.surfaceAt) {
      const s = this.level.surfaceAt(pos.x, pos.y + 0.3, pos.z);
      if (s && Math.abs(s.y - pos.y) < 0.6) {
        surfaceY = s.y;
        snow = s.snow;
        if (pos.y < s.y + 0.05) pos = new Vector3(pos.x, s.y + 0.05, pos.z);
      }
    }
    const v = this.blastVisibility(pos);
    const near = Math.max(0, 1 - v.d / 30);
    if (kind === "plasma") {
      this.explosions.plasma(pos);
      this.audio.play("plasmaBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 1.0, reverb: 1.0 });
    } else {
      if (kind === "rocket") {
        this.explosions.rocket(pos, normal, snow);
        // burning scraps left where it hit
        const f = this.explosions.ignite(pos.add(new Vector3(0, -0.1, 0)), 1.6, 3.5);
        f.sound = this.audio.playLoop("fireLoop", { x: pos.x, y: pos.y + 0.3, z: pos.z, volume: 0.45 });
      } else this.explosions.frag(pos, snow);
      if (kind === "rocket") this.audio.play("rocketBlast", { x: pos.x, y: pos.y, z: pos.z, volume: 1.0, reverb: 1.4, pitchVar: 0.03 });
      else this.audio.play("fragBoom", { x: pos.x, y: pos.y, z: pos.z, volume: 1.0, reverb: 1.3, pitchVar: 0.04 });
    }
    // blast mark on the surface it went off against (floor or wall); a grenade in mid-air leaves none
    const surf = kind === "rocket" ? pos.subtract(normal.scale(0.15)) : pos;
    const floor = kind === "rocket" ? null : surfaceY ?? this.level.nav.floorAt(pos.x, pos.y, pos.z, 0.6);
    if (kind === "rocket") this.explosions.scorch(surfaceY !== null ? new Vector3(pos.x, surfaceY, pos.z) : surf, normal, normal.y > 0.6 ? 1.6 : 0.9);
    else if (floor !== null) this.explosions.scorch(new Vector3(pos.x, floor, pos.z), Vector3.Up(), kind === "plasma" ? 0.7 : 0.95);
    this.glass?.blast(pos, radius);
    this.doors?.blast(pos, radius);
    const res = this.enemies.explosion(pos, radius, damage, this.losClear, stuckTo);
    if (this.hostage?.inBlast(pos, radius)) this.hostage.applyHit();
    for (const u of this.air?.up ?? []) if (u.inBlast(pos, radius)) u.applyHit(damage * 1.5, "torso", Vector3.Up(), pos, { kind: "blast" });
    for (const vl of this.villains) {
      if (!vl.inBlast(pos, radius)) continue;
      const d = Vector3.Distance(pos, vl.center());
      vl.applyHit(damage * Math.max(0.25, 1 - d / (radius + 1)), "torso", vl.p.subtract(pos).normalize(), pos, { kind: "blast", force: d < radius * 0.5 ? 2 : 0 });
      res.hits++;
    }
    if (this.bat?.inBlast(pos, radius)) {
      const d = Vector3.Distance(pos, this.bat.position.add(new Vector3(0, 1, 0)));
      this.bat.applyHit(damage * Math.max(0.25, 1 - d / (radius + 1)), "torso", this.bat.position.subtract(pos).normalize(), pos, { kind: "blast", force: d < radius * 0.5 ? 2 : 0 });
    }
    if (this.wolv?.inBlast(pos, radius)) {
      const d = Vector3.Distance(pos, this.wolv.position.add(new Vector3(0, 1, 0)));
      this.wolv.applyHit(damage * Math.max(0.25, 1 - d / (radius + 1)), "torso", this.wolv.position.subtract(pos).normalize(), pos, { kind: "blast", force: d < radius * 0.5 ? 2 : 0 });
    }
    if (this.hulk?.inBlast(pos, radius)) {
      const d = Vector3.Distance(pos, this.hulk.position.add(new Vector3(0, 1.3, 0)));
      this.hulk.applyHit(damage * Math.max(0.25, 1 - d / (radius + 1)), "torso", this.hulk.position.subtract(pos).normalize(), pos, { kind: "blast" });
      res.hits++;
    }
    if (res.hits) {
      this.hud.hit("body", res.kills > 0);
      this.audio.play("hitMarker", { volume: 0.32 });
    }
    // the player is not immune to his own explosives
    if (this.player.alive && v.d < radius && (v.d < 1.2 || v.los)) {
      const k = Math.pow(1 - v.d / radius, 1.35);
      if (k * damage * 0.8 > 2) this.player.takeDamage(damage * 0.8 * k, pos);
    }
    this.player.shake(Math.min(1, (kind === "rocket" ? 1.7 : 1.25) * near * near + (v.d < (kind === "rocket" ? 12 : 8) ? 0.3 : 0)));
    if (v.d < 7) this.audio.deafen(0.55 * (1 - v.d / 7), 0.8 + 2.2 * (1 - v.d / 7));
    this.expoKick = Math.max(this.expoKick, 0.85 * near * (0.35 + 0.65 * v.facing) * (v.los ? 1 : 0.25));
    this.enemies.onPlayerShot(pos, 1.6);
  }

  private onDetonate(det: Detonation) {
    const { type, pos, normal } = det;
    if (type === "flash") {
      this.onFlashbang(pos);
      return;
    }
    const spec = GRENADE_TYPES[type];
    const v = this.blastVisibility(pos);
    const near = Math.max(0, 1 - v.d / 30);
    if (type === "flame") {
      this.audio.play("fireIgnite", { x: pos.x, y: pos.y, z: pos.z, volume: 0.9, reverb: 0.6 });
      const f = this.explosions.ignite(pos, spec.radius, 7.5);
      f.sound = this.audio.playLoop("fireLoop", { x: pos.x, y: pos.y + 0.3, z: pos.z, volume: 0.75 });
      this.player.shake(0.15 * near);
      this.expoKick = Math.max(this.expoKick, 0.35 * v.facing * near * (v.los ? 1 : 0.3));
      this.enemies.onPlayerShot(pos, 1.4);
      return;
    }
    // frag / plasma: the big ones
    this.blast(pos, normal, spec.radius, spec.damage, type, det.stuckTo);
  }

  private onFlashbang(at: Vector3) {
    // the flash comes from just above the canister (a kerb or the floor itself shouldn't hide it)
    const pos = at.add(new Vector3(0, 0.25, 0));
    this.enemies.flashbang(pos, this.losClear);
    // player exposure: distance × facing × line of sight (a wall still lets some light round the corner)
    const eye = this.player.camera.position;
    const d = Vector3.Distance(eye, pos);
    if (d > 24 || !this.player.alive) return;
    const los = d < 1.5 || this.losClear(pos, eye);
    const fwd = this.player.camera.getDirection(Vector3.Forward());
    const to = pos.subtract(eye).normalize();
    const dot = Vector3.Dot(fwd, to);
    const facing = 0.18 + 0.82 * Math.min(1, Math.max(0, (dot + 0.25) / 1.0));
    const dist = d < 3 ? 1 : Math.max(0, 1 - (d - 3) / 19);
    const amount = dist * (los ? facing : d < 6 ? 0.12 : 0) * (this.dev.godOn ? 0.35 : 1);
    if (amount > 0.04) {
      this.flash.amount = Math.max(this.flash.amount, Math.min(1, amount * 1.15));
      this.flash.hold = Math.max(this.flash.hold, 0.6 + amount * 2.6);
      this.audio.deafen(amount, 0.8 + amount * 4);
    }
    // the bang shakes the view even when you look away
    this.player.addRecoil(-0.6 * dist, (Math.random() - 0.5) * dist, 1, 6, 0.4 * dist);
  }

  /** Render a few frames with every effect visible so no shader compiles on the first shot. */
  private async warmup() {
    await this.scene.whenReadyAsync();
    const cam = this.player.camera;
    const fwd = cam.getDirection(Vector3.Forward());
    const at = cam.position.add(fwd.scale(3));
    this.fx.warmup(at, fwd.scale(-1));
    this.grenades.warmup(at);
    this.explosions.warmup(at);
    this.rockets.warmup(at);
    this.prints?.warmup(at);
    for (const w of this.weapons.weapons) {
      this.weapons.viewmodel.setActive(w.rig);
      w.rig.root.setEnabled(true);
      for (let i = 0; i < 2; i++) {
        this.scene.render();
        await tick();
      }
    }
    await this.scene.whenReadyAsync();
    for (let i = 0; i < 3; i++) {
      this.scene.render();
      await tick();
    }
    this.fx.reset();
    this.grenades.reset();
    this.explosions.reset();
    this.rockets.reset();
    this.prints?.reset();
    this.weapons.viewmodel.setActive(null);
  }

  private resetRound() {
    const sp = this.level.playerSpawn;
    this.audio.stopAll();
    this.fx.reset();
    this.grenades?.reset();
    this.explosions?.reset();
    this.rockets?.reset();
    this.glass?.reset();
    this.prints?.reset();
    this.pickups?.reset();
    this.drops = [];
    this.doors?.reset();
    this.expoKick = 0;
    this.flash.amount = this.flash.hold = 0;
    this.hud?.setFlash(0);
    this.audio.deafen(0, 0);
    this.enemies.reset();
    this.hulk?.reset();
    this.hulkDue = -1;
    for (const el of this.allyBars) el.style.display = "none";
    this.player.reset(sp.pos, sp.yaw);
    this.spidey?.hide();
    this.spideyDue = -1;
    this.iron?.reset();
    this.ironDue = -1;
    this.dp?.reset();
    this.dpDue = -1;
    this.dpCame = false;
    this.wolv?.reset();
    this.wolvDue = -1;
    this.bat?.reset();
    this.batDue = -1;
    this.sm?.reset();
    this.smDue = -1;
    for (const h of this.squad) h.reset();
    for (const v of this.villains) v.reset();
    if (this.heroStage) {
      const o = document.getElementById("obj-text");
      if (o) o.textContent = stageInfo(this.settings.stage).objective;
    }
    this.everIn.clear();
    this.stageClock = 0;
    this.skyWant = this.skyK = 0;
    if (this.skyBase) this.applySky(0);
    this.villainDue.clear();
    this.squadDue.clear();
    this.heroFx?.bolts.reset();
    this.heroFx?.lightning.reset();
    this.heroFx?.rings.reset();
    this.heroFx?.glow.reset();
    this.heroFx?.smoke.reset();
    this.air?.reset();
    this.ice?.reset();
    this.foeOf.clear();
    this.ironLanded = false;
    this.team.reset();
    if (this.allyCineOn) {
      this.hulk?.hud.letterbox(false, false);
      if (this.cineFov > 0) this.player.camera.fov = this.cineFov;
      this.weapons.viewmodel.base.setEnabled(true);
      this.scene.activeCamera = this.player.camera;
    }
    this.allyCineOn = false;
    this.weapons.reset();
    this.hud.reset();
    this.hud.setHostiles(this.enemies.awakeCount);
    this.reinforceQ = 0;
    this.reinforceT = 0;
    this.heroesIn.clear();
    this.stats = { time: 0, total: this.baseSoldiers(), kills: 0, headshots: 0, accuracy: 0, damageTaken: 0 };
    this.endTimer = -1;
    this.timeScale = 1;
    this.weapons.viewmodel.base.setEnabled(true);
  }

  // ------------------------------------------------------------------ flow
  begin() {
    this.audio.resume();
    this.audio.startAmbience(stageInfo(this.settings.stage).ambience);
    this.audio.startMusic();
    this.input.enabled = true;
    this.hud.show(true);
    this.setState("playing");
    this.mission?.start();
  }

  pause() {
    if (this.state === "playing") this.setState("paused");
  }
  resume() {
    if (this.state === "paused") this.setState("playing");
  }

  /** a mission's last checkpoint, if it has one ("CHECKPOINT 2") */
  get checkpoint() {
    const s = this.mission?.save;
    return s ? `CHECKPOINT ${s.n}` : null;
  }

  /** play again: from the start, or (`fromCheckpoint`) from the mission's last checkpoint */
  restart(fromCheckpoint = false) {
    this.resetRound();
    // (a mission's ending cinematic hid the HUD — and with it every USE prompt)
    this.hud.show(true);
    this.input.clearAll();
    this.setState("playing");
    if (fromCheckpoint && this.mission?.save) {
      this.mission.resume();
      this.hud.setHostiles(this.enemies.awakeCount);
    } else this.mission?.reset();
  }

  setMuted(on: boolean) {
    this.settings.muted = on;
    this.audio?.setMuted(on);
    this.station?.setVolume(this.settings.volume ?? 1, on);
  }

  setDevMode(on: boolean) {
    this.settings.devMode = on;
    this.dev.setEnabled(on);
    if (!on) {
      // developer mode off: its options with it (god mode, all weapons — the rest DevMode resets)
      if (this.player) this.player.invulnerable = false;
      this.setGod(false);
      this.setArsenal(false);
    }
  }
  /** EASY / MEDIUM / HARD — mid-mission too: the soldiers already up keep their share of health, at the new scale */
  setDifficulty(d: Difficulty) {
    const before = difficulty.k.enemyHealth;
    difficulty.set(d);
    const f = difficulty.k.enemyHealth / before;
    if (f !== 1 && this.enemies) for (const e of this.enemies.enemies) if (e.alive) e.health = Math.max(1, e.health * f);
  }
  /** god mode (a developer option: only while developer mode is on) */
  setGod(on: boolean) {
    on = on && this.dev.enabled;
    const was = this.dev.godOn;
    this.dev.god = on;
    if (this.player) {
      this.player.invulnerable = on;
      if (on && !was && this.player.alive) this.player.health = PLAYER.maxHealth;
    }
    if (on !== was) this.cb.onSettingChange?.("god", on);
  }
  /** every weapon carried (a developer option: only while developer mode is on) */
  setArsenal(on: boolean) {
    on = on && this.dev.enabled;
    if (!this.weapons || this.weapons.arsenal === on) return;
    this.weapons.setArsenal(on);
    this.cb.onSettingChange?.("arsenal", on);
  }

  setFov(v: number) {
    this.settings.fov = v;
    if (this.player) this.player.baseFov = v;
  }

  setSensitivity(v: number) {
    this.settings.sensitivity = v;
    if (this.player) this.player.userSensitivity = v;
  }

  private setState(s: GameState) {
    this.state = s;
    this.audio?.setAmbienceActive(s === "playing");
    // (every screen that isn't the fight itself — pause, results, loading — is a menu: the game world,
    // its wind and its score fall silent there and the menu music plays; the results fade out gently)
    this.audio?.setPaused(s !== "playing", s === "dead" || s === "won" ? 0.6 : 0.05);
    if (this.mission instanceof TapeMission) this.mission.setPaused(s === "paused");
    if (s === "dead" || s === "won") {
      // the mission's subtitles / bars don't belong on the results screen
      this.mission?.hud.reset();
      this.hulk?.hud.reset();
      this.stats.accuracy = this.weapons.shotsFired ? this.weapons.shotsHit / this.weapons.shotsFired : 0;
    }
    this.cb.onStateChange(s, this.stats);
  }

  // ------------------------------------------------------------------ frame
  private frame() {
    const rawDt = this.engine.getDeltaTime() / 1000;
    this.step(rawDt);
    this.scene.render();
    this.input.endFrame();
  }

  /** One simulation step (no rendering). Also used by automated tests. */
  step(rawDt: number) {
    const dev = this.dev;
    const dt = Math.min(rawDt, 1 / 20) * dev.timeScale * this.timeScale;
    const inp = this.input;

    if (inp.wasPressed("F3") && (DEBUG_ENABLED || dev.enabled)) this.debug?.toggle();
    if (inp.hit("sound")) {
      this.setMuted(!this.audio.muted);
      this.cb.onSettingChange?.("muted", this.audio.muted);
    }
    if (inp.wasPressed("Backquote")) {
      this.setDevMode(!dev.enabled);
      this.cb.onSettingChange?.("devMode", dev.enabled);
    }
    if (dev.enabled && this.state === "playing") this.devHotkeys();
    // the developer on/off switches by key: god mode (H) and the whole arsenal (L) — developer mode only
    if (this.state === "playing" && (inp.hit("godMode") || inp.hit("arsenal"))) {
      if (!dev.enabled) this.hud.flashPrompt("DEVELOPER MODE IS OFF · TURN IT ON IN SETTINGS OR CONTROLS");
      else if (inp.hit("godMode")) {
        this.setGod(!dev.godOn);
        this.hud.flashPrompt(`GOD MODE ${dev.godOn ? "ON" : "OFF"}`);
      } else {
        this.setArsenal(!this.weapons.arsenal);
        this.hud.flashPrompt(this.weapons.arsenal ? "ALL WEAPONS ON · PRESS A SLOT KEY AGAIN FOR THE NEXT GUN" : "ALL WEAPONS OFF");
      }
    }
    this.cheatTags();
    // (anyone, dev mode or not: the whole line-up in at once on the Playground — J the heroes, O the villains)
    if (this.heroStage && this.state === "playing") {
      if (inp.hit("allHeroes")) this.launchAll("heroes");
      if (inp.hit("allVillains")) this.launchAll("villains");
    }
    if (inp.hit("map") && this.state === "playing") {
      this.minimap.setFull(!this.minimap.fullOpen);
      document.getElementById("fullmap-hint")!.textContent = `${bindings.label("map")} · CLOSE MAP`;
    }
    if (this.state !== "playing" && this.minimap?.fullOpen) this.minimap.setFull(false);
    this.applyDevCheats();
    // a cinematic: you're a spectator and nobody shoots
    const allyCine = this.director.active;
    const cine = (!!this.mission?.cinematic || !!this.hulk?.cinematic || allyCine) && this.state === "playing";
    if ((this.mission?.freezeHostiles || this.hulk?.cinematic || allyCine) && this.state === "playing")
      // (Frostline's tape: they stand stock still while it plays, mid-fight or not, then carry on)
      this.enemies.aiMode = this.mission instanceof TapeMission && this.mission.holdStill ? "FROZEN" : "PASSIVE";
    if (this.state === "playing") this.allyCinematic(allyCine, dt);

    // effects tick first so anything spawned this frame is rendered at least once
    this.fx.update(dt);
    this.mats.update(dt);
    if (this.state !== "paused") {
      this.grenades.update(dt);
      this.rockets.update(dt);
      this.doors?.update(dt);
      this.glass?.update(dt);
      this.prints?.update(dt);
      this.explosions.update(dt);
      this.updateFires(dt);
    }
    this.expoKick = Math.max(0, this.expoKick - dt * 4.5);
    this.scene.imageProcessingConfiguration.exposure = (this.settings.stage === "whiteout" ? 0.92 : this.settings.stage === "kestrel" ? 1.22 : 1.05) + this.expoKick;
    this.snowfall?.update(dt);

    const playing = this.state === "playing" || this.state === "dead" || this.state === "won";
    if (playing && this.state !== "won") {
      this.stats.time += this.state === "playing" ? dt : 0;
      if (!cine) {
        this.player.update(dt, this.weapons.modifiers());
        // (knocked flat: no shooting till you're back up)
        if (this.player.alive && !this.player.knockedDown) this.weapons.update(dt);
      }
      if (this.state === "playing" && !cine) {
        this.updateBleeding(dt);
        this.playerPrints(dt);
      }
      // a gun to pick up beats a door: what's under the crosshair, within reach
      const looking = this.player.alive && this.state === "playing" && !cine && !this.mission?.prompt;
      const eye = this.player.camera.position, fwd = this.player.camera.getDirection(Vector3.Forward());
      this.lookPickup = looking ? this.pickups.lookAt(eye, fwd) : null;
      this.lookDoor = !this.lookPickup && this.doors && looking ? this.doors.lookAt(eye, fwd) : null;
      if (inp.hit("use") && looking) {
        if (this.lookPickup) this.takeWeapon(this.lookPickup);
        else if (this.lookDoor) this.doors!.toggle(this.lookDoor, this.player.feet.clone());
      }
      if (looking) this.walkOverPickups();
      this.updateDrops(dt);
      this.physics.step(dt);
      this.enemies.update(dt);
      if (this.hulk && this.state === "playing") {
        if (this.hulkDue >= 0) {
          this.hulkDue -= dt;
          // (no open ground in sight right now: try again in a moment)
          if (this.hulkDue < 0 && !this.hulk.enter()) this.hulkDue = 1;
        }
        this.lodStep(this.hulk, this.hulk.position, dt, (d) => this.hulk!.update(d), this.hulk.cinematic);
      }
      if (this.spidey && this.state === "playing") {
        // 45 s after the Hulk has landed and roared, Spider-Man is found lounging on a container
        if (!this.spidey.active && this.hulk?.alive && !this.hulk.cinematic && this.hulk.state !== "dormant") {
          if (this.spideyDue < 0) this.spideyDue = 45;
          this.spideyDue -= dt * this.lull;
          if (this.spideyDue <= 0) {
            const at = this.spidey.entrySpot(this.player.feet.clone(), this.player.camera.position, this.hulk.position);
            if (at) this.spidey.enter(at, this.player.feet.clone());
            else this.spidey.enter(this.allySpawn(), this.hulk.position.clone());
          }
        }
        this.lodStep(this.spidey, this.spidey.p, dt, (d) => this.spidey!.update(d), this.spidey.cinematic);
      }
      if (this.wolv && this.state === "playing") {
        // 40 s after Spider-Man's in, Wolverine — up on a container, the claws, the leap (against you)
        if (this.wolv.state === "dormant" && this.spidey?.active && !this.spidey.cinematic && !this.allyCineOn && !this.hulk?.cinematic) {
          if (this.wolvDue < 0) this.wolvDue = 40;
          // (everyone else already down: he doesn't keep you waiting)
          if (this.enemies.awakeCount === 0 && !this.foesUp().length) this.wolvDue = Math.min(this.wolvDue, 4);
          this.wolvDue -= dt * this.lull;
          if (this.wolvDue <= 0 && !this.summonWolverine()) this.wolvDue = 1;
        }
        this.lodStep(this.wolv, this.wolv.position, dt, (d) => this.wolv!.update(d), this.wolv.cinematic);
      }
      if (this.iron && this.state === "playing") {
        // 30 s after Wolverine lands (or 45 s after Spider-Man, with no Wolverine), Iron Man out of the sky
        const wolvIn = this.wolv ? this.wolv.state !== "dormant" && !this.wolv.cinematic : !!this.spidey?.active && !this.spidey.cinematic;
        const foes = !!this.hulk?.alive || !!this.wolv?.alive;
        if (!this.iron.active && wolvIn && foes && !this.allyCineOn) {
          if (this.ironDue < 0) this.ironDue = this.wolv ? 30 : 45;
          this.ironDue -= dt * this.lull;
          if (this.ironDue <= 0 && !this.summonIron()) this.ironDue = 1;
        }
        this.lodStep(this.iron, this.iron.p, dt, (d) => this.iron!.update(d), this.iron.cinematic);
      }
      if (this.dp && this.state === "playing") {
        // 45 s after Iron Man: something's banging about inside a shipping container…
        // (counted from Iron Man's landing — the Hulk needn't still be up: there are soldiers too)
        if (this.iron?.active && !this.iron.cinematic) this.ironLanded = true;
        if (!this.dp.active && !this.dpCame && this.ironLanded && !this.allyCineOn) {
          if (this.dpDue < 0) this.dpDue = 30;
          this.dpDue -= dt * this.lull;
          if (this.dpDue <= 0) this.summonDeadpool();
        }
        this.lodStep(this.dp, this.dp.p, dt, (d) => this.dp!.update(d), this.dp.cinematic);
      }
      if (this.bat && this.state === "playing") {
        // 30 s after Deadpool's out: the turbine, the Batmobile — Batman, for the Hulk
        if (this.bat.state === "dormant" && this.dp?.active && !this.dp.cinematic && !this.allyCineOn && !this.hulk?.cinematic) {
          if (this.batDue < 0) this.batDue = 30;
          if (this.enemies.awakeCount === 0 && !this.foesUp().length) this.batDue = Math.min(this.batDue, 4);
          this.batDue -= dt * this.lull;
          if (this.batDue <= 0 && !this.summonBatman()) this.batDue = 1;
        }
        this.lodStep(this.bat, this.bat.position, dt, (d) => this.bat!.update(d), this.bat.cinematic);
      }
      if (this.sm && this.state === "playing") {
        // 25 s after Batman lands: a boom high overhead — Superman
        const batIn = !!this.bat && this.bat.state !== "dormant" && !this.bat.cinematic;
        if (!this.sm.active && batIn && !this.allyCineOn) {
          if (this.smDue < 0) this.smDue = 25;
          this.smDue -= dt * this.lull;
          if (this.smDue <= 0 && !this.summonSuperman()) this.smDue = 1;
        }
        this.lodStep(this.sm, this.sm.p, dt, (d) => this.sm!.update(d), this.sm.cinematic);
      }
      if (this.squad.length && this.state === "playing") this.updateSquad(dt);
      if (this.villains.length && this.state === "playing") this.updateVillains(dt);
      this.ice?.update(dt);
      if (this.hulk) this.reinforcements(dt);
      if (this.air) {
        // the sky's theirs from the Hulk's landing until the last of the big ones is down
        // (from the Hulk's landing until the last of the big foes is down)
        if (this.hulk && this.hulk.state !== "dormant" && !this.hulk.cinematic && !this.foesDone()) this.air.start();
        else if (this.foesDone() && this.hulk?.state !== "dormant") this.air.stop();
        if (!this.allyCineOn || this.sm?.cinematic) this.air.update(dt);
        this.antiAir(dt);
      }
      this.team.update(dt);
      // (the Playground: the last of the line-up in, nobody left standing against you — that's the win)
      if (this.heroStage && this.state === "playing" && this.endTimer < 0 && this.enemies.awakeCount === 0 && this.foesDone() && this.allArrived() && !this.allyCineOn && this.reinforceQ <= 0) this.endTimer = 3;
      // soldiers woken by the mission show up in the count
      if (this.mission) this.hud.setHostiles(this.enemies.awakeCount);
      else if (this.hulk) this.hud.setHostiles(this.enemies.awakeCount + (this.hulk.alive && !this.hulk.ally ? 1 : 0) + (this.wolv?.alive ? 1 : 0) + (this.bat?.alive ? 1 : 0) + this.villains.filter((v) => v.alive).length);
      if (this.state === "playing") this.mission?.update(dt, Math.min(rawDt, 1 / 20));
    } else if (this.state === "won") {
      this.player.update(dt, this.weapons.modifiers());
      this.weapons.update(dt);
      // the heroes carry on behind the result: Iron Man's last line, and off into the sky
      this.spidey?.update(dt);
      this.iron?.update(dt);
      this.dp?.update(dt);
      this.wolv?.update(dt);
      this.bat?.update(dt);
      this.sm?.update(dt);
      if (this.squad.length) this.updateSquad(dt);
      for (const v of this.villains) v.update(dt);
      this.ice?.update(dt);
      this.air?.update(dt);
      this.team.update(dt);
    }

    if (playing) {
      const cam = this.player.camera;
      const p = cam.position;
      const f = Math.sin(this.player.yaw);
      const g = Math.cos(this.player.yaw);
      this.audio.setListener(p.x, p.y, p.z, f, 0, g);
      this.env.followShadows(this.player.feet);
      if (!cine) this.updateHud(dt);
    }

    if (this.endTimer > 0 && (this.state === "playing" || this.state === "dead")) {
      this.endTimer -= dt;
      // (a hero mid-entrance gets to finish it before the result comes up)
      if (this.endTimer <= 0 && this.player.alive && this.heroStage && (this.allyCineOn || this.director.active)) this.endTimer = 0.5;
      if (this.endTimer <= 0) {
        this.endTimer = -1;
        if (!this.player.alive) this.setState("dead");
        else if (this.enemies.awakeCount === 0 && !this.foesUp().length && (!this.hulk?.alive || this.hulk.ally) && !this.wolvPending() && (!this.heroStage || (this.foesDone() && this.allArrived()))) this.setState("won");
      }
    }

    dev.paused = this.state === "paused";
    dev.update(rawDt, () => {
      const w = this.weapons.weapon;
      const p = this.player;
      const c = p.collider.position;
      return {
        fps: this.engine.getFps(),
        weapon: w.cfg.displayName,
        state: w.state,
        phase: w.state === "reloading" ? (w.reloadPhase?.id ?? "") : "",
        mag: w.mag,
        reserve: w.reserve,
        hp: p.health,
        move: `${p.grounded ? "ground" : "air"}${p.prone ? " prone" : p.crouched ? " crouch" : ""}${Math.abs(p.leanOffset) > 0.02 ? " lean" : ""}${p.sprinting ? " sprint" : ""}${this.weapons.adsT > 0.5 ? " ads" : ""}`,
        pos: `${c.x.toFixed(1)} ${c.y.toFixed(1)} ${c.z.toFixed(1)}`,
        alive: this.enemies.awakeCount,
        ai: Object.entries(this.enemies.stateCounts())
          .map(([k, v]) => `${k.toLowerCase()} ${v}`)
          .join(" · "),
      };
    });

    this.debug?.update(rawDt, () => ({
      enemiesActive: this.enemies.activeCount,
      enemiesAlive: this.enemies.awakeCount,
      aiStates: this.enemies.stateCounts(),
      particles: this.fx.activeParticles,
      voices: this.audio.voiceCount,
      player: `player       hp ${this.player.health.toFixed(0)}  ${this.player.grounded ? "grnd" : "air"}${this.player.crouched ? " crouch" : ""}${this.player.sprinting ? " sprint" : ""}  wpn ${this.weapons.weapon.state}`,
    }));
  }

  /** the player's prints: one per real step length walked (the sound's gait is longer) */
  private printDist = 0;
  private printSide = 1;
  private playerPrints(dt: number) {
    const p = this.player;
    const v = p.velocity;
    const hs = Math.hypot(v.x, v.z);
    if (!this.prints || !p.alive || !p.grounded || p.prone || hs < 0.3) return;
    this.printDist += hs * dt;
    const stepLen = p.sprinting ? 1.05 : p.crouched ? 0.55 : 0.75;
    if (this.printDist < stepLen) return;
    this.printDist = 0;
    this.printSide = -this.printSide;
    const f = p.feet;
    // prints point the way he's moving (strafing too), not where he looks
    this.footprint(f.x, f.y, f.z, Math.atan2(v.x, v.z), this.printSide, p.sprinting ? 1 : 0);
  }
  private printFrom = new Vector3();
  private printTo = new Vector3();
  /** a boot print, only on snow: outdoors (open sky above) on the snow stage */
  private footprint(x: number, y: number, z: number, yaw: number, side: number, run: number) {
    if (!this.prints) return;
    const nav = this.level.nav;
    // soldiers far away: nobody will see those prints
    const c = this.player.collider.position;
    if ((x - c.x) ** 2 + (z - c.z) ** 2 > 40 * 40) return;
    const coarse = nav.floorAt(x, y + 0.2, z, 0.8);
    if (coarse === null) return;
    const surf = this.level.surfaceAt?.(x, coarse, z);
    // only where the ground really is snow (not asphalt, a cleared path or a floor indoors)
    if (surf && !surf.snow) return;
    const floor = surf?.y ?? coarse;
    // a roof, porch or ceiling overhead = not snow
    if (this.level.openSky) {
      if (!this.level.openSky(x, floor, z)) return;
    } else if (nav.rayLevel(this.printFrom.set(x, floor + 0.5, z), this.printTo.set(x, floor + 30, z)) >= 0) return;
    this.prints.step(x, floor, z, yaw, side, run);
  }

  // ------------------------------------------------------------------ pickups
  private takeWeapon(p: Pickup) {
    const r = this.weapons.pickUp(p.id!, p.mag, p.reserve);
    if (!r.took) {
      this.hud.flashPrompt("AMMO FULL");
      return;
    }
    this.pickups.take(p);
    // the gun you had in that slot goes down where you stand
    if (r.dropped) {
      const f = this.player.feet;
      const fwd = this.player.camera.getDirection(Vector3.Forward());
      const at = new Vector3(f.x + fwd.x * 0.6, f.y, f.z + fwd.z * 0.6);
      const floor = this.level.nav.floorAt(at.x, f.y + 0.3, at.z, 1.5) ?? f.y;
      at.y = floor;
      this.pickups.addWeapon(r.dropped.id, at, this.player.yaw + Math.PI / 2, r.dropped.mag, r.dropped.reserve, false);
    }
  }
  private walkOverPickups() {
    for (const p of this.pickups.touching(this.player.feet)) {
      const took = p.kind === "ammo" ? this.weapons.takeAmmo() : p.kind === "rockets" ? this.weapons.takeRockets() : this.weapons.takeGrenades();
      if (took) {
        this.pickups.take(p);
        this.hud.flashPrompt(p.kind === "ammo" ? "AMMO RESUPPLIED" : p.kind === "rockets" ? "+2 ROCKETS" : "GRENADES RESUPPLIED");
      }
    }
  }
  /** a soldier's rifle stays where he fell: walk up and take it (or its ammo) */
  private updateDrops(dt: number) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t -= dt;
      if (d.t > 0) continue;
      this.drops.splice(i, 1);
      const gun = d.e.parts.gun;
      gun.computeWorldMatrix(true);
      const g = gun.getAbsolutePosition();
      const at = new Vector3(g.x, g.y, g.z);
      const floor = this.level.nav.floorAt(at.x, at.y + 0.3, at.z, 2.5);
      if (floor === null) continue;
      at.y = floor;
      // a dead man's rifle: what's left in the magazine, and the two or three spare mags on his vest
      this.pickups.addWeapon("ak47", at, Math.random() * 6.28, 10 + ((Math.random() * 21) | 0), 30 * (2 + ((Math.random() * 2) | 0)), false, false, () => gun.setEnabled(false));
    }
  }

  /** badly hurt: the player leaves a trail of drops (more often the lower his health) */
  private bleedT = 0;
  private updateBleeding(dt: number) {
    const hp = this.player.health / PLAYER.maxHealth;
    if (!this.player.alive || hp > 0.45) return;
    this.bleedT -= dt * (this.player.moveAmount > 0.2 ? 1.6 : 1);
    if (this.bleedT > 0) return;
    this.bleedT = 0.5 + hp * 2.2 + Math.random() * 0.6;
    this.fx.playerBleed(this.player.feet, hp < 0.25);
  }

  /** incendiary areas: burn soldiers inside, and the player if he walks in */
  private updateFires(dt: number) {
    const dps = GRENADE_TYPES.flame.damage;
    this.burnAcc += dt;
    const tick = this.burnAcc >= 0.25;
    if (tick) this.burnAcc = 0;
    for (const f of this.explosions.fires) {
      if (!f.active || f.t < 0.25) continue;
      if (tick) this.enemies.burn(f.pos, f.radius, dps * 0.25);
      if (tick && this.player.alive) {
        const c = this.player.collider.position;
        const dx = c.x - f.pos.x;
        const dz = c.z - f.pos.z;
        if (dx * dx + dz * dz < f.radius * f.radius * 0.8 && Math.abs(c.y - 0.9 - f.pos.y) < 1.2) this.player.takeDamage(dps * 0.6 * 0.25, f.pos);
      }
    }
  }

  private cheatEls: { god: HTMLElement | null; arsenal: HTMLElement | null } | null = null;
  /** the GOD MODE / ALL WEAPONS tags under the objective, while they're on */
  private cheatTags() {
    const e = (this.cheatEls ??= { god: document.getElementById("tag-god"), arsenal: document.getElementById("tag-arsenal") });
    e.god?.classList.toggle("hidden", !this.dev.godOn);
    e.arsenal?.classList.toggle("hidden", !this.weapons?.arsenal);
  }

  // ------------------------------------------------------------------ developer mode
  private devHotkeys() {
    const inp = this.input;
    const dev = this.dev;
    if (inp.wasPressed("KeyI")) dev.cycleAmmo();
    if (inp.wasPressed("KeyY")) dev.cycleAi();
    if (inp.wasPressed("KeyU")) dev.cycleScale();
    // (H is the god-mode toggle, K the quick knife, L all weapons — the dev keys for these moved to Shift)
    const shift = inp.isDown("ShiftLeft") || inp.isDown("ShiftRight");
    if (shift && inp.wasPressed("KeyK")) {
      this.enemies.killAll();
      dev.toast("ALL HOSTILES DOWN");
    }
    // the heroes (and their foes), straight in — testing: 8 Hulk · 9 Spider-Man · 0 Iron Man · − Wolverine · = Deadpool · [ Batman · ] Superman
    const busy = this.allyCineOn || !!this.hulk?.cinematic;
    const summon = (key: string, name: string, f: () => boolean, here: boolean) => {
      if (!inp.wasPressed(key)) return;
      if (!here) return dev.toast(`${name}: NOT ON THIS STAGE`);
      if (busy) return dev.toast(`${name}: WAIT FOR THE CINEMATIC`);
      dev.toast(f() ? `${name} INCOMING` : `${name}: ALREADY IN (OR NO SPOT)`);
    };
    const plain = !inp.isDown("ShiftLeft") && !inp.isDown("ShiftRight") && !inp.isDown("AltLeft") && !inp.isDown("AltRight");
    if (plain) {
      summon("Digit8", "HULK", () => this.summonHulk(), !!this.hulk);
      summon("Digit9", "SPIDER-MAN", () => this.summonSpidey(), !!this.spidey);
      summon("Digit0", "IRON MAN", () => this.summonIron(), !!this.iron);
    }
    if (!inp.isDown("ShiftLeft") && !inp.isDown("ShiftRight")) summon("Minus", "WOLVERINE", () => this.summonWolverine(), !!this.wolv);
    summon("Equal", "DEADPOOL", () => this.summonDeadpool(), !!this.dp);
    summon("BracketLeft", "BATMAN", () => this.summonBatman(), !!this.bat);
    summon("BracketRight", "SUPERMAN", () => this.summonSuperman(), !!this.sm);
    // the Phase-2 heroes: ; Thor · ' Captain America · , Captain Marvel · . Star-Lord · / Drax · \ Rocket · P the Flash
    for (const [key, id] of [["Semicolon", "thor"], ["Quote", "cap"], ["Comma", "marvel"], ["Period", "starlord"], ["Slash", "drax"], ["Backslash", "rocket"], ["KeyP", "flash"]] as const)
      summon(key, byId(id)?.name ?? id, () => this.summonSquad(id), this.squad.some((x) => x.def.id === id));
    // the villains: Shift + 1 Joker · 2 Ronan · 3 Ultron · 4 Darkseid · 5 Doctor Doom · 6 Thanos
    if (inp.isDown("ShiftLeft") || inp.isDown("ShiftRight"))
      for (const [key, id] of [["Digit1", "joker"], ["Digit2", "ronan"], ["Digit3", "ultron"], ["Digit4", "darkseid"], ["Digit5", "doom"], ["Digit6", "thanos"]] as const)
        summon(key, byId(id)?.name ?? id, () => this.summonVillain(id), this.villains.some((x) => x.def.id === id));
    // the second wave (round 10): Alt + 1 Strange · 2 Ant-Man · 3 Ironhide · 4 Toothless · 5 Silver Surfer · 6 Human Torch · 7 Mister Fantastic;
    // Shift + 7 Hela · 8 Red Skull · 9 Megatron · 0 Venom · − Godzilla (whichever side the faction table put them on)
    const any = (id: string) => (this.squad.some((x) => x.def.id === id) ? this.summonSquad(id) : this.summonVillain(id));
    const here = (id: string) => this.squad.some((x) => x.def.id === id) || this.villains.some((x) => x.def.id === id);
    if (inp.isDown("AltLeft") || inp.isDown("AltRight"))
      for (const [key, id] of [["Digit1", "strange"], ["Digit2", "antman"], ["Digit3", "ironhide"], ["Digit4", "toothless"], ["Digit5", "surfer"], ["Digit6", "torch"], ["Digit7", "fantastic"]] as const)
        summon(key, byId(id)?.name ?? id, () => any(id), here(id));
    if (inp.isDown("ShiftLeft") || inp.isDown("ShiftRight"))
      for (const [key, id] of [["Digit7", "hela"], ["Digit8", "redskull"], ["Digit9", "megatron"], ["Digit0", "venom"], ["Minus", "godzilla"]] as const)
        summon(key, byId(id)?.name ?? id, () => any(id), here(id));
    if (shift && inp.wasPressed("KeyL")) {
      this.enemies.reset();
      this.hud.setHostiles(this.enemies.awakeCount);
      this.endTimer = -1;
      dev.toast("HOSTILES RESPAWNED");
    }
  }

  private applyDevCheats() {
    if (!this.player) return;
    const dev = this.dev;
    this.player.invulnerable = dev.godOn;
    this.enemies.aiMode = dev.aiMode;
    const ammo = dev.ammoMode;
    if (ammo === "OFF") return;
    for (const w of this.weapons.weapons) {
      if (w.isGrenade) {
        if (w.throwPhase === "idle" && w.state !== "holstering") this.weapons.refillGrenades();
        continue;
      }
      w.reserve = Math.max(w.reserve, w.cfg.reserveMax);
      if (ammo === "NO RELOAD" && w.state !== "reloading") w.mag = w.cfg.magSize;
    }
  }

  private updateHud(dt: number) {
    const w = this.weapons.weapon;
    const hud = this.hud;
    hud.setHealth(this.player.health, PLAYER.maxHealth);
    hud.setStance(this.player.stance, this.player.lean);
    hud.setWeapon(w.isGrenade ? GRENADE_TYPES[this.weapons.nadeType].name : w.cfg.displayName, SLOT_ORDER.indexOf(slotOf(w.cfg)), w.isGrenade ? "flashbang" : w.cfg.id);
    hud.setCarried(SLOT_ORDER.map((s) => this.weapons.arsenal || this.weapons.carried[s] >= 0));
    if (w.cfg.knife) hud.setAmmo(-1, -1, 0, false);
    else hud.setAmmo(w.mag, w.isGrenade ? -1 : w.reserve, w.isGrenade ? GRENADE_TYPES[this.weapons.nadeType].count : w.cfg.magSize, w.cfg.fireMode === "pump" || w.isGrenade || !!w.cfg.projectile);
    const ads = this.weapons.adsT;
    const sprint = this.weapons.sprintT;
    const hide = Math.max(ads * (w.cfg.id === "rifle" ? 1 : 0.7), sprint, w.state === "reloading" ? 0.6 : 0, 1 - w.raised);
    hud.setCrosshair(this.weapons.currentSpread, this.player.fovDeg, this.player.alive ? 1 - Math.min(1, hide) : 0);
    // magnified optic: hide the viewmodel and show the scope overlay at full aim
    const scoped = !!w.cfg.scoped && ads > 0.9 && this.player.alive;
    hud.setScope(scoped);
    this.weapons.viewmodel.pivot.setEnabled(!scoped);
    // prompts
    if (!this.player.alive) hud.setPrompt("");
    else if (this.grenades.enemyGrenadeNear(this.player.feet, 8)) hud.setPrompt("⚠ GRENADE — MOVE!", true);
    else if (this.mission?.prompt) hud.setPrompt(this.mission.prompt);
    else if (w.isGrenade) hud.setPrompt(w.throwPhase === "cooked" ? `RELEASE TO THROW · <b>${bindings.label("aim")}</b> UNDERHAND` : w.throwPhase === "idle" && w.state === "ready" ? `<b>${bindings.label("fire")}</b> PULL PIN & THROW` : "");
    else if (this.lookPickup) hud.setPrompt(this.pickupPrompt(this.lookPickup));
    else if (this.lookDoor) hud.setPrompt(`<b>${bindings.label("use")}</b>${Math.abs(this.lookDoor.target) > 0.1 ? "CLOSE DOOR" : "OPEN DOOR"}`);
    else if (w.cfg.knife) hud.setPrompt(this.weapons.knifeT < 0 && this.stats.time < 600 ? `<b>${bindings.label("fire")}</b> SLASH · <b>${bindings.label("aim")}</b> STAB · BEHIND = TAKEDOWN` : "");
    else if (w.state === "reloading") hud.setPrompt(w.cfg.projectile ? "LOADING ROCKET" : "RELOADING");
    else if (w.mag === 0 && w.reserve === 0) hud.setPrompt("NO RESERVE AMMO", true);
    else if ((w.cfg.projectile ? w.mag === 0 : w.mag <= Math.ceil(w.cfg.magSize * 0.25)) && w.reserve > 0) hud.setPrompt(`<b>${bindings.label("reload")}</b>RELOAD`, w.mag === 0);
    else hud.setPrompt("");
    hud.update(dt, this.player.health / PLAYER.maxHealth);
    hud.setGrenades(this.weapons.inventory, this.weapons.nadeType, { throw: bindings.label("grenade"), swap: bindings.label("grenadeType") });
    // flashbang white-out: hold, then fade
    const f = this.flash;
    if (f.hold > 0) f.hold -= dt;
    else f.amount = Math.max(0, f.amount - dt * 0.55);
    hud.setFlash(f.amount);
    const c = this.player.camera.position;
    this.minimap.update(dt, c, this.player.yaw, this.enemies.enemies, this.grenades.live);
    void ENEMY;
  }

  private pickupPrompt(p: Pickup) {
    const key = `<b>${bindings.label("use")}</b>`;
    const cfg = WEAPONS[p.id!];
    const i = this.weapons.indexOf(p.id!);
    const slot = slotOf(cfg);
    const held = this.weapons.carried[slot];
    if (held === i) return `${key}TAKE ${cfg.displayName} AMMO`;
    if (held >= 0) return `${key}SWAP ${this.weapons.weapons[held].cfg.displayName} FOR ${cfg.displayName}`;
    return `${key}PICK UP ${cfg.displayName}`;
  }

  /** Test/automation hook (dev only). */
  get debugApi() {
    return {
      player: this.player,
      weapons: this.weapons,
      enemies: this.enemies,
      input: this.input,
      scene: this.scene,
      /** advance the simulation n fixed steps without rendering; returns avg ms per step */
      simulate: (n: number, dt = 1 / 60, perStep?: (i: number) => void) => {
        this.engine.stopRenderLoop();
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          perStep?.(i);
          this.scene.incrementRenderId();
          this.step(dt);
          this.input.endFrame();
        }
        const ms = (performance.now() - t0) / n;
        this.engine.runRenderLoop(() => this.frame());
        return ms;
      },
    };
  }
}
