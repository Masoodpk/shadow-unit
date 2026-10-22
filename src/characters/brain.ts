/**
 * A reusable AI state machine for the roster's characters: the states every fighter goes through,
 * the time spent in each, and a watchdog so nobody gets stuck (every state has a limit, and running
 * past it drops back to "select"). The character supplies `decide()` (what to do from "select"),
 * and each state's work happens in its own code; the brain keeps the bookkeeping honest.
 */
export type BrainState =
  | "idle" | "follow" | "patrol" | "detect" | "select" | "approach" | "attack" | "defend" | "dodge"
  | "recover" | "support" | "ability" | "bossPhase" | "cinematic" | "defeated";

/** the longest each state may last before the watchdog steps in (seconds; 0 = no limit) */
const LIMIT: Record<BrainState, number> = {
  idle: 0, follow: 0, patrol: 0, detect: 2, select: 1, approach: 12, attack: 6, defend: 4, dodge: 1.5,
  recover: 4, support: 8, ability: 8, bossPhase: 6, cinematic: 30, defeated: 0,
};

export class Brain {
  state: BrainState = "idle";
  t = 0;
  /** what happened, newest last (the debug overlay shows the tail) */
  readonly log: string[] = [];
  constructor(readonly who: string) {}
  go(s: BrainState, why = "") {
    if (s === this.state && this.t < 0.05) return;
    this.state = s;
    this.t = 0;
    this.log.push(`${s}${why ? " (" + why + ")" : ""}`);
    if (this.log.length > 12) this.log.shift();
  }
  /** advance the clock; true if the watchdog had to break the state */
  tick(dt: number) {
    this.t += dt;
    const lim = LIMIT[this.state];
    if (lim > 0 && this.t > lim && this.state !== "select") {
      this.go("select", "watchdog");
      return true;
    }
    return false;
  }
  get busy() {
    return this.state === "attack" || this.state === "ability" || this.state === "dodge" || this.state === "cinematic";
  }
}
