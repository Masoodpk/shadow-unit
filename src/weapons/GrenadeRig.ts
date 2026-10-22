import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Node } from "@babylonjs/core/node";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { Space } from "@babylonjs/core/Maths/math.axis";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { GRENADE, M4_CLIPS } from "../config/weapons";
import { easeInOutSine, saturate } from "../core/math";
import { ArmsTemplate, M4_PARTS, extFor, forceWorld } from "./ArmsRig";
import type { LethalType } from "./GrenadeModels";
import type { GrenadeType } from "../config/weapons";
import { RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import flashUrl from "../assets/weapons/flashbang.glb?url";

/**
 * M84-style flashbang held by the shared M4-pack arms.
 *
 * There is no authored grenade animation, so the arms are posed procedurally
 * on top of the pack's idle pose with analytic two-bone IK (shoulder → elbow →
 * wrist) for both arms:
 *   equip   right hand rises into view holding the grenade
 *   pin     left hand comes in, hooks the ring and pulls it away
 *   cooked  (trigger still held) right arm winds back, ready to throw
 *   throw   over-arm swing; the grenade leaves the hand at GRENADE.releaseAt
 * Targets are keyframed in the camera frame, eased, and solved every frame,
 * so the hand always reaches exactly where the grenade is.
 */

export async function loadFlashbangContainer(scene: Scene, onProgress?: (p: number) => void) {
  return LoadAssetContainerAsync(flashUrl, scene, {
    pluginExtension: extFor(flashUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
}

/** Grenade geometry merged per role: body (thrown), ring+pin (pulled), spoon (flies off). */
export interface FlashbangParts {
  /** templates for world projectiles, centred, metres, +Y = fuze end */
  projectiles: Record<GrenadeType, Mesh>;
}

export interface GrenadeRigApi extends WeaponRig {
  /** show the grenade type in the hand */
  setType(t: GrenadeType): void;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);
type Key = { t: number; p: Vector3 };

/** piecewise-eased path through keyframes */
function path(keys: Key[], t: number, out: Vector3) {
  if (t <= keys[0].t) return out.copyFrom(keys[0].p);
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) {
      const a = keys[i - 1];
      const b = keys[i];
      const u = easeInOutSine(saturate((t - a.t) / (b.t - a.t)));
      return Vector3.LerpToRef(a.p, b.p, u, out);
    }
  }
  return out.copyFrom(keys[keys.length - 1].p);
}

export function buildGrenadeRig(scene: Scene, tpl: ArmsTemplate, gc: AssetContainer, lethal: Record<LethalType, Mesh>): { rig: GrenadeRigApi; parts: FlashbangParts } {
  const id = "flashbang" as const;
  // ---------------------------------------------------------------- arms
  const entries = tpl.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const glbRoot = entries.rootNodes[0] as TransformNode;
  glbRoot.setEnabled(true);
  const all = glbRoot.getDescendants(false) as Node[];
  const byName = (n: string) => (all.find((t) => t.name === n) as TransformNode | undefined) ?? null;
  const draw = entries.animationGroups.find((g) => /Draw$/.test(g.name))!;
  for (const g of entries.animationGroups) g.stop();
  for (const g of entries.animationGroups) if (g !== draw) g.dispose();
  draw.start(false, 1, draw.from, draw.to);
  draw.pause();
  const sampleIdle = () => draw.goToFrame(M4_CLIPS.idle * 60);
  sampleIdle();
  for (const n of all) if (n instanceof AbstractMesh && (M4_PARTS.some((p) => n.name.startsWith(p)) || n.name.startsWith("Mag2"))) n.setEnabled(false);
  byName("Mag2")?.setEnabled(false);

  const camPos = forceWorld(byName("FPS_Camera")!).getTranslation();
  const R = { sh: byName("RightArm_03")!, el: byName("RightForeArm_04")!, wr: byName("RightHand_05")! };
  const L = { sh: byName("LeftArm_026")!, el: byName("LeftForeArm_027")!, wr: byName("LeftHand_028")! };

  // world (glb) <-> camera frame
  // camera frame <-> world. While building, the arms sit unparented in glb space (camera at camPos);
  // at runtime the rig root *is* the camera frame (anchor = -camPos), wherever the viewmodel puts it.
  const frameM = Matrix.Translation(camPos.x, camPos.y, camPos.z);
  const frameInv = frameM.clone().invert();
  const W = (cam: Vector3, out = new Vector3()) => Vector3.TransformCoordinatesToRef(cam, frameM, out);
  const C = (world: Vector3, out = new Vector3()) => Vector3.TransformCoordinatesToRef(world, frameInv, out);
  const Wdir = (cam: Vector3) => Vector3.TransformNormal(cam, frameM);
  const pos = (n: TransformNode) => forceWorld(n).getTranslation();
  const axis = (n: TransformNode, local: Vector3) => Vector3.TransformNormal(local, forceWorld(n)).normalize();

  // idle reference: where the pack's right hand grips the M4 pistol grip
  const rWr0 = C(pos(R.wr));
  const rAxes0 = { y: axis(R.wr, Vector3.Up()), x: axis(R.wr, Vector3.Right()) };
  const lWr0 = C(pos(L.wr));

  // ---------------------------------------------------------------- grenade model
  gc.addAllToScene();
  const gRoot = gc.meshes[0];
  const gMeshes = gc.meshes.filter((m) => m.getTotalVertices() > 0) as Mesh[];
  for (const m of gc.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.2;
  }
  const center = (m: AbstractMesh) => {
    m.computeWorldMatrix(true);
    m.refreshBoundingInfo({});
    return m.getBoundingInfo().boundingBox.centerWorld.clone();
  };
  // identify parts by their position along the body (robust to node names)
  const vol = (m: AbstractMesh) => {
    const e = m.getBoundingInfo().boundingBox.extendSizeWorld;
    return e.x * e.y * e.z;
  };
  gRoot.computeWorldMatrix(true);
  for (const m of gMeshes) center(m);
  const body = [...gMeshes].sort((a, b) => vol(b) - vol(a))[0];
  const bodyC = center(body);
  const bodyE = body.getBoundingInfo().boundingBox.extendSizeWorld;
  // long axis of the canister
  const longIdx = bodyE.x > bodyE.y && bodyE.x > bodyE.z ? "x" : bodyE.y > bodyE.z ? "y" : "z";
  const longAxis = new Vector3(longIdx === "x" ? 1 : 0, longIdx === "y" ? 1 : 0, longIdx === "z" ? 1 : 0);
  // fuze end = the end where the small parts sit
  const smalls = gMeshes.filter((m) => m !== body);
  const smallC = smalls.reduce((acc, m) => acc.addInPlace(center(m)), new Vector3()).scaleInPlace(1 / Math.max(1, smalls.length));
  if (Vector3.Dot(smallC.subtract(bodyC), longAxis) < 0) longAxis.scaleInPlace(-1);
  // ring / pin = parts that stick out sideways the most
  const sideOf = (m: AbstractMesh) => {
    const d = center(m).subtract(bodyC);
    return d.subtract(longAxis.scale(Vector3.Dot(d, longAxis))).length();
  };
  const ringParts = smalls.filter((m) => sideOf(m) > Math.max(bodyE.x, bodyE.y, bodyE.z) * 0.33 && Vector3.Dot(center(m).subtract(bodyC), longAxis) > 0);
  const ringC = ringParts.length ? ringParts.reduce((a, m) => a.addInPlace(center(m)), new Vector3()).scaleInPlace(1 / ringParts.length) : bodyC.add(new Vector3(0.03, 0, 0));
  // real M84 canister ≈ 11.5 cm without the fuze; the model is authored larger
  const bodyLen = 2 * (longIdx === "x" ? bodyE.x : longIdx === "y" ? bodyE.y : bodyE.z);
  const gScale = 0.115 / Math.max(0.01, bodyLen);
  const sideDir = ringC.subtract(bodyC);
  sideDir.subtractInPlace(longAxis.scale(Vector3.Dot(sideDir, longAxis))).normalize();

  // grenade-local frame: +Y = fuze end, +X = ring side, origin = body centre
  const gBasis = Matrix.FromValues(
    sideDir.x, sideDir.y, sideDir.z, 0,
    longAxis.x, longAxis.y, longAxis.z, 0,
    Vector3.Cross(sideDir, longAxis).x, Vector3.Cross(sideDir, longAxis).y, Vector3.Cross(sideDir, longAxis).z, 0,
    bodyC.x, bodyC.y, bodyC.z, 1,
  );
  const gInv = gBasis.clone().invert();

  // held grenade: node in that frame, grenade meshes under it
  const flashHeld = new TransformNode("flashHeld", scene);
  let held = flashHeld;
  const toHeld = gInv; // model world → grenade frame
  for (const m of gMeshes) {
    m.computeWorldMatrix(true);
    const local = m.getWorldMatrix().multiply(toHeld);
    m.setParent(null);
    const s = new Vector3();
    const q = new Quaternion();
    const t = new Vector3();
    local.decompose(s, q, t);
    m.parent = held;
    m.scaling.copyFrom(s);
    m.rotationQuaternion = q;
    m.position.copyFrom(t);
  }
  gRoot.dispose(false, false);
  const ringSet = new Set(ringParts);
  const heldBody = gMeshes.filter((m) => !ringSet.has(m));
  // ring node sits on the ring itself (so the left hand can aim for it), parts keep their pose
  const flashRing = new TransformNode("flashRing", scene);
  let ring = flashRing;
  ring.parent = held;
  ring.position.copyFrom(Vector3.TransformCoordinates(ringC, gInv));
  for (const m of ringParts) {
    m.parent = ring;
    m.position.subtractInPlace(ring.position);
  }

  // projectile template: a merged copy of the body (no ring/pin)
  const projectile = Mesh.MergeMeshes(heldBody.map((m) => m.clone(m.name + "_p", null) as Mesh), true, true, undefined, false, true)!;
  projectile.name = "flashProjectileTpl";
  projectile.scaling.setAll(gScale);
  projectile.bakeCurrentTransformIntoVertices();
  projectile.setEnabled(false);
  const projectiles = { flash: projectile } as Record<GrenadeType, Mesh>;
  for (const type of Object.keys(lethal) as LethalType[]) projectiles[type] = lethal[type];

  // the grenade sits in the right hand where the M4's pistol grip was: fuze up and forward,
  // ring towards the left hand
  const up = v(0, 0.94, 0.34).normalize();
  const side = v(-1, 0, 0);
  const fwd = Vector3.Cross(side, up).normalize();
  side.copyFrom(Vector3.Cross(up, fwd)).normalize();
  const gripCam = v(0.064, -0.168, 0.148);
  const heldCamM = Matrix.FromValues(side.x, side.y, side.z, 0, up.x, up.y, up.z, 0, fwd.x, fwd.y, fwd.z, 0, gripCam.x + camPos.x, gripCam.y + camPos.y, gripCam.z + camPos.z, 1);
  {
    const s = new Vector3();
    const q = new Quaternion();
    const t = new Vector3();
    heldCamM.decompose(s, q, t);
    held.rotationQuaternion = q;
    held.position.copyFrom(t);
    held.scaling.setAll(gScale);
    held.computeWorldMatrix(true);
    forceWorld(R.wr);
    held.setParent(R.wr); // rides the hand from now on
  }

  // lethal grenades: same grip, their own models; an empty "ring" node marks the pin for the left hand
  type Holder = { node: TransformNode; ring: TransformNode; meshes: Mesh[] };
  const holders = {} as Record<GrenadeType, Holder>;
  holders.flash = { node: flashHeld, ring: flashRing, meshes: gMeshes };
  for (const type of Object.keys(lethal) as LethalType[]) {
    const node = new TransformNode(`${type}Held`, scene);
    const s = new Vector3();
    const q = new Quaternion();
    const t = new Vector3();
    heldCamM.decompose(s, q, t);
    node.rotationQuaternion = q;
    node.position.copyFrom(t);
    const mesh = lethal[type].clone(`${type}HeldMesh`, node) as Mesh;
    mesh.position.setAll(0);
    mesh.setEnabled(true);
    const r = new TransformNode(`${type}Pin`, scene);
    r.parent = node;
    mesh.refreshBoundingInfo({});
    const h = mesh.getBoundingInfo().boundingBox.extendSize.y;
    // the fist wraps the lower body: the grenade sits up out of the hand
    mesh.position.y = h * 0.75;
    r.position.set(0.022, h * 1.6, 0);
    node.computeWorldMatrix(true);
    forceWorld(R.wr);
    node.setParent(R.wr);
    node.setEnabled(false);
    holders[type] = { node, ring: r, meshes: [mesh] };
  }

  // ---------------------------------------------------------------- rig nodes
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  anchor.position.copyFrom(camPos).scaleInPlace(-1);
  glbRoot.parent = anchor;
  const muzzle = new TransformNode(`${id}Muzzle`, scene);
  muzzle.parent = root;
  const eject = new TransformNode(`${id}Eject`, scene);
  eject.parent = root;
  const sight = new TransformNode(`${id}Sight`, scene);
  sight.parent = root;
  sight.position.set(0, 0, 0.3);
  const dummy = new TransformNode(`${id}Hand`, scene);
  dummy.parent = root;

  const armMeshes = all.filter((n) => n instanceof AbstractMesh && n.getTotalVertices() > 0 && n.isEnabled(true)) as AbstractMesh[];
  const meshes = [...armMeshes, ...Object.values(holders).flatMap((h) => h.meshes)];
  for (const m of meshes) {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
  }

  // ---------------------------------------------------------------- IK
  const tmpA = new Vector3();
  const tmpB = new Vector3();
  const backup = new Quaternion();
  /** rotate `node` (world space) so that world direction `from` turns into `to` */
  const align = (node: TransformNode, from: Vector3, to: Vector3, measure: () => Vector3) => {
    const f = from.normalizeToRef(tmpA);
    const t = to.normalizeToRef(tmpB);
    const ax = Vector3.Cross(f, t);
    const sin = ax.length();
    if (sin < 1e-5) return;
    const ang = Math.atan2(sin, Vector3.Dot(f, t));
    ax.scaleInPlace(1 / sin);
    backup.copyFrom(node.rotationQuaternion!);
    node.rotate(ax, ang, Space.WORLD);
    // reflected parent chains (glTF handedness) invert the sense of rotation: verify, flip if needed
    const got = measure().normalize();
    if (Vector3.Dot(got, t) < 0.999) {
      node.rotationQuaternion!.copyFrom(backup);
      node.rotate(ax, -ang, Space.WORLD);
    }
  };

  const solveArm = (arm: typeof R, targetCam: Vector3, poleCam: Vector3, handY: Vector3 | null, handX: Vector3 | null) => {
    const S = pos(arm.sh);
    const E = pos(arm.el);
    const Wp = pos(arm.wr);
    const l1 = Vector3.Distance(S, E);
    const l2 = Vector3.Distance(E, Wp);
    const T = W(targetCam);
    const P = W(poleCam);
    const toT = T.subtract(S);
    const d = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-4);
    const dir = toT.normalize();
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pole = P.subtract(S);
    pole.subtractInPlace(dir.scale(Vector3.Dot(pole, dir)));
    if (pole.lengthSquared() < 1e-8) pole.copyFrom(Vector3.Down());
    pole.normalize();
    const E2 = S.add(dir.scale(a)).addInPlace(pole.scale(h));
    align(arm.sh, E.subtract(S), E2.subtract(S), () => pos(arm.el).subtract(pos(arm.sh)));
    const E3 = pos(arm.el);
    const T2 = S.add(dir.scale(d));
    align(arm.el, pos(arm.wr).subtract(E3), T2.subtract(E3), () => pos(arm.wr).subtract(pos(arm.el)));
    if (handY) {
      align(arm.wr, axis(arm.wr, Vector3.Up()), handY, () => axis(arm.wr, Vector3.Up()));
      if (handX) {
        // twist about the hand axis so its side vector matches
        const cur = axis(arm.wr, Vector3.Right());
        const want = handX.subtract(handY.scale(Vector3.Dot(handX, handY)));
        align(arm.wr, cur.subtract(handY.scale(Vector3.Dot(cur, handY))), want, () => {
          const c = axis(arm.wr, Vector3.Right());
          return c.subtract(handY.scale(Vector3.Dot(c, handY)));
        });
      }
    }
  };

  // hand orientation helpers: idle grip axes rotated by a camera-space euler
  const qTmp = new Quaternion();
  const mTmp = new Matrix();
  const handAxes = (rx: number, ry: number, rz: number) => {
    Quaternion.RotationYawPitchRollToRef(ry, rx, rz, qTmp);
    qTmp.toRotationMatrix(mTmp);
    return { y: Wdir(Vector3.TransformNormal(rAxes0.y, mTmp)), x: Wdir(Vector3.TransformNormal(rAxes0.x, mTmp)) };
  };

  // ---------------------------------------------------------------- keyframes (camera frame, metres)
  // right wrist positions relative to the pack's idle wrist
  const r = (x: number, y: number, z: number) => rWr0.add(v(x, y, z));
  const HOLD = r(0.015, 0.03, 0.035);
  const LOW = r(0.06, -0.32, -0.02);
  const WIND = r(0.12, 0.08, 0.06);
  const RELEASE = r(0.06, 0.12, 0.34);
  const FOLLOW = r(-0.1, -0.3, 0.24);
  const LOB_BACK = r(0.06, -0.12, 0.0);
  const LOB_REL = r(0.0, 0.0, 0.3);
  const PIN_HOLD = r(0.01, 0.075, 0.07);
  const LEFT_AWAY = v(-0.2, -0.55, 0.12);
  const LEFT_GRAB_OFS = v(-0.06, -0.03, -0.035);
  const POLE_R = v(0.55, -0.45, -0.1);
  const POLE_L = v(-0.55, -0.45, -0.1);

  const throwKeys: Key[] = [
    { t: 0, p: HOLD },
    { t: 0.12, p: WIND },
    { t: GRENADE.releaseAt, p: RELEASE },
    { t: 0.62, p: FOLLOW },
    { t: 1, p: LOW },
  ];
  const throwCookedKeys: Key[] = [
    { t: 0, p: WIND },
    { t: GRENADE.releaseAt, p: RELEASE },
    { t: 0.62, p: FOLLOW },
    { t: 1, p: LOW },
  ];
  const lobKeys: Key[] = [
    { t: 0, p: HOLD },
    { t: 0.14, p: LOB_BACK },
    { t: GRENADE.releaseAt, p: LOB_REL },
    { t: 0.7, p: r(-0.04, -0.12, 0.22) },
    { t: 1, p: LOW },
  ];

  const rT = new Vector3();
  const lT = new Vector3();
  let ringDetached = false;
  void lWr0;
  const ringRest = new Map<TransformNode, { parent: TransformNode; p: Vector3; q: Quaternion }>();
  for (const h of Object.values(holders)) ringRest.set(h.ring, { parent: h.ring.parent as TransformNode, p: h.ring.position.clone(), q: h.ring.rotationQuaternion?.clone() ?? Quaternion.Identity() });
  const resetRing = () => {
    for (const [r, rest] of ringRest) {
      r.setParent(null);
      r.parent = rest.parent;
      r.position.copyFrom(rest.p);
      r.rotationQuaternion = rest.q.clone();
      r.setEnabled(true);
    }
    ringDetached = false;
  };

  const rigState = { lastPhase: "idle" as string, fromCooked: false, grab: new Vector3() };

  const rig: GrenadeRigApi = {
    setType(t: GrenadeType) {
      const h = holders[t];
      if (h.node === held) return;
      resetRing();
      held.setEnabled(false);
      held = h.node;
      ring = h.ring;
      held.setEnabled(true);
    },
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: dummy,
    rightHand: dummy,
    meshes,
    hipPose: { ...ZERO_POSE },
    sprintPose: { px: -0.02, py: -0.04, pz: -0.02, rx: 0.2, ry: 0.3, rz: 0.15 },
    adsDistance: 0.3,
    hasArms: true,
    authoredEquip: true,
    rotationOrigin: rWr0.clone(),
    animate(s: RigState) {
      sampleIdle();
      frameM.copyFrom(forceWorld(root));
      frameM.invertToRef(frameInv);
      const ready = s.weaponState === "ready";
      const phase = ready ? (s.throwPhase ?? "idle") : "idle";
      const t = s.throwT ?? 0;
      let rot = { rx: 0, ry: 0, rz: 0 };

      if (phase !== rigState.lastPhase) {
        if (phase === "throw") rigState.fromCooked = rigState.lastPhase === "cooked";
        if (phase === "idle" || phase === "pin") resetRing();
        rigState.lastPhase = phase;
      }
      held.setEnabled(true);

      // ---- right arm: where the grenade is
      if (!ready) {
        const e = easeInOutSine(saturate(s.raised));
        Vector3.LerpToRef(LOW, HOLD, e, rT);
        rot = { rx: 0.5 * (1 - e), ry: 0, rz: 0 };
        if (ringDetached) resetRing();
      } else if (phase === "idle") {
        rT.copyFrom(HOLD);
      } else if (phase === "pin") {
        const k = easeInOutSine(saturate(t / 0.4));
        Vector3.LerpToRef(HOLD, PIN_HOLD, k, rT);
        rot = { rx: -0.1 * k, ry: 0.14 * k, rz: 0 };
      } else if (phase === "cooked") {
        const k = easeInOutSine(saturate(t / 0.22));
        Vector3.LerpToRef(PIN_HOLD, WIND, k, rT);
        rot = { rx: -0.55 * k, ry: 0.15 * k, rz: -0.2 * k };
      } else {
        const keys = s.lob ? lobKeys : rigState.fromCooked ? throwCookedKeys : throwKeys;
        path(keys, t, rT);
        const wind = keys === lobKeys ? 0 : rigState.fromCooked ? 1 - saturate(t / GRENADE.releaseAt) : t < 0.12 ? t / 0.12 : 1 - saturate((t - 0.12) / (GRENADE.releaseAt - 0.12));
        const flick = t >= GRENADE.releaseAt ? saturate((t - GRENADE.releaseAt) / 0.2) : 0;
        rot = { rx: -0.55 * wind + 0.7 * flick, ry: 0.15 * wind - 0.2 * flick, rz: -0.2 * wind };
        if (t >= GRENADE.releaseAt) held.setEnabled(false);
      }
      const ax = handAxes(rot.rx, rot.ry, rot.rz);
      solveArm(R, rT, POLE_R, ax.y, ax.x);

      // ---- left arm: only comes into view to pull the pin
      if (phase === "pin") {
        held.computeWorldMatrix(true);
        if (!ringDetached) {
          const ringCam = C(forceWorld(ring).getTranslation());
          // hook the ring with the index finger: wrist sits a little behind/below it
          rigState.grab.copyFrom(ringCam).addInPlace(LEFT_GRAB_OFS);
          path([{ t: 0, p: LEFT_AWAY }, { t: 0.45, p: rigState.grab }], t, lT);
          solveArm(L, lT, POLE_L, null, null);
          if (t >= 0.45) {
            forceWorld(L.wr);
            ring.setParent(L.wr);
            ringDetached = true;
          }
        } else {
          path(
            [
              { t: 0.45, p: rigState.grab },
              { t: 0.72, p: rigState.grab.add(v(-0.14, -0.03, -0.05)) },
              { t: 1, p: LEFT_AWAY },
            ],
            t,
            lT,
          );
          solveArm(L, lT, POLE_L, null, null);
          if (t > 0.9) ring.setEnabled(false);
        }
      } else {
        if (ready && phase !== "idle") ring.setEnabled(false);
        solveArm(L, LEFT_AWAY, POLE_L, null, null);
      }

      // throw origin = the grenade in the hand
      held.computeWorldMatrix(true);
      C(held.getAbsolutePosition(), muzzle.position);
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      resetRing();
      held.setEnabled(true);
      rigState.lastPhase = "idle";
      rigState.fromCooked = false;
      sampleIdle();
    },
  };
  (rig as unknown as { debugInfo: () => unknown }).debugInfo = () => ({
    rT: rT.asArray(),
    lT: lT.asArray(),
    rw: C(pos(R.wr)).asArray(),
    lw: C(pos(L.wr)).asArray(),
    ls: C(pos(L.sh)).asArray(),
    rs: C(pos(R.sh)).asArray(),
    ring: C(forceWorld(ring).getTranslation()).asArray(),
    held: C(held.getAbsolutePosition()).asArray(),
    rWr0: rWr0.asArray(),
    lWr0: lWr0.asArray(),
    gScale,
  });
  rig.reset();
  root.setEnabled(false);
  return { rig, parts: { projectiles } };
}
