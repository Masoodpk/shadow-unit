import { Camera } from "@babylonjs/core/Cameras/camera";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { bindings } from "../core/Bindings";

/**
 * The mission layer of the HUD (DOM, over the game HUD): the waypoint marker on the next
 * objective, radio subtitles, chapter title cards, the cinematic letterbox (with
 * "SPACE · SKIP"), the hold-to-do progress bar, a paper you've found (read on screen) and a big
 * enemy's health bar.
 */
export class MissionHud {
  private root: HTMLDivElement;
  private way: HTMLDivElement;
  private wayLabel: HTMLSpanElement;
  private sub: HTMLDivElement;
  private cardEl: HTMLDivElement;
  private bars: HTMLDivElement;
  private skip: HTMLDivElement;
  private defuseEl: HTMLDivElement;
  private defuseFill: HTMLDivElement;
  private defuseLabel: HTMLDivElement;
  private paperEl: HTMLDivElement;
  private boss: HTMLDivElement;
  private bossName: HTMLDivElement;
  private bossState: HTMLSpanElement;
  private bossFill: HTMLDivElement;
  private bossGhost: HTMLDivElement;
  private ghost = 1;
  private subT = 0;
  private cardT = 0;
  private paperT = 0;
  private vp = new Viewport(0, 0, 1, 1);
  private proj = new Vector3();

  constructor() {
    const el = (cls: string, parent: HTMLElement, tag = "div") => {
      const e = document.createElement(tag) as HTMLDivElement;
      e.className = cls;
      parent.appendChild(e);
      return e;
    };
    this.root = el("mission", document.body);
    this.bars = el("ms-bars", this.root);
    el("ms-bar top", this.bars);
    el("ms-bar bottom", this.bars);
    this.skip = el("ms-skip", this.root);
    this.skip.innerHTML = `<b>${bindings.label("jump")}</b> SKIP`;
    this.way = el("ms-way", this.root);
    el("ms-diamond", this.way);
    this.wayLabel = el("ms-way-label", this.way, "span");
    this.sub = el("ms-sub", this.root);
    this.cardEl = el("ms-card", this.root);
    this.defuseEl = el("ms-defuse", this.root);
    this.defuseLabel = el("ms-defuse-label", this.defuseEl);
    const track = el("ms-defuse-track", this.defuseEl);
    this.defuseFill = el("ms-defuse-fill", track);
    this.paperEl = el("ms-paper", this.root);
    this.boss = el("ms-boss", this.root);
    this.bossName = el("ms-boss-name", this.boss);
    this.bossState = el("ms-boss-state", this.boss, "span");
    const bossTrack = el("ms-boss-track", this.boss);
    this.bossGhost = el("ms-boss-ghost", bossTrack);
    this.bossFill = el("ms-boss-fill", bossTrack);
    this.reset();
  }

  reset() {
    this.subT = this.cardT = 0;
    this.sub.classList.remove("on");
    this.cardEl.classList.remove("on");
    this.letterbox(false, false);
    this.defuse(-1);
    this.paperT = 0;
    this.paperEl.classList.remove("on");
    this.bossHide();
    this.way.style.display = "none";
  }

  /** a radio line (or a character's) at the bottom of the screen */
  say(who: string, text: string, dur = 0) {
    this.sub.innerHTML = `<b class="${who === "COMMAND" ? "cmd" : who === "YOU" ? "me" : "npc"}">${who}</b>${text}`;
    this.sub.classList.add("on");
    this.subT = dur || Math.max(3.5, text.length * 0.065);
  }

  /** a big centred title (chapter or character introduction) */
  card(title: string, subtitle: string, dur: number) {
    if (!title) {
      this.cardEl.classList.remove("on");
      this.cardT = 0;
      return;
    }
    this.cardEl.innerHTML = `<div class="t">${title}</div><div class="s">${subtitle}</div>`;
    this.cardEl.classList.add("on");
    this.cardT = dur;
  }

  letterbox(on: boolean, skippable: boolean) {
    this.bars.classList.toggle("on", on);
    this.skip.classList.toggle("on", on && skippable);
    this.root.classList.toggle("cine", on);
    document.body.classList.toggle("cinematic", on);
  }

  /** a hold-to-do progress bar under the crosshair (p < 0 hides it) */
  defuse(p: number, label = "") {
    this.defuseEl.classList.toggle("on", p >= 0);
    if (label && this.defuseLabel.textContent !== label) this.defuseLabel.textContent = label;
    if (p >= 0) this.defuseFill.style.width = `${Math.min(100, p * 100).toFixed(1)}%`;
  }

  /** a big enemy's bar at the top of the screen; `state` beside the name (its mood), `level` 0–2 tints it */
  bossShow(name: string) {
    this.bossName.firstChild?.remove();
    this.bossName.prepend(document.createTextNode(name));
    this.boss.classList.add("on");
    this.ghost = 1;
    this.bossBar(1);
  }
  bossHide() {
    this.boss.classList.remove("on", "l1", "l2");
  }
  bossMood(state: string, level: number) {
    this.bossState.textContent = state;
    this.bossName.appendChild(this.bossState);
    this.boss.classList.toggle("l1", level === 1);
    this.boss.classList.toggle("l2", level >= 2);
  }
  bossBar(f: number) {
    this.bossFill.style.width = `${(f * 100).toFixed(1)}%`;
    // the chunk just lost drains away behind
    this.ghost = Math.max(f, this.ghost - 0.004);
    this.bossGhost.style.width = `${(this.ghost * 100).toFixed(1)}%`;
  }

  /** a paper you've picked up, held up on screen for `dur` seconds */
  paper(p: { title: string; body: string[]; sign: string }, dur: number) {
    this.paperEl.innerHTML = `<div class="hd">${p.title}</div>${p.body.map((l) => `<p>${l}</p>`).join("")}<div class="sg">${p.sign}</div>`;
    this.paperEl.classList.add("on");
    this.paperT = dur;
  }

  update(dt: number, target: { pos: Vector3; label: string } | null, camera: Camera, scene: Scene) {
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.sub.classList.remove("on");
    }
    if (this.cardT > 0) {
      this.cardT -= dt;
      if (this.cardT <= 0) this.cardEl.classList.remove("on");
    }
    if (this.paperT > 0) {
      this.paperT -= dt;
      if (this.paperT <= 0) this.paperEl.classList.remove("on");
    }
    if (!target) {
      this.way.style.display = "none";
      return;
    }
    // project the objective; behind you or off screen → pinned to the edge, pointing the way
    const m = scene.getTransformMatrix();
    Vector3.ProjectToRef(target.pos, Matrix.IdentityReadOnly, m, this.vp, this.proj);
    const cam = camera.globalPosition;
    const fwd = camera.getDirection(Vector3.Forward());
    const to = target.pos.subtract(cam);
    const behind = Vector3.Dot(fwd, to) < 0;
    let x = this.proj.x, y = this.proj.y;
    if (behind) {
      x = 1 - x;
      y = 0.92;
    }
    const pinned = behind || x < 0.04 || x > 0.96 || y < 0.08 || y > 0.92;
    x = Math.min(0.96, Math.max(0.04, x));
    y = Math.min(0.92, Math.max(0.08, y));
    this.way.style.display = "";
    this.way.style.left = `${(x * 100).toFixed(2)}%`;
    this.way.style.top = `${(y * 100).toFixed(2)}%`;
    this.way.classList.toggle("pinned", pinned);
    this.wayLabel.textContent = `${target.label} · ${Math.round(to.length())} M`;
  }
}
