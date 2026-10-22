import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HitKind } from "../config/game";
import { mulberry32 } from "../core/math";
import type { PropPlacement } from "./Props";

/**
 * A closed station's tunnel mouths and dead ends: plywood hoarding wall to wall and floor to ceiling
 * (set a little way inside the opening, so the walls round it hide its edges and all you see is the
 * opening boarded up), timber posts and rails, hazard tape, a works notice — and a few crates and
 * concrete barriers in front of it. You can't see past it, walk through it or shoot through it.
 */
export interface HoardingSpec {
  /** the middle of its foot (on the floor in front of the opening) */
  at: Vector3;
  /** the way it faces (toward the station), in plan */
  facing: Vector3;
  width: number;
  height: number;
  /** crates and barriers at its foot (none where you can't get near it anyway) */
  dressing?: boolean;
  /** the notice's words (top line, second line) */
  notice?: [string, string];
}

let shared: { post: StandardMaterial; concrete: StandardMaterial } | null = null;

/**
 * plywood: one 1.22 × 2.44 m sheet per tile, the grain running along it, a dark seam at its edges.
 * (Drawn fresh for each wall — its tiling is its own; a cloned DynamicTexture is never drawn, and an
 * undrawn one holds up the shader warm-up for good.)
 */
function plywood(scene: Scene, uScale: number, vScale: number) {
  const pt = new DynamicTexture("hoardPly", { width: 256, height: 512 }, scene, true);
  const g = pt.getContext() as CanvasRenderingContext2D;
  const rnd = mulberry32(7);
  g.fillStyle = "#a9814f";
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 140; i++) {
    const x = rnd() * 256;
    g.strokeStyle = rnd() < 0.5 ? "rgba(90,58,28,0.18)" : "rgba(220,180,120,0.14)";
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (rnd() - 0.5) * 30, 170, x + (rnd() - 0.5) * 30, 340, x + (rnd() - 0.5) * 20, 512);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    g.fillStyle = "rgba(70,45,20,0.35)";
    g.beginPath();
    g.ellipse(rnd() * 256, rnd() * 512, 3 + rnd() * 5, 8 + rnd() * 10, 0, 0, Math.PI * 2);
    g.fill();
  }
  // grime at the foot, the sheet's edges
  const grime = g.createLinearGradient(0, 512, 0, 380);
  grime.addColorStop(0, "rgba(30,25,20,0.55)");
  grime.addColorStop(1, "rgba(30,25,20,0)");
  g.fillStyle = grime;
  g.fillRect(0, 380, 256, 132);
  g.fillStyle = "rgba(40,28,14,0.8)";
  g.fillRect(0, 0, 256, 3);
  g.fillRect(0, 0, 3, 512);
  pt.update();
  pt.wrapU = pt.wrapV = Texture.WRAP_ADDRESSMODE;
  pt.anisotropicFilteringLevel = 8;
  pt.uScale = uScale;
  pt.vScale = vScale;
  const ply = new StandardMaterial("hoardPly", scene);
  ply.diffuseTexture = pt;
  ply.specularColor = new Color3(0.05, 0.05, 0.05);
  return ply;
}

/** black-and-yellow hazard tape, a stripe every 16 cm */
function hazardTape(scene: Scene, uScale: number) {
  const tt = new DynamicTexture("hoardTape", { width: 256, height: 32 }, scene, true);
  const tg = tt.getContext() as CanvasRenderingContext2D;
  tg.fillStyle = "#f2c200";
  tg.fillRect(0, 0, 256, 32);
  tg.fillStyle = "#111";
  for (let x = -32; x < 256; x += 32) {
    tg.beginPath();
    tg.moveTo(x, 32);
    tg.lineTo(x + 16, 32);
    tg.lineTo(x + 32, 0);
    tg.lineTo(x + 16, 0);
    tg.fill();
  }
  tt.update();
  tt.wrapU = Texture.WRAP_ADDRESSMODE;
  tt.uScale = uScale;
  const tape = new StandardMaterial("hoardTape", scene);
  tape.diffuseTexture = tt;
  tape.specularColor = new Color3(0.15, 0.15, 0.15);
  return tape;
}

function materials(scene: Scene) {
  if (shared && shared.post.getScene() === scene) return shared;
  const post = new StandardMaterial("hoardPost", scene);
  post.diffuseColor = new Color3(0.36, 0.25, 0.14);
  post.specularColor = new Color3(0.04, 0.04, 0.04);
  const concrete = new StandardMaterial("hoardConcrete", scene);
  concrete.diffuseColor = new Color3(0.55, 0.54, 0.5);
  concrete.specularColor = new Color3(0.05, 0.05, 0.05);
  return (shared = { post, concrete });
}

function noticeMaterial(scene: Scene, lines: [string, string]) {
  const t = new DynamicTexture("hoardNotice", { width: 512, height: 320 }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.fillStyle = "#f4f1e8";
  g.fillRect(0, 0, 512, 320);
  g.fillStyle = "#c8102e";
  g.fillRect(0, 0, 512, 92);
  g.fillStyle = "#fff";
  g.font = "bold 64px Arial, sans-serif";
  g.textAlign = "center";
  g.fillText("DANGER", 256, 70);
  g.fillStyle = "#111";
  g.font = "bold 42px Arial, sans-serif";
  g.fillText(lines[0], 256, 160);
  g.font = "28px Arial, sans-serif";
  g.fillText(lines[1], 256, 212);
  g.font = "20px Arial, sans-serif";
  g.fillText("METRO MAINTENANCE — NO UNAUTHORISED ACCESS", 256, 282);
  // weathering
  const rnd = mulberry32(lines[0].length * 13 + lines[1].length);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(80,70,50,${0.04 + rnd() * 0.08})`;
    g.fillRect(rnd() * 512, rnd() * 320, 2 + rnd() * 10, 2 + rnd() * 6);
  }
  t.update();
  const m = new StandardMaterial("hoardNotice", scene);
  m.diffuseTexture = t;
  m.specularColor = new Color3(0.1, 0.1, 0.1);
  return m;
}

/** build one hoarding: its meshes (the panel is a collider: movement, bullets, sight) and the props at its foot */
export function buildHoarding(scene: Scene, spec: HoardingSpec, seed: number): { meshes: Mesh[]; colliders: Mesh[]; props: PropPlacement[] } {
  const M = materials(scene);
  const rnd = mulberry32(seed);
  const n = spec.facing.clone();
  n.y = 0;
  n.normalize();
  const yaw = Math.atan2(n.x, n.z);
  // across the opening (its local x), and a point along it
  const ax = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = (u: number, h: number, f: number) => spec.at.add(ax.scale(u)).addInPlace(n.scale(f)).addInPlaceFromFloats(0, h, 0);
  const meshes: Mesh[] = [];
  const colliders: Mesh[] = [];
  const box = (name: string, w: number, h: number, d: number, p: Vector3, mat: StandardMaterial) => {
    const b = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
    b.position.copyFrom(p);
    b.rotation.y = yaw;
    b.material = mat;
    b.isPickable = false;
    b.receiveShadows = true;
    meshes.push(b);
    return b;
  };
  const { width: W, height: H } = spec;

  // the sheets (one box; the texture tiles a sheet per 1.22 × 2.44 m — its own copy, sized to this wall)
  const plyMat = plywood(scene, W / 1.22, H / 2.44);
  const panel = box("hoardPanel", W, H, 0.05, at(0, H / 2, 0), plyMat);
  panel.isPickable = true;
  panel.checkCollisions = true;
  panel.metadata = { kind: HitKind.Level, surface: "wood" };
  colliders.push(panel);
  // posts every sheet and a half, rails top and bottom (on the near side)
  for (let u = -W / 2 + 0.6; u < W / 2; u += 1.83) box("hoardPost", 0.1, H, 0.1, at(u, H / 2, 0.08), M.post);
  for (const h of [0.35, 2.6]) box("hoardRail", W, 0.12, 0.06, at(0, h, 0.1), M.post);
  // hazard tape: a band at waist height and one above head height
  const tapeMat = hazardTape(scene, W / 1.6);
  for (const h of [1.15, 3.3]) box("hoardTape", W, 0.16, 0.012, at(0, h, 0.14), tapeMat);
  // the notice, at eye height from where you'll see it
  // (a wide wall shows through several openings: a notice every few metres, so each opening has one)
  const sw = Math.min(1.3, W * 0.6);
  const noticeMat = noticeMaterial(scene, spec.notice ?? ["TUNNEL CLOSED", "Track works in progress"]);
  for (let u = -W / 2 + Math.min(W / 2, 2.6); u <= W / 2 - Math.min(W / 2, 2.6) + 1e-3; u += 5.2) {
    const sign = MeshBuilder.CreatePlane("hoardNotice", { width: sw, height: sw * 0.62 }, scene);
    sign.position.copyFrom(at(u + (rnd() - 0.5) * 0.6, 1.9 + rnd() * 0.3, 0.15));
    sign.rotation.y = yaw + Math.PI;
    sign.material = noticeMat;
    sign.isPickable = false;
    meshes.push(sign as Mesh);
  }

  // at its foot: concrete barriers and a few crates (they make the boarding read as works, not a wall)
  const props: PropPlacement[] = [];
  if (spec.dressing !== false) {
    for (let u = -W / 2 + 1.2; u < W / 2 - 0.8; u += 2.2 + rnd() * 1.4) {
      if (rnd() < 0.45) continue;
      const b = box("hoardBarrier", 1.9, 0.8, 0.45, at(u, 0.4, 0.55), M.concrete);
      b.rotation.y = yaw + (rnd() - 0.5) * 0.12;
      b.checkCollisions = true;
      colliders.push(b);
    }
    for (let k = 0; k < 3; k++) {
      const u = (rnd() - 0.5) * W * 0.7;
      const p = at(u, 0, 1.2 + rnd() * 0.8);
      props.push({ kind: rnd() < 0.6 ? "woodCrate" : "ration", variant: rnd() < 0.5 ? 0 : 1, x: p.x, y: p.y, z: p.z, rotY: yaw + (rnd() - 0.5) * 0.8 });
      if (rnd() < 0.5) props.push({ kind: "ammoCan", x: p.x + ax.x * 0.9, y: p.y, z: p.z + ax.z * 0.9, rotY: yaw + rnd() * 3 });
    }
  }
  for (const m of meshes) m.freezeWorldMatrix();
  return { meshes, colliders, props };
}
