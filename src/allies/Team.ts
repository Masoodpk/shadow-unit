/**
 * The allies' shared board: what each of them did last, and when. Spider-Man and Iron Man read it
 * so they don't all throw the same thing at the Hulk at once — one webs him while the other lines
 * up a shot; a heavy hit (a dive, the unibeam, a ride) waits until the last one has landed.
 */
export type TeamMove = "heavy" | "web" | "ranged" | "melee" | "distract";

export class TeamBoard {
  private time = 0;
  private marks = new Map<TeamMove, number>();
  update(dt: number) {
    this.time += dt;
  }
  mark(m: TeamMove) {
    this.marks.set(m, this.time);
  }
  /** seconds since anyone did this (a long time if never) */
  since(m: TeamMove) {
    return this.time - (this.marks.get(m) ?? -999);
  }
  reset() {
    this.marks.clear();
  }
}
