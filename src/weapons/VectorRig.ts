import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_mesh_quantization";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VECTOR_CLIPS } from "../config/weapons";
import { RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import { extFor, forceWorld, solveAds } from "./ArmsRig";
import vectorUrl from "../assets/weapons/fennec.glb?url";

/**
 * KRISS Vector with its own arms: the MW2019 "Fennec" viewmodel (skinned arms +
 * gun on one skeleton, authored draw / fire / reload / empty reload / holster).
 *
 * Units are inches with the eye (tag_view) at the origin, +Z forward. The rig
 * scales by 0.0254 and puts tag_view on the viewmodel origin, so it shares the
 * camera frame with the M4-pack rigs. Clips are sampled at the time the weapon
 * state machine dictates (same model as ArmsRig), with a short pose cross-fade.
 */
const IN = 0.0254;
const FPS = 60;

/** Measured in the authored frame (inches): iron sights, grip. */
const V = {
  rearSight: new Vector3(2.383, -0.252, 7.46),
  frontSight: new Vector3(2.395, -0.295, 17.9),
  grip: new Vector3(3.0, -4.6, 6.4),
  eye: new Vector3(0, -0.0002, -0.1063),
};

export async function loadVectorContainer(scene: Scene, onProgress?: (p: number) => void) {
  return LoadAssetContainerAsync(vectorUrl, scene, {
    pluginExtension: extFor(vectorUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
}

interface Track {
  node: TransformNode;
  snapP: Vector3;
  snapR: Quaternion;
  snapS: Vector3;
}

export function buildVectorRig(scene: Scene, c: AssetContainer): WeaponRig {
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
    m.environmentIntensity = 1.15;
    if (/arms|glove|skintone|kneepad/.test(m.name)) {
      m.metallic = 0;
      m.roughness = Math.max(m.roughness ?? 0.8, 0.75);
    }
  }

  // ---- rig root: inches → metres, eye on the origin
  const id = "vector" as const;
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  anchor.scaling.setAll(IN);
  anchor.position.copyFrom(V.eye).scaleInPlace(-IN);
  glbRoot.parent = anchor;
  const toCam = (p: Vector3) => p.subtract(V.eye).scaleInPlace(IN);

  const tagFlash = node("tag_flash_0");
  const tagBrass = node("tag_brass");
  const muzzle = new TransformNode(`${id}Muzzle`, scene);
  muzzle.parent = root;
  const eject = new TransformNode(`${id}Eject`, scene);
  eject.parent = root;
  const rear = toCam(V.rearSight);
  const front = toCam(V.frontSight);
  const sight = new TransformNode(`${id}Sight`, scene);
  sight.parent = root;
  sight.position.copyFrom(rear);
  const dummy = new TransformNode(`${id}Hand`, scene);
  dummy.parent = root;
  const grip = toCam(V.grip);

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
    g.goToFrame(Math.max(0, sec) * FPS);
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

  // muzzle / ejection port follow their tags (expressed in rig-root space)
  const rootInv = new Matrix();
  const updatePoints = () => {
    forceWorld(root).invertToRef(rootInv);
    Vector3.TransformCoordinatesToRef(forceWorld(tagFlash).getTranslation(), rootInv, muzzle.position);
    Vector3.TransformCoordinatesToRef(forceWorld(tagBrass).getTranslation(), rootInv, eject.position);
  };

  const C = VECTOR_CLIPS;
  const rig: WeaponRig = {
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: dummy,
    rightHand: dummy,
    meshes,
    hipPose: { px: -0.012, py: 0.006, pz: 0.012, rx: 0, ry: 0, rz: 0 },
    sprintPose: { px: -0.03, py: -0.03, pz: -0.02, rx: 0.3, ry: 0.5, rz: 0.26 },
    adsDistance: 0.16,
    adsPose: solveAds(rear, front, 0.16, grip),
    rotationOrigin: grip.clone(),
    hasArms: true,
    authoredEquip: true,
    animate(s: RigState) {
      const dt = s.dt;
      switch (s.weaponState) {
        case "holstered":
          sample("holster", C.holster[1], dt);
          break;
        case "equipping":
          sample("draw_first", C.draw[0] + s.raised * (C.draw[1] - C.draw[0]), dt);
          break;
        case "holstering":
          sample("holster", (1 - s.raised) * C.holster[1], dt);
          break;
        default:
          if (s.weaponState === "reloading" && s.clip && s.clipName) {
            sample(s.clipName, s.clip[0] + s.t * (s.clip[1] - s.clip[0]), dt);
          } else if (s.sinceShot < C.fire[1]) sample("fire", s.sinceShot, dt);
          else sample("draw_first", C.idle, dt);
      }
      updatePoints();
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      current = null;
      blend = 1;
      sample("draw_first", C.idle, 0);
      updatePoints();
    },
  };
  rig.reset();
  root.setEnabled(false);
  return rig;
}

export const VECTOR_CREDIT = "MW 2019 Fennec (KRISS Vector) viewmodel by vipers (Sketchfab)";
