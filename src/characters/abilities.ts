/**
 * Abilities as data: what each power is (its kind, reach, damage, stagger, cooldown, energy) and
 * when an AI should use it — and a small per-character book that tracks the cooldowns and energy at
 * run time. The character's own code still performs the move (its animation, its hit test, its
 * effects); this is the shared bookkeeping, and what the debug overlay reads.
 */
export type AbilityKind = "melee" | "ranged" | "projectile" | "beam" | "aoe" | "buff" | "movement" | "summon" | "grab";

export interface AbilityDef {
  id: string;
  name: string;
  kind: AbilityKind;
  /** seconds between uses */
  cooldown: number;
  /** metres: best used between these */
  range: [number, number];
  /** per hit (the character's own code decides how many hits) */
  damage: number;
  /** 0 a flinch … 1 a knock-down … 2 thrown */
  stagger: number;
  /** area of effect radius, if any */
  radius?: number;
  /** energy it costs (characters with a meter) */
  cost?: number;
  /** only against foes at least this big (Hulk-sized = 1) or at most this big */
  minSize?: number;
  maxSize?: number;
  /** extra damage factor against bosses (they resist some things) */
  bossFactor?: number;
}

export class AbilityBook {
  private ready = new Map<string, number>();
  energy = 100;
  readonly maxEnergy = 100;
  constructor(readonly defs: AbilityDef[]) {
    for (const d of defs) this.ready.set(d.id, 0);
  }
  tick(dt: number) {
    for (const [k, v] of this.ready) if (v > 0) this.ready.set(k, Math.max(0, v - dt));
    this.energy = Math.min(this.maxEnergy, this.energy + dt * 6);
  }
  def(id: string) {
    return this.defs.find((d) => d.id === id);
  }
  /** can it be used now, at this distance, on a foe this big? */
  usable(id: string, distance = 0, size = 1) {
    const d = this.def(id);
    if (!d || (this.ready.get(id) ?? 0) > 0) return false;
    if ((d.cost ?? 0) > this.energy) return false;
    if (distance < d.range[0] || distance > d.range[1]) return false;
    if (d.minSize !== undefined && size < d.minSize) return false;
    if (d.maxSize !== undefined && size > d.maxSize) return false;
    return true;
  }
  /** start its cooldown (and pay for it); returns the def */
  use(id: string) {
    const d = this.def(id);
    if (!d) return null;
    this.ready.set(id, d.cooldown);
    this.energy -= d.cost ?? 0;
    return d;
  }
  /** the best usable one from a list, in order of preference */
  pick(ids: string[], distance: number, size = 1) {
    return ids.find((id) => this.usable(id, distance, size)) ?? null;
  }
  cooldownOf(id: string) {
    return this.ready.get(id) ?? 0;
  }
  reset() {
    for (const k of this.ready.keys()) this.ready.set(k, 0);
    this.energy = this.maxEnergy;
  }
  /** for the debug overlay: "smash 2.1s · beam ready …" */
  debug() {
    return this.defs.map((d) => `${d.id} ${(this.ready.get(d.id) ?? 0) > 0 ? (this.ready.get(d.id) ?? 0).toFixed(1) + "s" : "ready"}`).join(" · ");
  }
}
