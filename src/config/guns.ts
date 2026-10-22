import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { WeaponId } from "./weapons";
import type { Pose } from "../weapons/WeaponModels";

import akUrl from "../assets/weapons/ak.glb?url";
import m5Url from "../assets/weapons/m5.glb?url";
import vsskUrl from "../assets/weapons/vssk.glb?url";
import glockUrl from "../assets/weapons/glock.glb?url";
import m72Url from "../assets/weapons/m72.glb?url";
import dzjUrl from "../assets/weapons/dzj08.glb?url";

/**
 * Static gun models held by the shared skinned arms.
 *
 * Every measurement is in the gun's own frame: metres, +Z = muzzle direction,
 * +Y = up, +X = the gun's right side. They were measured from orthographic
 * side renders of each model. The rig aligns `gripTop` with the M4 pack's
 * pistol grip (so the right hand closes on the new grip) and moves the left
 * arm to `support` (handguard) or `magwell` (while reloading).
 */
export interface GunSpec {
  id: WeaponId;
  url: string;
  /** native model → gun frame: uniform scale and yaw (radians) */
  scale: number;
  yaw: number;
  /** node-name fragments of props to remove (loose mags, rounds…) */
  hide?: string[];
  /** parts that travel with the magazine during reloads (node-name or material-name fragments) */
  magParts?: string[];
  gripTop: Vector3;
  support: Vector3;
  magwell: Vector3;
  muzzle: Vector3;
  eject: Vector3;
  /** aim line: iron-sight rear/front, or scope eyepiece/objective centres */
  sightRear: Vector3;
  sightFront: Vector3;
  /** distance from the eye to `sightRear` when aiming */
  eyeRelief: number;
  hipPose?: Partial<Pose>;
  /** PBR tweaks for models authored without proper metal/roughness */
  surface?: { metallic?: number; roughness?: number; env?: number };
  credit: string;
}

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

export const GUNS: Partial<Record<WeaponId, GunSpec>> = {
  ak47: {
    id: "ak47",
    url: akUrl,
    scale: 1,
    yaw: 0,
    magParts: ["mag", "bullets"],
    gripTop: v(0.003, 0.1406, -0.1699),
    support: v(0.003, 0.158, 0.125),
    magwell: v(0.0, 0.17, -0.035),
    muzzle: v(0.003, 0.1851, 0.4814),
    eject: v(0.03, 0.205, -0.03),
    sightRear: v(0.0025, 0.2325, 0.0277),
    sightFront: v(0.0025, 0.2303, 0.4136),
    eyeRelief: 0.3,
    credit: "AK-47 Assault Rifle by MaX3Dd (Sketchfab Standard licence)",
  },
  m5: {
    id: "m5",
    url: m5Url,
    scale: 0.1,
    yaw: Math.PI / 2,
    hide: ["30rnd mag (pmag)_18", "55645_10", "55645 case_9"],
    magParts: ["mag empty (pmag)"],
    gripTop: v(0, -0.0312, -0.1512),
    support: v(0, -0.007, 0.11),
    magwell: v(0, 0.0, -0.03),
    muzzle: v(0, 0.022, 0.2896),
    eject: v(0.03, 0.008, -0.05),
    sightRear: v(0.0013, 0.0848, -0.1468),
    sightFront: v(0.0013, 0.0862, 0.2123),
    eyeRelief: 0.15,
    surface: { metallic: 0.35, roughness: 0.48, env: 1.1 },
    credit: "low-poly Colt M5 SCW by D_U, CC BY 4.0",
  },
  vssk: {
    id: "vssk",
    url: vsskUrl,
    scale: 1,
    yaw: Math.PI / 2,
    hide: ["M_Sling"],
    magParts: ["M_Mag", "M_Bullet"],
    gripTop: v(0, 0.0099, -0.0029),
    support: v(0, 0.004, 0.15),
    magwell: v(0, 0.03, -0.15),
    muzzle: v(0, 0.051, 0.7243),
    eject: v(0.03, 0.06, -0.12),
    sightRear: v(0.0009, 0.1286, -0.1079),
    sightFront: v(0.0009, 0.1286, 0.1022),
    eyeRelief: 0.07,
    hipPose: { px: 0.02, py: -0.035, pz: 0.01 },
    credit: "VSSK Vykhlop by Diamonddogkz (Sketchfab Standard licence)",
  },
  glock: {
    id: "glock",
    url: glockUrl,
    scale: 0.1,
    yaw: -Math.PI / 2,
    gripTop: v(0, 0.0161, -0.0573),
    support: v(0.022, -0.04, -0.01),
    magwell: v(0, -0.05, -0.066),
    muzzle: v(0, 0.03, 0.0939),
    eject: v(0.015, 0.055, 0.0),
    sightRear: v(0, 0.0595, -0.0708),
    sightFront: v(0, 0.0605, 0.0856),
    eyeRelief: 0.27,
    hipPose: { pz: 0.12, py: 0.03, px: -0.025 },
    surface: { metallic: 0.15, roughness: 0.55, env: 1.0 },
    credit: "Glock17 by PSICOPATO, CC BY 4.0",
  },
  // Launchers: re-oriented and scaled to metres offline (+Z muzzle, +Y up). The right hand takes the
  // grip under the tube, the left the front of the tube; `eject` is the rear opening (backblast).
  m72: {
    id: "m72",
    url: m72Url,
    scale: 1,
    yaw: 0,
    gripTop: v(0, 0.198, -0.17),
    support: v(0, 0.196, 0.13),
    magwell: v(0, 0.2, 0.0),
    muzzle: v(0, 0.234, 0.297),
    eject: v(0, 0.234, -0.59),
    // aim just over the pop-up sights: the front sight plate is opaque in this model and would fill the view
    sightRear: v(0, 0.4, -0.24),
    sightFront: v(0, 0.4, 0.27),
    eyeRelief: 0.12,
    hipPose: { px: 0.03, py: 0.05, pz: -0.06, ry: -0.03 },
    surface: { metallic: 0.2, roughness: 0.6, env: 1.0 },
    credit: "LAW Light Anti-Tank weapon M72 by Vziuh, CC BY 4.0",
  },
  dzj08: {
    id: "dzj08",
    url: dzjUrl,
    scale: 1,
    yaw: 0,
    gripTop: v(-0.072, -0.05, -0.03),
    support: v(-0.072, -0.06, 0.21),
    magwell: v(-0.072, -0.06, 0.05),
    muzzle: v(-0.07, 0.032, 0.51),
    eject: v(-0.072, 0.008, -0.51),
    sightRear: v(-0.072, 0.125, -0.15),
    sightFront: v(-0.072, 0.1334, 0.2),
    eyeRelief: 0.12,
    // shouldered: the fat tube rides beside the head instead of filling the screen
    hipPose: { px: 0.085, py: 0.075, pz: -0.07, ry: -0.05, rz: -0.04 },
    credit: "DZJ-08 Rocket Launcher by Martini-SF, CC BY-NC 4.0",
  },
};
