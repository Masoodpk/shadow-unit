import "@babylonjs/loaders/glTF/2.0/Extensions/KHR_materials_specular";
import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import { extFor } from "./ArmsRig";
import knifeUrl from "../assets/weapons/knife_fp.glb?url";

/**
 * Combat knife with its own arms: "Knife animated" by DJMaesen (CC BY 4.0).
 * One authored timeline (centimetres, camera at the origin looking +Z) holds every move;
 * the rig samples it at the time the weapon / attack state dictates:
 *   idle 0–1.45 s (breathing) · slash 1.45–2.2 · slash 2.2–2.9 · slash 2.9–3.7 ·
 *   heavy strike 3.7–4.6 · draw 4.75–5.1 (rises from below)
 * Every clip starts and ends on the same rest pose, so cuts between them don't pop.
 */
const CM = 0.01;
const FPS = 60;
export const KNIFE_CLIPS = {
  idle: [0, 1.45] as [number, number],
  slashA: [1.45, 2.2] as [number, number],
  slashB: [2.2, 2.9] as [number, number],
  slashC: [2.9, 3.7] as [number, number],
  stab: [3.7, 4.6] as [number, number],
  draw: [4.75, 5.1] as [number, number],
};

/** the idle is sampled up to here: past it the hand starts lifting for the first slash */
const IDLE_END = 1.3;

/** which authored attack is playing */
export type SwingKind = "slashA" | "slashB" | "slashC" | "stab";

export async function loadKnifeFPContainer(scene: Scene, onProgress?: (p: number) => void) {
  return LoadAssetContainerAsync(knifeUrl, scene, {
    pluginExtension: extFor(knifeUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
}

export function buildKnifeRigFP(scene: Scene, c: AssetContainer): WeaponRig {
  c.addAllToScene();
  const glbRoot = c.meshes[0] as unknown as TransformNode;
  const g = c.animationGroups[0];
  g.stop();
  g.start(false, 1, g.from, g.to);
  g.pause();
  const at = (sec: number) => g.goToFrame(Math.min(g.to, sec * FPS));

  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.2;
    if (/arms/.test(m.name)) {
      m.metallic = 0;
      m.roughness = Math.max(m.roughness ?? 0.8, 0.7);
    }
  }

  const id = "knife" as const;
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  anchor.scaling.setAll(CM);
  glbRoot.parent = anchor;

  const dummy = () => {
    const t = new TransformNode(`${id}Pt`, scene);
    t.parent = root;
    return t;
  };
  const muzzle = dummy();
  muzzle.position.set(0.07, -0.09, 0.3);
  const eject = dummy();
  const sight = dummy();
  sight.position.set(0, 0, 0.3);
  const hand = dummy();

  const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0) as AbstractMesh[];
  for (const m of meshes) {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
    m.alwaysSelectAsActiveMesh = true;
  }

  let idleT = 0;
  const C = KNIFE_CLIPS;
  const span = (r: [number, number], u: number) => r[0] + Math.max(0, Math.min(1, u)) * (r[1] - r[0]);
  const rig: WeaponRig = {
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: hand,
    rightHand: hand,
    meshes,
    // the authored camera sits a little forward of ours: push the arms out 20 cm so the hand frames bottom-right
    hipPose: { px: -0.01, py: -0.005, pz: 0.2, rx: 0, ry: 0, rz: 0 },
    sprintPose: { px: -0.02, py: -0.04, pz: -0.02, rx: 0.18, ry: 0.22, rz: 0.12 },
    adsDistance: 0.3,
    hasArms: true,
    authoredEquip: true,
    animate(s: RigState) {
      idleT += s.dt;
      if (s.weaponState === "equipping" || s.weaponState === "holstering" || s.weaponState === "holstered") {
        at(span(C.draw, s.weaponState === "holstered" ? 0 : s.raised));
        return;
      }
      if (s.swing !== undefined && s.swing !== null && s.swing >= 0 && s.swingKind) {
        const clip = (C as Record<string, [number, number]>)[s.swingKind] ?? C.slashA;
        at(span(clip, s.swing));
        return;
      }
      // breathing: forward then back over the idle (its last frames run into the first slash's
      // wind-up, and a plain loop snapped the hand from its end pose back to its start pose)
      const i0 = C.idle[0], len = IDLE_END - i0;
      const t = idleT % (2 * len);
      at(i0 + (t < len ? t : 2 * len - t));
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      idleT = 0;
      at(C.idle[0]);
    },
  };
  rig.reset();
  root.setEnabled(false);
  return rig;
}
