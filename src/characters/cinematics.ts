import type { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** a camera shot an entrance asks for (the cinema camera); none = turn the player's own view */
export interface CineShot { pos: Vector3; target: Vector3; fov: number; cut?: boolean }

/**
 * Anything with an entrance (or any scripted moment) the game should film. The existing heroes
 * and foes already have this shape; a new roster character only has to implement it and be
 * registered — the director picks who's on screen, the Game does the filming.
 */
export interface CineActor {
  readonly cinematic: boolean;
  /** what to look at when there is no cineFocus */
  position?: Vector3;
  cineShot(): CineShot | null | undefined;
  cineFocus?(): Vector3;
  skip?(): void;
}

/**
 * One list, in priority order (the first one mid-entrance is filmed). Replaces the hand-written
 * `a?.cinematic ? a : b?.cinematic ? b : …` chains.
 */
export class CineDirector {
  private actors: { id: string; get: () => CineActor | undefined; prio: number }[] = [];
  /** `get` is a getter so actors that load later (or are swapped) are picked up */
  register(id: string, get: () => CineActor | undefined, prio = 0) {
    this.actors = this.actors.filter((a) => a.id !== id);
    this.actors.push({ id, get, prio });
    this.actors.sort((a, b) => b.prio - a.prio);
  }
  unregister(id: string) { this.actors = this.actors.filter((a) => a.id !== id); }
  /** who is mid-entrance right now (highest priority first) */
  current(): { id: string; actor: CineActor } | null {
    for (const a of this.actors) {
      const actor = a.get();
      if (actor?.cinematic) return { id: a.id, actor };
    }
    return null;
  }
  get active() { return !!this.current(); }
  ids() { return this.actors.map((a) => a.id); }
}
