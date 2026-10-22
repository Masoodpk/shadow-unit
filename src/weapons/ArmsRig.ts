import "@babylonjs/loaders/glTF/glTFFileLoader";
import "@babylonjs/loaders/glTF/2.0/glTFLoader";
import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import "@babylonjs/core/Animations/animatable";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Node } from "@babylonjs/core/node";
import { M4_CLIPS, WeaponId } from "../config/weapons";
import { GunSpec } from "../config/guns";
import { Pose, RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import m4Url from "../assets/m4.glb?url";

/**
 * First-person arms from the "M4 – FPS Weapon Animations Pack v1"
 * (BarcodeGames, CC BY 4.0), shared by every modern gun.
 *
 * - The pack's own M4 is used as-is.
 * - Other guns are static models attached to the animated receiver joint:
 *   their pistol grip is aligned to the M4 grip (so the right hand closes on
 *   it), the left arm is shifted onto their handguard (or their magwell while
 *   reloading) and their magazine is parented to the pack's magazine joint,
 *   so draw / holster / fire / both reloads all carry over.
 *
 * The weapon state machine stays the single source of truth: each frame the
 * clip is *sampled* at the time it dictates (goToFrame on paused groups), so
 * animation, sound and ammo can never drift. Clip changes cross-fade from a
 * pose snapshot so interrupted reloads and draws don't pop.
 */

/** Measurements of the pack's M4 in the authored camera frame (metres, +Z forward). */
export const M4 = {
  rearSight: new Vector3(0.0678, -0.0056, 0.155),
  frontSight: new Vector3(0.0618, -0.0055, 0.565),
  muzzle: new Vector3(0.0677, -0.0644, 0.745),
  ejectPort: new Vector3(0.088, -0.042, 0.13),
  /** top of the pistol grip, where the web of the right hand sits */
  grip: new Vector3(0.0678, -0.1353, 0.1643),
  handguardBottomY: -0.1012,
  magwell: new Vector3(0.066, -0.161, 0.283),
  eyeRelief: 0.085,
};
export const M4_PARTS = ["Main_M4", "Mag1_M4", "Mag2_M4", "Bolt_M4", "BoltCatch_M4", "Trigger_M4", "Safety_M4", "Bullet5_56x45mm_Bullet5"];
const FPS = 60;

export interface ArmsTemplate {
  container: AssetContainer;
}

export async function loadArmsTemplate(scene: Scene, onProgress?: (p: number) => void): Promise<ArmsTemplate> {
  const container = await LoadAssetContainerAsync(m4Url, scene, {
    pluginExtension: extFor(m4Url),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
  // keep materials/textures registered with the scene; the template itself is never shown
  container.addAllToScene();
  for (const g of container.animationGroups) g.stop();
  container.meshes[0].setEnabled(false);
  for (const m of container.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.25;
    if (m.name.startsWith("M4")) {
      // source is spec/gloss with zero spec — give the rifle a real gunmetal response
      m.metallic = 0.5;
      m.roughness = 0.42;
      m.albedoColor = new Color3(1.15, 1.15, 1.15);
    } else if (m.name.startsWith("Bullet")) {
      m.metallic = 0.9;
      m.roughness = 0.3;
    } else if (m.name.startsWith("Glove")) {
      m.metallic = 0;
      m.roughness = Math.max(m.roughness ?? 0.85, 0.8);
    } else if (m.name.startsWith("Hand")) {
      m.metallic = 0;
      m.roughness = Math.max(m.roughness ?? 0.6, 0.55);
    }
  }
  return { container };
}

export async function loadGunContainer(scene: Scene, spec: GunSpec, onProgress?: (p: number) => void) {
  const c = await LoadAssetContainerAsync(spec.url, scene, {
    pluginExtension: extFor(spec.url),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
  return c;
}

/** .glb normally; .json when assets were converted to embedded glTF for web-only hosts. */
export const extFor = (url: string) => (/\.json($|\?)/.test(url) ? ".gltf" : ".glb");

export const forceWorld = (n: TransformNode) => {
  const chain: TransformNode[] = [];
  for (let c: TransformNode | null = n; c; c = c.parent as TransformNode | null) chain.push(c);
  for (let i = chain.length - 1; i >= 0; i--) chain[i].computeWorldMatrix(true);
  return n.getWorldMatrix();
};

/** Rotation that maps +Z onto the given aim direction (yaw, then pitch) — matches Babylon's Euler order. */
function aimRotation(dir: Vector3) {
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = -Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  return { yaw, pitch };
}

/** Exact aim pose: rotate the sight line onto +Z (around `origin`) and put the rear point at eye relief. */
export function solveAds(rear: Vector3, front: Vector3, eyeRelief: number, origin: Vector3): Pose {
  const dir = front.subtract(rear).normalize();
  const ry = -Math.atan2(dir.x, dir.z);
  const rx = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
  const rot = new Matrix();
  Quaternion.RotationYawPitchRoll(ry, rx, 0).toRotationMatrix(rot);
  const rearRel = Vector3.TransformCoordinates(rear.subtract(origin), rot).add(origin);
  const p = new Vector3(0, 0, eyeRelief).subtract(rearRel);
  return { px: p.x, py: p.y, pz: p.z, rx, ry, rz: 0 };
}

interface Track {
  node: TransformNode;
  snapP: Vector3;
  snapR: Quaternion;
  snapS: Vector3;
}

export function buildArmsRig(scene: Scene, tpl: ArmsTemplate, id: WeaponId, gun: GunSpec | null, gunContainer: AssetContainer | null): WeaponRig {
  // ---- independent copy of arms + skeleton + clips
  const entries = tpl.container.instantiateModelsToScene((n) => n, false, { doNotInstantiate: true });
  const glbRoot = entries.rootNodes[0] as TransformNode;
  glbRoot.setEnabled(true);
  const all = glbRoot.getDescendants(false) as Node[];
  const byName = (n: string) => (all.find((t) => t.name === n) as TransformNode | undefined) ?? null;
  const groups = new Map<string, AnimationGroup>();
  for (const g of entries.animationGroups) {
    g.stop();
    groups.set(g.name.replace(/^Clone of /, ""), g);
  }
  for (const g of groups.values()) {
    g.start(false, 1, g.from, g.to);
    g.pause();
  }
  byName("Mag2")?.setEnabled(false); // spare mag parked off-screen by the pack

  const drive = (name: string, sec: number) => groups.get(name)!.goToFrame(sec * FPS);
  drive("Draw", M4_CLIPS.idle);
  const camNode = byName("FPS_Camera")!;
  const camPos = forceWorld(camNode).getTranslation();
  const mainJ = byName("Main_j_049")!;
  const mainWorld0 = forceWorld(mainJ).clone();
  const parentStatic = forceWorld(mainJ.parent as TransformNode).clone().multiply(Matrix.Translation(-camPos.x, -camPos.y, -camPos.z));

  // ---- geometry of whatever gun this rig holds, expressed in the authored camera frame
  let geo = { rear: M4.rearSight, front: M4.frontSight, muzzle: M4.muzzle, eject: M4.ejectPort, eyeRelief: M4.eyeRelief };
  const leftArm = byName("LeftArm_026")!;
  const leftHand = byName("LeftHand_028")!;
  const magJoint = byName("Mag1_j_050")!;
  /** left-hand correction anchors: a point (where the M4 wrist sits) and the offset to apply, both in `joint` space */
  const anchors: { joint: TransformNode; point: Vector3; delta: Vector3 }[] = [];
  let meshes: AbstractMesh[] = [];

  if (gun && gunContainer) {
    // hide the pack's own rifle
    for (const n of all) if (n instanceof AbstractMesh && M4_PARTS.some((p) => n.name.startsWith(p))) n.setEnabled(false);

    // gun frame → camera frame: same yaw/pitch as the pack's M4, grips coincide
    const m4Dir = M4.frontSight.subtract(M4.rearSight).normalize();
    const { yaw, pitch } = aimRotation(m4Dir);
    const rM4 = new Matrix();
    Quaternion.RotationYawPitchRoll(yaw, pitch, 0).toRotationMatrix(rM4);
    const toCam = (p: Vector3) => Vector3.TransformCoordinates(p.subtract(gun.gripTop), rM4).add(M4.grip);

    // node that represents the gun frame, placed in GLB world, then attached to the animated receiver
    gunContainer.addAllToScene();
    const gunRoot = gunContainer.meshes[0];
    const frame = new TransformNode(`${id}_frame`, scene);
    const native = Matrix.Compose(new Vector3(gun.scale, gun.scale, gun.scale), Quaternion.RotationYawPitchRoll(gun.yaw, 0, 0), Vector3.Zero());
    const t = M4.grip.add(camPos).subtract(Vector3.TransformCoordinates(gun.gripTop, rM4));
    const world = native.multiply(rM4).multiply(Matrix.Translation(t.x, t.y, t.z));
    const sc = new Vector3();
    const rq = new Quaternion();
    const tr = new Vector3();
    world.decompose(sc, rq, tr);
    frame.scaling.copyFrom(sc);
    frame.rotationQuaternion = rq;
    frame.position.copyFrom(tr);
    gunRoot.parent = frame;
    frame.computeWorldMatrix(true);
    frame.setParent(mainJ);

    const gunNodes = gunRoot.getDescendants(false) as Node[];
    const matches = (n: Node, frags: string[]) =>
      frags.some((f) => n.name.includes(f) || (n.parent?.name ?? "").includes(f) || ((n as AbstractMesh).material?.name ?? "").includes(f));
    if (gun.hide) for (const n of gunNodes) if (matches(n, gun.hide)) (n as TransformNode).setEnabled(false);

    // magazine rides the pack's magazine joint
    forceWorld(magJoint);
    if (gun.magParts) {
      const magNodes = gunNodes.filter((n) => n instanceof AbstractMesh && n.getTotalVertices() > 0 && matches(n, gun.magParts!)) as AbstractMesh[];
      for (const m of magNodes) {
        forceWorld(m);
        m.setParent(magJoint);
      }
    }

    // merge the static parts per material (M5 ships 27 separate meshes) → a handful of draw calls
    const magSet = new Set<Node>();
    if (gun.magParts) for (const n of gunNodes) if (matches(n, gun.magParts)) magSet.add(n);
    const byMat = new Map<string, Mesh[]>();
    for (const n of gunNodes) {
      if (!(n instanceof Mesh) || n.getTotalVertices() === 0 || !n.isEnabled(true) || magSet.has(n) || !n.material) continue;
      const key = n.material.uniqueId + "";
      if (!byMat.has(key)) byMat.set(key, []);
      byMat.get(key)!.push(n);
    }
    for (const list of byMat.values()) {
      if (list.length < 2) continue;
      for (const m of list) forceWorld(m);
      const merged = Mesh.MergeMeshes(list, true, true, undefined, false, false);
      if (!merged) continue;
      merged.name = `${id}_merged`;
      merged.computeWorldMatrix(true);
      merged.setParent(frame);
      gunContainer.meshes.push(merged);
    }

    // left arm: where the pack's hand grips the M4 (handguard / magwell / magazine) vs. the same spot on this gun.
    // Each offset lives in the frame of the part being held, so it follows that part through every clip.
    const lhPos = forceWorld(leftHand).getTranslation().subtract(camPos);
    const m4CenterX = (z: number) => M4.rearSight.x + ((z - M4.rearSight.z) * m4Dir.x) / m4Dir.z;
    const m4Support = new Vector3(m4CenterX(lhPos.z), M4.handguardBottomY, lhPos.z);
    const supportDelta = toCam(gun.support).subtract(m4Support);
    const magDelta = toCam(gun.magwell).subtract(M4.magwell);
    const mainInv = forceWorld(mainJ).clone().invert();
    const magInv = forceWorld(magJoint).clone().invert();
    // idle: hand on the handguard
    anchors.push({ joint: mainJ, point: Vector3.TransformCoordinates(forceWorld(leftHand).getTranslation(), mainInv), delta: Vector3.TransformNormal(supportDelta, mainInv) });
    // reload: hand on the magazine (rides the mag joint) and pushing it into the magwell (rides the receiver)
    for (const sec of [M4_CLIPS.reloadMagOut, M4_CLIPS.reloadSeat]) {
      drive("Reload", sec);
      const hw = forceWorld(leftHand).getTranslation();
      const mw = forceWorld(mainJ).clone().invert();
      const gw = forceWorld(magJoint).clone().invert();
      anchors.push({ joint: magJoint, point: Vector3.TransformCoordinates(hw, gw), delta: Vector3.TransformNormal(magDelta, magInv) });
      anchors.push({ joint: mainJ, point: Vector3.TransformCoordinates(hw, mw), delta: Vector3.TransformNormal(magDelta, mainInv) });
    }
    drive("Draw", M4_CLIPS.idle);
    forceWorld(mainJ);

    geo = { rear: toCam(gun.sightRear), front: toCam(gun.sightFront), muzzle: toCam(gun.muzzle), eject: toCam(gun.eject), eyeRelief: gun.eyeRelief };

    for (const m of gunContainer.materials) {
      if (!(m instanceof PBRMaterial)) continue;
      m.maxSimultaneousLights = 4;
      m.environmentIntensity = gun.surface?.env ?? 1.15;
      if (gun.surface?.metallic !== undefined) m.metallic = gun.surface.metallic;
      if (gun.surface?.roughness !== undefined) m.roughness = gun.surface.roughness;
      m.backFaceCulling = false;
    }
    meshes = gunContainer.meshes.filter((m) => !m.isDisposed() && m.getTotalVertices() > 0 && m.isEnabled(true));
  }

  // ---- rig root / anchor (authored camera at the viewmodel origin)
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  anchor.position.copyFrom(camPos).scaleInPlace(-1);
  glbRoot.parent = anchor;

  const invMain0 = mainWorld0.clone().invert();
  const toMainLocal = (camFramePoint: Vector3) => Vector3.TransformCoordinates(camFramePoint.add(camPos), invMain0);
  const muzzleLocal = toMainLocal(geo.muzzle);
  const ejectLocal = toMainLocal(geo.eject);
  const muzzle = new TransformNode(`${id}Muzzle`, scene);
  muzzle.parent = root;
  muzzle.position.copyFrom(geo.muzzle);
  const eject = new TransformNode(`${id}Eject`, scene);
  eject.parent = root;
  eject.position.copyFrom(geo.eject);
  const sight = new TransformNode(`${id}Sight`, scene);
  sight.parent = root;
  sight.position.copyFrom(geo.rear);
  const dummyHand = new TransformNode(`${id}Hand`, scene);
  dummyHand.parent = root;

  const adsPose = solveAds(geo.rear, geo.front, geo.eyeRelief, M4.grip);

  // ---- cross-fade tracks
  const trackSet = new Set<TransformNode>();
  for (const g of groups.values()) for (const ta of g.targetedAnimations) if (ta.target instanceof TransformNode) trackSet.add(ta.target);
  const tracks: Track[] = [...trackSet].map((node) => {
    if (!node.rotationQuaternion) node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
    return { node, snapP: new Vector3(), snapR: new Quaternion(), snapS: new Vector3(1, 1, 1) };
  });

  const armMeshes = all.filter((n) => n instanceof AbstractMesh && n.getTotalVertices() > 0 && n.isEnabled(true)) as AbstractMesh[];
  meshes = [...armMeshes, ...meshes];
  for (const m of meshes) {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
  }

  let current: AnimationGroup | null = null;
  let blend = 1;
  const BLEND_TIME = 0.14;
  const mLocal = new Matrix();
  const mMain = new Matrix();
  const tmp = new Vector3();
  const one = Vector3.One();
  const applied = new Vector3(); // left-arm offset currently added (parent-local)

  const sample = (name: string, sec: number, dt: number) => {
    const g = groups.get(name)!;
    if (g !== current) {
      if (current) {
        for (const tr of tracks) {
          tr.snapP.copyFrom(tr.node.position);
          tr.snapR.copyFrom(tr.node.rotationQuaternion!);
          tr.snapS.copyFrom(tr.node.scaling);
        }
        blend = 0;
      }
      current = g;
    }
    g.goToFrame(sec * FPS);
    if (blend < 1) {
      blend = Math.min(1, blend + dt / BLEND_TIME);
      const w = blend * blend * (3 - 2 * blend);
      for (const tr of tracks) {
        Vector3.LerpToRef(tr.snapP, tr.node.position, w, tr.node.position);
        Quaternion.SlerpToRef(tr.snapR, tr.node.rotationQuaternion!, w, tr.node.rotationQuaternion!);
        Vector3.LerpToRef(tr.snapS, tr.node.scaling, w, tr.node.scaling);
      }
    }
  };

  const wDelta = new Vector3();
  const pW = new Vector3();
  const dW = new Vector3();
  const parentInv = new Matrix();
  /** remove last frame's correction so clip sampling / snapshots always see the authored pose */
  const clearLeftArm = () => {
    leftArm.position.subtractInPlace(applied);
    applied.setAll(0);
  };
  const applyLeftArm = () => {
    if (!anchors.length) return;
    const hand = forceWorld(leftHand).getTranslation();
    wDelta.setAll(0);
    let wSum = 0;
    for (const a of anchors) {
      const jw = forceWorld(a.joint);
      Vector3.TransformCoordinatesToRef(a.point, jw, pW);
      const d2 = Vector3.DistanceSquared(pW, hand);
      const w = 1 / (d2 * d2 + 1e-8);
      Vector3.TransformNormalToRef(a.delta, jw, dW);
      wDelta.addInPlace(dW.scaleInPlace(w));
      wSum += w;
    }
    wDelta.scaleInPlace(1 / wSum);
    forceWorld(leftArm.parent as TransformNode).invertToRef(parentInv);
    Vector3.TransformNormalToRef(wDelta, parentInv, applied);
    leftArm.position.addInPlace(applied);
  };

  const updatePoints = () => {
    Matrix.ComposeToRef(mainJ.scaling ?? one, mainJ.rotationQuaternion!, mainJ.position, mLocal);
    mLocal.multiplyToRef(parentStatic, mMain);
    Vector3.TransformCoordinatesToRef(muzzleLocal, mMain, tmp);
    muzzle.position.copyFrom(tmp);
    Vector3.TransformCoordinatesToRef(ejectLocal, mMain, tmp);
    eject.position.copyFrom(tmp);
  };

  const C = M4_CLIPS;
  const hp = gun?.hipPose ?? {};
  const rig: WeaponRig = {
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: dummyHand,
    rightHand: dummyHand,
    meshes,
    hipPose: { px: 0.022 + (hp.px ?? 0), py: -0.03 + (hp.py ?? 0), pz: -0.01 + (hp.pz ?? 0), rx: 0.02 + (hp.rx ?? 0), ry: -0.02 + (hp.ry ?? 0), rz: hp.rz ?? 0 },
    sprintPose: { px: -0.03, py: -0.03, pz: -0.02, rx: 0.32, ry: 0.55, rz: 0.28 },
    adsDistance: geo.eyeRelief,
    adsPose,
    rotationOrigin: M4.grip.clone(),
    hasArms: true,
    authoredEquip: true,
    animate(s: RigState) {
      const dt = s.dt;
      clearLeftArm();
      switch (s.weaponState) {
        case "holstered":
          sample("Holster", C.holster[1], dt);
          break;
        case "equipping":
          sample("Draw", C.draw[0] + s.raised * (C.draw[1] - C.draw[0]), dt);
          break;
        case "holstering":
          sample("Holster", C.holster[0] + (1 - s.raised) * (C.holster[1] - C.holster[0]), dt);
          break;
        default: {
          if (s.weaponState === "reloading" && s.clipName === "holsterDraw") {
            // launchers: lower out of view, load, bring it back up
            const t = s.t;
            if (t < 0.38) sample("Holster", C.holster[0] + (t / 0.38) * (C.holster[1] - C.holster[0]), dt);
            else if (t < 0.55) sample("Holster", C.holster[1], dt);
            else sample("Draw", C.draw[0] + Math.min(1, (t - 0.55) / 0.45) * (C.draw[1] - C.draw[0]), dt);
            break;
          }
          if (s.weaponState === "reloading" && s.clip) {
            sample(s.clip[0] < C.reloadEmpty[0] ? "Reload" : "Reload_Empty", s.clip[0] + s.t * (s.clip[1] - s.clip[0]), dt);
            break;
          }
          const fireLen = C.fire[1] - C.fire[0];
          if (s.sinceShot < fireLen && !(s.mag === 0 && s.sinceShot > 0.08)) sample("Fire", C.fire[0] + s.sinceShot, dt);
          else if (s.mag === 0) sample("Reload_Empty", C.idleEmpty, dt);
          else sample("Draw", C.idle, dt);
        }
      }
      applyLeftArm();
      updatePoints();
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      current = null;
      blend = 1;
      clearLeftArm();
      sample("Draw", C.idle, 0);
      applyLeftArm();
      updatePoints();
    },
  };
  rig.reset();
  root.setEnabled(false);
  return rig;
}

export const ARMS_CREDIT = "M4 – FPS Weapon Animations Pack v1 by BarcodeGames, CC BY 4.0";
