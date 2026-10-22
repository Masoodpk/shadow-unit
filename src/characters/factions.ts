/**
 * Who's on whose side — one place for it. Every "is that an enemy?" question in the game should come
 * through `hostile(a, b)` instead of checking names or classes where it's asked.
 *
 * Factions: the heroes (you and your allies), the villains, and "independent" (Doctor Doom — his own
 * agenda: hostile to the heroes, and by default not on the villains' side either). Story missions
 * can change a relationship for a while (`setRelation`) — Doom siding with Thanos, a hero turned
 * by a mission — and put it back (`resetRelations`).
 */
export type Faction = "hero" | "villain" | "independent" | "monster";
export type Relation = "ally" | "neutral" | "hostile";

const BASE: Record<Faction, Record<Faction, Relation>> = {
  hero: { hero: "ally", villain: "hostile", independent: "hostile", monster: "hostile" },
  villain: { hero: "hostile", villain: "ally", independent: "neutral", monster: "hostile" },
  independent: { hero: "hostile", villain: "neutral", independent: "ally", monster: "hostile" },
  // (Godzilla: everything that isn't him is in his way)
  monster: { hero: "hostile", villain: "hostile", independent: "hostile", monster: "ally" },
};

let table: Record<Faction, Record<Faction, Relation>> = clone(BASE);
function clone(t: typeof BASE) {
  return JSON.parse(JSON.stringify(t)) as typeof BASE;
}

export function relation(a: Faction, b: Faction): Relation {
  return table[a][b];
}
export function hostile(a: Faction, b: Faction) {
  return relation(a, b) === "hostile";
}
export function allied(a: Faction, b: Faction) {
  return relation(a, b) === "ally";
}
/** a story beat: set both ways (Doom joins Thanos: setRelation("independent", "villain", "ally")) */
export function setRelation(a: Faction, b: Faction, r: Relation) {
  table[a][b] = r;
  table[b][a] = r;
}
export function resetRelations() {
  table = clone(BASE);
}

/**
 * Which side a character is built on, for the ones whose side the story decides (Venom: an enemy by
 * default, an ally once a mission turns him). The game reads this when the stage is set up — the
 * same character, the same kit, on whichever side this says. Change it before a stage loads.
 */
const SIDE_BASE: Record<string, "hero" | "foe"> = { venom: "foe" };
let sides: Record<string, "hero" | "foe"> = { ...SIDE_BASE };
export function sideOf(id: string, faction: Faction): "hero" | "foe" {
  return sides[id] ?? (faction === "hero" ? "hero" : "foe");
}
export function setSide(id: string, side: "hero" | "foe") {
  sides[id] = side;
}
export function resetSides() {
  sides = { ...SIDE_BASE };
}
