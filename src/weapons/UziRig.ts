import "@babylonjs/loaders/glTF/2.0/Extensions/EXT_texture_webp";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { UZI_CLIPS } from "../config/weapons";
import { RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import { extFor, forceWorld, solveAds } from "./ArmsRig";
import uziUrl from "../assets/weapons/uzi.glb?url";

/**
 * UZI with its own arms: "UZI | First Person Animations (2026 Remake)" by 1Matzh (CC BY 4.0), prepared by
 * scripts/assets/prep-uzi.mjs (which also repairs the file's skin). One Rigify skeleton carries the gloved
 * arms, sleeves, watch, gun and magazine; 13 authored clips, one animation group each (rig|Equip, rig|Idle,
 * rig|Fire, rig|Reload, rig|Reload_Empty, rig|Inspect, rig|Unequip, …).
 *
 * Units are metres in the loaded frame (glTF → Babylon), +Z forward. The file has no camera, so the eye
 * is ours: a point behind and just above the receiver that frames the idle pose like the other guns. The
 * rig puts that eye on the viewmodel origin (the camera frame every rig shares). Clips are sampled at the
 * time the weapon state machine dictates (as the Vector does) with a short pose cross-fade; the idle loops
 * on its own clock. Draw and holster ride on the shared procedural drop (the authored equip starts only
 * ~18 cm off the idle pose, so it plays as the flourish while the gun comes up).
 */
const FPS = 60;

/** Measured in the loaded frame (metres) in the idle pose: the eye we chose, the iron sights, the grip. */
const U = {
  eye: new Vector3(-0.04, 1.5, 0.06),
  rearSight: new Vector3(0.0495, 1.4626, 0.27),
  frontSight: new Vector3(0.0495, 1.4686, 0.56),
  muzzle: new Vector3(0.0495, 1.417, 0.665),
  eject: new Vector3(0.072, 1.44, 0.4),
  grip: new Vector3(0.05, 1.33, 0.39),
};

export async function loadUziContainer(scene: Scene, onProgress?: (p: number) => void) {
  return LoadAssetContainerAsync(uziUrl, scene, {
    pluginExtension: extFor(uziUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
}

interface Track {
  node: TransformNode;
  snapP: Vector3;
  snapR: Quaternion;
  snapS: Vector3;
}

export function buildUziRig(scene: Scene, c: AssetContainer): WeaponRig {
  c.addAllToScene();
  const glbRoot = c.meshes[0] as unknown as TransformNode;
  const nodes = c.transformNodes;
  const node = (prefix: string) => nodes.find((n) => n.name.startsWith(prefix))!;

  const groups = new Map<string, AnimationGroup>();
  for (const g of c.animationGroups) {
    g.stop();
    groups.set(g.name, g);
  }
  for (const g of groups.values()) {
    g.start(false, 1, g.from, g.to);
    g.pause();
  }

  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.1;
    if (/glove|cloth|body/i.test(m.name)) {
      m.metallic = 0;
      m.roughness = Math.max(m.roughness ?? 0.8, 0.75);
    }
  }

  // ---- rig root: the eye on the origin
  const id = "uzi" as const;
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  anchor.position.copyFrom(U.eye).scaleInPlace(-1);
  glbRoot.parent = anchor;
  const toCam = (p: Vector3) => p.subtract(U.eye);

  // muzzle and ejection port ride the gun's body bone (through reloads, inspects and the fire kick)
  const body = node("UZI Body");
  const muzzle = new TransformNode(`${id}Muzzle`, scene);
  muzzle.parent = root;
  const eject = new TransformNode(`${id}Eject`, scene);
  eject.parent = root;
  const tagFlash = new TransformNode(`${id}TagFlash`, scene);
  const tagBrass = new TransformNode(`${id}TagBrass`, scene);
  const rear = toCam(U.rearSight);
  const front = toCam(U.frontSight);
  const sight = new TransformNode(`${id}Sight`, scene);
  sight.parent = root;
  sight.position.copyFrom(rear);
  const dummy = new TransformNode(`${id}Hand`, scene);
  dummy.parent = root;
  const grip = toCam(U.grip);

  const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0) as AbstractMesh[];
  for (const m of meshes) {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
    m.alwaysSelectAsActiveMesh = true;
  }

  // ---- cross-fade tracks (every animated node)
  const trackSet = new Set<TransformNode>();
  for (const g of groups.values()) for (const ta of g.targetedAnimations) if (ta.target instanceof TransformNode) trackSet.add(ta.target);
  const tracks: Track[] = [...trackSet].map((n) => {
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    return { node: n, snapP: new Vector3(), snapR: new Quaternion(), snapS: new Vector3(1, 1, 1) };
  });

  let current: AnimationGroup | null = null;
  let blend = 1;
  const BLEND_TIME = 0.12;
  const sample = (name: string, sec: number, dt: number) => {
    const g = groups.get(name);
    if (!g) return;
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
    g.goToFrame(Math.min(g.to, Math.max(g.from, sec * FPS)));
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

  const rootInv = new Matrix();
  const updatePoints = () => {
    forceWorld(root).invertToRef(rootInv);
    Vector3.TransformCoordinatesToRef(forceWorld(tagFlash).getTranslation(), rootInv, muzzle.position);
    Vector3.TransformCoordinatesToRef(forceWorld(tagBrass).getTranslation(), rootInv, eject.position);
  };

  // the tags hang off the body bone at the offsets measured in the idle pose
  // (the points were measured with the glTF root at the origin, so read the bone with it unparented)
  sample("rig|Idle", 0, 0);
  glbRoot.parent = null;
  const bodyInv = Matrix.Invert(forceWorld(body));
  tagFlash.position.copyFrom(Vector3.TransformCoordinates(U.muzzle, bodyInv));
  tagBrass.position.copyFrom(Vector3.TransformCoordinates(U.eject, bodyInv));
  glbRoot.parent = anchor;
  tagFlash.parent = body;
  tagBrass.parent = body;

  let idleT = 0;
  const C = UZI_CLIPS;
  const rig: WeaponRig = {
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: dummy,
    rightHand: dummy,
    meshes,
    hipPose: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    sprintPose: { px: -0.03, py: -0.03, pz: -0.02, rx: 0.3, ry: 0.5, rz: 0.26 },
    adsDistance: 0.2,
    adsPose: solveAds(rear, front, 0.2, grip),
    rotationOrigin: grip.clone(),
    hasArms: true,
    animate(s: RigState) {
      const dt = s.dt;
      idleT = (idleT + dt) % C.idle;
      switch (s.weaponState) {
        case "holstered":
          sample("rig|Unequip", C.holster[1], dt);
          break;
        case "equipping":
          sample("rig|Equip", C.draw[0] + s.raised * (C.draw[1] - C.draw[0]), dt);
          break;
        case "holstering":
          sample("rig|Unequip", (1 - s.raised) * C.holster[1], dt);
          break;
        default:
          if (s.weaponState === "reloading" && s.clip && s.clipName) {
            sample(s.clipName, s.clip[0] + s.t * (s.clip[1] - s.clip[0]), dt);
          } else if (s.sinceShot < C.fire[1]) sample("rig|Fire", s.sinceShot, dt);
          else if (s.inspect !== undefined && s.inspect >= 0 && s.weaponState === "ready") sample("rig|Inspect", C.inspect[0] + s.inspect * (C.inspect[1] - C.inspect[0]), dt);
          else sample("rig|Idle", idleT, dt);
      }
      updatePoints();
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      current = null;
      blend = 1;
      idleT = 0;
      sample("rig|Idle", 0, 0);
      updatePoints();
    },
  };
  rig.reset();
  root.setEnabled(false);
  return rig;
}

export const UZI_CREDIT = "UZI | First Person Animations (2026 Remake) by 1Matzh, CC BY 4.0";
