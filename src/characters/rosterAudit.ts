import type { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { AUTO, SkinnedModel, SkinnedRig } from "../allies/HeroRig";
import { RELAXED, STANCE } from "../allies/SpiderPoses";
import { ROSTER } from "./roster";

export interface AuditRow {
  id: string;
  ok: boolean;
  error?: string;
  /** measured from the posed rig: head top above the ground */
  height?: number;
  /** the skinned meshes' own extent (catches a skeleton/mesh scale mismatch the joints can't) */
  meshH?: number;
  clips?: string[];
  meshes?: number;
  ms?: number;
}

/**
 * Dev check for the roster models (no gameplay): load each one through the same rig code the
 * heroes use (AUTO bone names), stand it in a row at `origin` facing -z, pose it, and measure it.
 * A rig that is missing a joint the poses need fails here with the joint's name.
 */
export async function auditRoster(scene: Scene, origin: Vector3, gap = 3.2, stance = true) {
  const rows: AuditRow[] = [];
  const rigs: SkinnedRig[] = [];
  const list = ROSTER.filter((c) => c.model);
  let i = 0;
  for (const c of list) {
    const t0 = performance.now();
    try {
      const m = await SkinnedModel.load(scene, c.model!, c.height, undefined, AUTO);
      const rig = m.spawn("audit_" + c.id);
      rig.anchor.position.copyFrom(origin.add(new Vector3((i - (list.length - 1) / 2) * gap, 0, 0)));
      rig.anchor.rotationQuaternion!.copyFromFloats(0, 1, 0, 0); // face -z (toward a camera south of the row)
      const p = stance ? STANCE : RELAXED;
      rig.pose(p.d, new Vector3(p.hip[0] * rig.hipH, p.hip[1] * rig.hipH, p.hip[2] * rig.hipH));
      rigs.push(rig);
      const top = rig.at("HeadTop_End").y - rig.anchor.position.y;
      let lo = Infinity, hi = -Infinity;
      for (const mm of rig.meshes) {
        mm.refreshBoundingInfo({ applySkeleton: true });
        mm.computeWorldMatrix(true);
        const b = mm.getBoundingInfo().boundingBox;
        lo = Math.min(lo, b.minimumWorld.y);
        hi = Math.max(hi, b.maximumWorld.y);
      }
      rows.push({ id: c.id, ok: true, height: +top.toFixed(2), meshH: +(hi - lo).toFixed(2), clips: Object.keys((m as unknown as { clips: object }).clips), meshes: rig.meshes.length, ms: Math.round(performance.now() - t0) });
    } catch (e) {
      rows.push({ id: c.id, ok: false, error: String((e as Error)?.message ?? e), ms: Math.round(performance.now() - t0) });
    }
    i++;
  }
  return { rows, rigs };
}

/**
 * Dev check: in each roster model, the pose joints whose name more than one node maps to (two
 * skeletons in one file — Megatron's mace). The rig takes the one in the body's skeleton; this
 * lists them so a new rig mapping can be checked against the old models.
 */
export async function duplicateJoints(scene: Scene, ids?: string[]) {
  const { LoadAssetContainerAsync } = await import("@babylonjs/core/Loading/sceneLoader");
  const { autoRename } = await import("../allies/HeroRig");
  const { PAIRS } = await import("../allies/SpiderRig");
  const need = new Set(PAIRS.flat());
  const out: Record<string, string[]> = {};
  for (const c of ROSTER.filter((x) => x.model && (!ids || ids.includes(x.id)))) {
    const ct = await LoadAssetContainerAsync(c.model!, scene, { pluginExtension: ".glb" });
    const seen = new Map<string, number>();
    for (const n of [...ct.transformNodes, ...ct.meshes]) {
      const k = autoRename(n.name.replace(/_\d+$/, ""));
      if (need.has(k)) seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    out[c.id] = [...seen].filter(([, v]) => v > 1).map(([k, v]) => `${k}×${v}`);
    out[c.id].push("missing:" + [...need].filter((k) => !seen.has(k)).join("/"));
    ct.dispose();
  }
  return out;
}
