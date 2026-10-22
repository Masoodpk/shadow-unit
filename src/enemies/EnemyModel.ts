import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { BodyZone, HitKind } from "../config/game";
import { Materials } from "../render/Materials";

/**
 * "Breakwater" contractors — the station's hostile occupiers. Slate fatigues,
 * dark plate carriers, sand helmets with a red-orange visor strip and a
 * back-mounted radio with whip antenna (readable silhouette at range).
 *
 * Every body part is an InstancedMesh of a shared source, so all nine soldiers
 * render in roughly one draw call per part type. Parts double as hitboxes.
 */

export interface SoldierParts {
  root: TransformNode;
  hips: TransformNode;
  spine: TransformNode;
  neck: TransformNode;
  shoulderL: TransformNode;
  shoulderR: TransformNode;
  elbowL: TransformNode;
  elbowR: TransformNode;
  hipL: TransformNode;
  hipR: TransformNode;
  kneeL: TransformNode;
  kneeR: TransformNode;
  gun: TransformNode;
  gunMount: TransformNode;
  muzzle: TransformNode;
  flash: InstancedMesh;
  hitboxes: InstancedMesh[];
  all: InstancedMesh[];
}

interface Sources {
  pelvis: Mesh;
  torso: Mesh;
  vest: Mesh;
  pack: Mesh;
  antenna: Mesh;
  helmet: Mesh;
  face: Mesh;
  visor: Mesh;
  upperArm: Mesh;
  forearm: Mesh;
  thigh: Mesh;
  shin: Mesh;
  boot: Mesh;
  rifle: Mesh;
  flash: Mesh;
}

let src: Sources | null = null;

function pbr(scene: Scene, name: string, c: Color3, rough: number, metal = 0, tex?: Materials) {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = c;
  m.roughness = rough;
  m.metallic = metal;
  m.environmentIntensity = 0.6;
  if (tex) m.albedoTexture = tex.polymer;
  return m;
}

/** Box whose pivot sits at its top (limbs) or bottom (torso). */
function pivotBox(scene: Scene, name: string, w: number, h: number, d: number, pivot: "top" | "bottom" | "center", mat: PBRMaterial | StandardMaterial, offsetZ = 0) {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
  m.position.y = pivot === "top" ? -h / 2 : pivot === "bottom" ? h / 2 : 0;
  m.position.z = offsetZ;
  m.bakeCurrentTransformIntoVertices();
  m.material = mat;
  return m;
}

function buildSources(scene: Scene, mats: Materials): Sources {
  const fatigue = pbr(scene, "en_fatigue", new Color3(0.11, 0.125, 0.14), 0.9, 0, mats);
  const vestM = pbr(scene, "en_vest", new Color3(0.1, 0.105, 0.095), 0.8, 0, mats);
  const helmetM = pbr(scene, "en_helmet", new Color3(0.36, 0.33, 0.27), 0.7, 0, mats);
  const black = pbr(scene, "en_black", new Color3(0.05, 0.05, 0.05), 0.85);
  const gunM = pbr(scene, "en_gun", new Color3(0.08, 0.085, 0.09), 0.45, 0.7);
  const visorM = new StandardMaterial("en_visor", scene);
  visorM.disableLighting = true;
  visorM.emissiveColor = new Color3(1.0, 0.22, 0.06).scale(2.4);

  const helmet = MeshBuilder.CreateSphere("en_helmet", { diameter: 0.29, segments: 8, slice: 0.62 }, scene);
  helmet.scaling.set(1, 0.9, 1.05);
  helmet.position.y = 0.08;
  helmet.bakeCurrentTransformIntoVertices();
  helmet.material = helmetM;
  const helmetRim = MeshBuilder.CreateBox("rim", { width: 0.3, height: 0.04, depth: 0.31 }, scene);
  helmetRim.position.y = 0.085;
  const helmetMerged = Mesh.MergeMeshes([helmet, helmetRim], true, true)!;
  helmetMerged.material = helmetM;

  const rifleParts = [
    MeshBuilder.CreateBox("r", { width: 0.05, height: 0.07, depth: 0.42 }, scene),
    MeshBuilder.CreateBox("r", { width: 0.035, height: 0.035, depth: 0.32 }, scene),
    MeshBuilder.CreateBox("r", { width: 0.04, height: 0.09, depth: 0.2 }, scene),
    MeshBuilder.CreateBox("r", { width: 0.03, height: 0.14, depth: 0.05 }, scene),
    MeshBuilder.CreateBox("r", { width: 0.03, height: 0.09, depth: 0.04 }, scene),
  ];
  rifleParts[0].position.set(0, 0, 0.1);
  rifleParts[1].position.set(0, 0.005, 0.46);
  rifleParts[2].position.set(0, -0.01, -0.2);
  rifleParts[3].position.set(0, -0.1, 0.13);
  rifleParts[3].rotation.x = 0.2;
  rifleParts[4].position.set(0, -0.07, -0.02);
  rifleParts[4].rotation.x = 0.3;
  const rifle = Mesh.MergeMeshes(rifleParts, true, true)!;
  rifle.material = gunM;

  const flashMat = new StandardMaterial("en_flash", scene);
  flashMat.disableLighting = true;
  flashMat.emissiveTexture = mats.flashFront;
  flashMat.opacityTexture = mats.flashFront;
  flashMat.emissiveColor = new Color3(1, 0.7, 0.4).scale(2.5);
  flashMat.alphaMode = Constants.ALPHA_ADD;
  flashMat.disableDepthWrite = true;
  flashMat.backFaceCulling = false;
  const flash = MeshBuilder.CreatePlane("en_flashSrc", { size: 0.32 }, scene);
  flash.material = flashMat;
  flash.billboardMode = Mesh.BILLBOARDMODE_ALL;

  const antenna = MeshBuilder.CreateCylinder("en_ant", { diameterTop: 0.006, diameterBottom: 0.012, height: 0.75, tessellation: 4 }, scene);
  antenna.position.y = 0.375;
  antenna.bakeCurrentTransformIntoVertices();
  antenna.material = black;

  const s: Sources = {
    pelvis: pivotBox(scene, "en_pelvis", 0.36, 0.2, 0.23, "center", fatigue),
    torso: pivotBox(scene, "en_torso", 0.42, 0.56, 0.24, "bottom", fatigue),
    vest: pivotBox(scene, "en_vest", 0.46, 0.4, 0.3, "bottom", vestM, 0.005),
    pack: pivotBox(scene, "en_pack", 0.26, 0.3, 0.12, "bottom", vestM),
    antenna,
    helmet: helmetMerged,
    face: pivotBox(scene, "en_face", 0.19, 0.2, 0.2, "bottom", black),
    visor: pivotBox(scene, "en_visorM", 0.2, 0.035, 0.02, "center", visorM),
    upperArm: pivotBox(scene, "en_uarm", 0.12, 0.3, 0.12, "top", fatigue),
    forearm: pivotBox(scene, "en_farm", 0.105, 0.28, 0.105, "top", fatigue),
    thigh: pivotBox(scene, "en_thigh", 0.16, 0.44, 0.17, "top", fatigue),
    shin: pivotBox(scene, "en_shin", 0.13, 0.42, 0.14, "top", fatigue),
    boot: pivotBox(scene, "en_boot", 0.14, 0.1, 0.27, "center", black, 0.05),
    rifle,
    flash,
  };
  for (const m of Object.values(s) as Mesh[]) {
    m.isVisible = false;
    m.isPickable = false;
    m.receiveShadows = false;
  }
  return s;
}

export function prepareSoldierSources(scene: Scene, mats: Materials) {
  if (!src) src = buildSources(scene, mats);
  return src;
}

/** Source meshes that should cast shadows (instances inherit). */
export function soldierShadowSources(): Mesh[] {
  if (!src) return [];
  return [src.pelvis, src.torso, src.vest, src.pack, src.helmet, src.upperArm, src.forearm, src.thigh, src.shin, src.boot, src.rifle];
}

export function buildSoldier(scene: Scene, mats: Materials, owner: unknown, idx: number): SoldierParts {
  const S = prepareSoldierSources(scene, mats);
  const all: InstancedMesh[] = [];
  const hitboxes: InstancedMesh[] = [];
  const node = (name: string, parent: TransformNode | null, x = 0, y = 0, z = 0) => {
    const n = new TransformNode(`${name}_${idx}`, scene);
    n.parent = parent;
    n.position.set(x, y, z);
    return n;
  };
  const inst = (source: Mesh, parent: TransformNode, zone: BodyZone | null, x = 0, y = 0, z = 0) => {
    const i = source.createInstance(`${source.name}_${idx}`);
    i.parent = parent;
    i.position.set(x, y, z);
    i.isPickable = zone !== null;
    i.metadata = zone ? { kind: HitKind.EnemyPart, enemy: owner, zone } : null;
    all.push(i);
    if (zone) hitboxes.push(i);
    return i;
  };

  const root = node("soldier", null);
  const hips = node("hips", root, 0, 0.94, 0);
  inst(S.pelvis, hips, "torso");
  const spine = node("spine", hips, 0, 0.06, 0);
  inst(S.torso, spine, "torso");
  inst(S.vest, spine, "torso", 0, 0.14, 0);
  inst(S.pack, spine, "torso", 0, 0.2, -0.2);
  inst(S.antenna, spine, null, 0.09, 0.45, -0.22).rotation.z = -0.12;
  const neck = node("neck", spine, 0, 0.56, 0);
  inst(S.face, neck, "head", 0, 0.0, 0.01);
  inst(S.helmet, neck, "head", 0, 0.1, -0.005);
  inst(S.visor, neck, "head", 0, 0.165, 0.135);

  const shoulderL = node("shL", spine, -0.27, 0.5, 0);
  const shoulderR = node("shR", spine, 0.27, 0.5, 0);
  inst(S.upperArm, shoulderL, "limb");
  inst(S.upperArm, shoulderR, "limb");
  const elbowL = node("elL", shoulderL, 0, -0.29, 0);
  const elbowR = node("elR", shoulderR, 0, -0.29, 0);
  inst(S.forearm, elbowL, "limb");
  inst(S.forearm, elbowR, "limb");

  const hipL = node("hipL", hips, -0.1, -0.06, 0);
  const hipR = node("hipR", hips, 0.1, -0.06, 0);
  inst(S.thigh, hipL, "limb");
  inst(S.thigh, hipR, "limb");
  const kneeL = node("kneeL", hipL, 0, -0.43, 0);
  const kneeR = node("kneeR", hipR, 0, -0.43, 0);
  inst(S.shin, kneeL, "limb");
  inst(S.shin, kneeR, "limb");
  inst(S.boot, kneeL, "limb", 0, -0.43, 0);
  inst(S.boot, kneeR, "limb", 0, -0.43, 0);

  const gunMount = node("gunMount", spine, 0.11, 0.36, 0.28);
  const gun = node("gun", gunMount);
  inst(S.rifle, gun, null);
  const muzzle = node("muzzle", gun, 0, 0.005, 0.64);
  const flash = S.flash.createInstance(`flash_${idx}`);
  flash.parent = muzzle;
  flash.isPickable = false;
  flash.setEnabled(false);

  return { root, hips, spine, neck, shoulderL, shoulderR, elbowL, elbowR, hipL, hipR, kneeL, kneeR, gun, gunMount, muzzle, flash, hitboxes, all };
}

export function setPartsVisible(parts: SoldierParts, on: boolean) {
  for (const m of parts.all) (m as AbstractMesh).setEnabled(on);
}

export const tmpV = new Vector3();
