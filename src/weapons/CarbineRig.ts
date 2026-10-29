import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { Scene } from "@babylonjs/core/scene";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CARBINE_CLIPS } from "../config/weapons";
import { RigState, WeaponRig, ZERO_POSE } from "./WeaponModels";
import { extFor, forceWorld } from "./ArmsRig";
import carbineUrl from "../assets/weapons/carbine.glb?url";

/**
 * The carbine with its own arms: "fps animated carbine" by DJMaesen (CC BY 4.0) — skinned arms and a
 * gun with a moving bolt, charging handle and magazine, one 7.4 s timeline of authored actions
 * (CARBINE_CLIPS reads where each one is). What the file has no clip for is done here:
 *   - the shot: the bolt cycles back and forward on the trigger (and stays back on an empty magazine);
 *   - the butt-stroke, walking, sprinting, aiming, landing: the shared viewmodel moves the whole rig.
 *
 * The file is in centimetres (its root carries a 0.0208 scale of its own); the rig puts it in metres.
 */
const FPS = 60;
/** native units → metres (the model's centimetres), relative to the loader's own root scale */
const CM = 0.0085;

/** bolt travel on the file's own axis (cm): closed 14, locked back 4.8 */
const BOLT_CLOSED = 14;
const BOLT_OPEN = 4.8;

interface Track {
  node: TransformNode;
  snapP: Vector3;
  snapR: Quaternion;
  snapS: Vector3;
}

export async function loadCarbineContainer(scene: Scene, onProgress?: (p: number) => void) {
  return LoadAssetContainerAsync(carbineUrl, scene, {
    pluginExtension: extFor(carbineUrl),
    onProgress: (e) => e.lengthComputable && onProgress?.(e.loaded / e.total),
  });
}

export function buildCarbineRig(scene: Scene, c: AssetContainer): WeaponRig {
  c.addAllToScene();
  const glbRoot = c.meshes[0] as unknown as TransformNode;
  const node = (name: string) => c.transformNodes.find((n) => n.name === name) ?? (c.meshes.find((m) => m.name === name) as TransformNode | undefined)!;

  const group: AnimationGroup = c.animationGroups[0];
  group.stop();
  group.start(false, 1, group.from, group.to);
  group.pause();
  const total = (group.to - group.from) / FPS;

  for (const m of c.materials) {
    if (!(m instanceof PBRMaterial)) continue;
    m.maxSimultaneousLights = 4;
    m.environmentIntensity = 1.1;
    m.metallic = Math.min(m.metallic ?? 0, 0.6);
  }

  // ---- rig root: the file's own scale brought to metres
  const id = "carbine" as const;
  const root = new TransformNode(`${id}Rig`, scene);
  const anchor = new TransformNode(`${id}Anchor`, scene);
  anchor.parent = root;
  glbRoot.parent = anchor;
  glbRoot.computeWorldMatrix(true);
  // (what the loader left the model at: world units per file unit, along the gun)
  const base = node("base_carbine_0") as unknown as AbstractMesh;
  const om = forceWorld(node("carbine")).m;
  const own = Math.hypot(om[0], om[1], om[2]);
  anchor.scaling.setAll(CM / own);

  const bolt = node("bolt");
  const boltCatch = node("boltcatch");
  const carbineNode = node("carbine");
  const lens = node("lens");
  const rWrist = node("R_wrist_027");

  const meshes = c.meshes.filter((m) => m.getTotalVertices() > 0) as AbstractMesh[];
  for (const m of meshes) {
    m.isPickable = false;
    m.doNotSyncBoundingInfo = true;
    m.alwaysSelectAsActiveMesh = true;
  }

  // ---- cross-fade tracks (every animated node)
  const trackSet = new Set<TransformNode>();
  for (const ta of group.targetedAnimations) if (ta.target instanceof TransformNode) trackSet.add(ta.target);
  const tracks: Track[] = [...trackSet].map((n) => {
    if (!n.rotationQuaternion) n.rotationQuaternion = Quaternion.FromEulerVector(n.rotation);
    return { node: n, snapP: new Vector3(), snapR: new Quaternion(), snapS: new Vector3(1, 1, 1) };
  });
  const boltBase = bolt.position.clone();
  const catchBase = boltCatch.position.clone();

  let mode = "";
  let blend = 1;
  const BLEND_TIME = 0.14;
  /** pose the timeline at `sec` (clips are told apart so a change of action cross-fades) */
  const sample = (kind: string, sec: number, dt: number) => {
    if (kind !== mode) {
      if (mode) {
        for (const tr of tracks) {
          tr.snapP.copyFrom(tr.node.position);
          tr.snapR.copyFrom(tr.node.rotationQuaternion!);
          tr.snapS.copyFrom(tr.node.scaling);
        }
        blend = 0;
      }
      mode = kind;
    }
    group.goToFrame(group.from + Math.min(total, Math.max(0, sec)) * FPS);
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

  // ---- measured points, in rig space, at the hold pose
  sample("idle", CARBINE_CLIPS.idle, 0);
  glbRoot.computeWorldMatrix(true);
  forceWorld(base);
  const rootInv = forceWorld(root).clone().invert();
  const toRig = (p: Vector3) => Vector3.TransformCoordinates(p, rootInv);
  const nodePos = (n: TransformNode) => toRig(forceWorld(n).getTranslation());
  // muzzle: the centre of the barrel's front-most vertices
  let muzzleRig = new Vector3(0, 0.1, 0.9);
  {
    const pos = base.getVerticesData(VertexBuffer.PositionKind)!;
    const wm = forceWorld(base);
    const tmp = new Vector3();
    let maxZ = -Infinity;
    const pts: Vector3[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      Vector3.TransformCoordinatesFromFloatsToRef(pos[i], pos[i + 1], pos[i + 2], wm, tmp);
      const r = toRig(tmp);
      pts.push(r);
      if (r.z > maxZ) maxZ = r.z;
    }
    const front = pts.filter((p) => p.z > maxZ - 0.012);
    const mid = front.reduce((a, p) => a.addInPlace(p), new Vector3()).scaleInPlace(1 / Math.max(1, front.length));
    muzzleRig = new Vector3(mid.x, mid.y, maxZ + 0.01);
  }
  const lensRig = nodePos(lens);
  const boltRig = nodePos(bolt);
  const grip = nodePos(rWrist);

  // the muzzle and ejection port ride the gun (they follow it through reloads and inspects)
  const toNode = (n: TransformNode, p: Vector3) => Vector3.TransformCoordinates(Vector3.TransformCoordinates(p, forceWorld(root)), forceWorld(n).clone().invert());
  const muzzle = new TransformNode(`${id}Muzzle`, scene);
  muzzle.parent = carbineNode;
  muzzle.position.copyFrom(toNode(carbineNode, muzzleRig));
  const eject = new TransformNode(`${id}Eject`, scene);
  eject.parent = carbineNode;
  eject.position.copyFrom(toNode(carbineNode, boltRig.add(new Vector3(0.035, 0.01, 0))));
  const sight = new TransformNode(`${id}Sight`, scene);
  sight.parent = root;
  sight.position.copyFrom(lensRig);
  const dummy = new TransformNode(`${id}Hand`, scene);
  dummy.parent = root;

  const RIG = CARBINE_CLIPS;
  const rig: WeaponRig = {
    id,
    root,
    muzzle,
    eject,
    sight,
    leftHand: dummy,
    rightHand: dummy,
    meshes,
    hipPose: { px: 0.02, py: -0.25, pz: 0.22, rx: 0, ry: 0, rz: 0 },
    sprintPose: { px: -0.05, py: -0.07, pz: -0.03, rx: 0.34, ry: 0.5, rz: 0.26 },
    adsDistance: 0.13,
    rotationOrigin: grip.clone(),
    hasArms: true,
    animate(s: RigState) {
      const dt = s.dt;
      if (s.weaponState === "reloading" && s.clip) {
        sample(s.phase === "reloadEmpty" ? "reloadEmpty" : "reload", s.clip[0] + s.t * (s.clip[1] - s.clip[0]), dt);
      } else if (s.inspect !== undefined && s.inspect >= 0 && s.weaponState === "ready") {
        sample("inspect", RIG.inspect[0] + s.inspect * (RIG.inspect[1] - RIG.inspect[0]), dt);
      } else {
        sample("idle", RIG.idle, dt);
        // the shot: the bolt runs back and home inside one cycle; an empty magazine leaves it back
        const cycle = Math.min(0.075, 55 / Math.max(1, s.rpm ?? 750));
        let k = 0; // 0 closed … 1 fully back
        if (s.weaponState === "ready" && s.sinceShot < cycle) {
          const t = s.sinceShot / cycle;
          k = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
        }
        if (s.mag <= 0 && s.weaponState === "ready" && s.sinceShot >= cycle) k = 1;
        if (k > 0) {
          const dz = -(BOLT_CLOSED - BOLT_OPEN) * k;
          bolt.position.z = boltBase.z + dz;
          boltCatch.position.z = catchBase.z + dz;
        }
      }
    },
    reloadPose() {
      return ZERO_POSE;
    },
    reset() {
      mode = "";
      blend = 1;
      sample("idle", RIG.idle, 0);
    },
  };
  rig.reset();
  root.setEnabled(false);
  return rig;
}

export const CARBINE_CREDIT = "fps animated carbine by DJMaesen, CC BY 4.0 (Sketchfab)";
