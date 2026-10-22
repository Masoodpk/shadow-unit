/**
 * Difficulty: EASY / MEDIUM / HARD, chosen on the stage screen (or in SETTINGS, mid-mission too).
 * MEDIUM is the game as tuned. Each level scales the same few things, so they all move together:
 *   enemyHealth  how much it takes to put a soldier (and the boss) down
 *   damageTaken  how much each hit on you costs
 *   hitChance    how often an enemy round finds you
 *   reaction     how long a soldier takes to open fire once he's seen you (×, lower = quicker)
 *   regen        how soon and how fast your health comes back (× rate, ÷ delay)
 */
export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export interface DifficultyScale {
  label: string;
  enemyHealth: number;
  damageTaken: number;
  hitChance: number;
  reaction: number;
  regen: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyScale> = {
  easy: { label: "EASY", enemyHealth: 0.55, damageTaken: 0.5, hitChance: 0.65, reaction: 1.6, regen: 1.6 },
  medium: { label: "MEDIUM", enemyHealth: 1, damageTaken: 1, hitChance: 1, reaction: 1, regen: 1 },
  hard: { label: "HARD", enemyHealth: 1.25, damageTaken: 1.5, hitChance: 1.3, reaction: 0.7, regen: 0.65 },
};

let current: Difficulty = "medium";
/** the level in force (read live: changing it mid-mission takes effect at once) */
export const difficulty = {
  get id(): Difficulty {
    return current;
  },
  get k(): DifficultyScale {
    return DIFFICULTY[current];
  },
  set(d: Difficulty) {
    current = DIFFICULTIES.includes(d) ? d : "medium";
  },
};
