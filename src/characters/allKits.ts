import type { Kit } from "../allies/RosterHero";
import { KITS } from "../allies/kits";
import { KITS2 } from "../allies/kits2";
import { VILLAIN_KITS } from "../enemies/villainKits";
import { VILLAIN_KITS2 } from "../enemies/villainKits2";

/**
 * Every roster character's kit, by id, in one table. Which side a character is built on — your
 * squad (RosterHero) or against you (RosterVillain) — is not decided here but by the faction table
 * (factions.sideOf): a kit is written once and works on either side (Venom).
 */
export const ALL_KITS: Record<string, Kit> = { ...KITS, ...KITS2, ...VILLAIN_KITS, ...VILLAIN_KITS2 };
