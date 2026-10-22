/**
 * Developer mode: testing switches + a live status panel.
 *
 * Toggle with the menu checkbox or the ` (backquote) key. While on, hotkeys:
 *   I ammo (off / infinite reserve / bottomless mag) · Y enemy AI (active / passive / frozen)
 *   U time scale (1× / 0.5× / 0.25×) · Shift+K kill all hostiles · Shift+L respawn hostiles · F3 perf overlay
 * God mode (H) and all weapons (L) are developer options too, each an on/off switch (also in CONTROLS).
 * Everything here is off by default, and switching developer mode off switches all of it off.
 *   Red Dune, bring one in now: 8 the Hulk · 9 Spider-Man · 0 Iron Man · − Wolverine · = Deadpool · [ Batman · ] Superman
 */
export type AmmoCheat = "OFF" | "INFINITE" | "NO RELOAD";
export type AiMode = "ACTIVE" | "PASSIVE" | "FROZEN";

const AMMO: AmmoCheat[] = ["OFF", "INFINITE", "NO RELOAD"];
const AI: AiMode[] = ["ACTIVE", "PASSIVE", "FROZEN"];
const SCALES = [1, 0.5, 0.25];

export interface DevSnapshot {
  fps: number;
  weapon: string;
  state: string;
  phase: string;
  mag: number;
  reserve: number;
  hp: number;
  move: string;
  pos: string;
  alive: number;
  ai: string;
}

export class DevMode {
  enabled = false;
  god = false;
  ammo: AmmoCheat = "OFF";
  ai: AiMode = "ACTIVE";
  private scaleIdx = 0;
  private el = document.getElementById("dev")!;
  private acc = 1;
  private toastT = 0;
  private toastMsg = "";

  get timeScale() {
    return this.enabled ? SCALES[this.scaleIdx] : 1;
  }
  get godOn() {
    return this.enabled && this.god;
  }
  get ammoMode(): AmmoCheat {
    return this.enabled ? this.ammo : "OFF";
  }
  get aiMode(): AiMode {
    return this.enabled ? this.ai : "ACTIVE";
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    // (off means off: every developer option back to normal, so nothing lingers into play)
    if (!on) {
      this.god = false;
      this.ammo = "OFF";
      this.ai = "ACTIVE";
      this.scaleIdx = 0;
    }
    this.el.classList.toggle("hidden", !on || !this.paused);
    this.acc = 1;
  }

  cycleAmmo() {
    this.ammo = AMMO[(AMMO.indexOf(this.ammo) + 1) % AMMO.length];
    this.toast(`AMMO ${this.ammo}`);
  }
  cycleAi() {
    this.ai = AI[(AI.indexOf(this.ai) + 1) % AI.length];
    this.toast(`ENEMY AI ${this.ai}`);
  }
  cycleScale() {
    this.scaleIdx = (this.scaleIdx + 1) % SCALES.length;
    this.toast(`TIME ${SCALES[this.scaleIdx]}×`);
  }
  toast(msg: string) {
    this.toastMsg = msg;
    this.toastT = 1.6;
    this.acc = 1;
  }

  /** the panel is only drawn on the pause screen (Esc), down the right side; in play, just a toast */
  paused = false;
  update(rawDt: number, snap: () => DevSnapshot) {
    if (!this.enabled) return;
    this.toastT -= rawDt;
    if (!this.paused) {
      // in play: nothing on screen but a key's confirmation, briefly
      const on = this.toastT > 0;
      this.el.classList.toggle("hidden", !on);
      this.el.classList.add("dev-toast-only");
      if (on) this.el.innerHTML = `<div class="dev-toast">${this.toastMsg}</div>`;
      return;
    }
    this.el.classList.remove("hidden", "dev-toast-only");
    this.acc += rawDt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const s = snap();
    const on = (b: boolean) => (b ? "<em>ON</em>" : "off");
    this.el.innerHTML =
      `<div class="dev-title">DEVELOPER MODE <span>${Number.isFinite(s.fps) ? s.fps.toFixed(0) : "--"} fps</span></div>` +
      `<div><b>H</b> god mode    ${on(this.godOn)}</div>` +
      `<div><b>I</b> ammo        ${this.ammo === "OFF" ? "off" : `<em>${this.ammo}</em>`}</div>` +
      `<div><b>Y</b> enemy AI    ${this.ai === "ACTIVE" ? "active" : `<em>${this.ai}</em>`}</div>` +
      `<div><b>U</b> time        ${SCALES[this.scaleIdx] === 1 ? "1×" : `<em>${SCALES[this.scaleIdx]}×</em>`}</div>` +
      `<div><b>⇧K</b> kill all   <b>⇧L</b> respawn</div>` +
      `<div><b>M</b> sound   <b>F3</b> perf   <b>\`</b> dev off</div>` +
      `<div><b>8</b> Hulk  <b>9</b> Spidey  <b>0</b> Iron Man</div>` +
      `<div><b>−</b> Wolverine  <b>=</b> Deadpool</div>` +
      `<div><b>[</b> Batman  <b>]</b> Superman</div>` +
      `<div class="dev-sep"></div>` +
      `<div>weapon  ${s.weapon}  ${s.mag}/${s.reserve}</div>` +
      `<div>state   ${s.state}${s.phase ? " · " + s.phase : ""}</div>` +
      `<div>player  hp ${s.hp.toFixed(0)}  ${s.move}</div>` +
      `<div>pos     ${s.pos}</div>` +
      `<div>enemies ${s.alive} alive  ${s.ai}</div>` +
      (this.toastT > 0 ? `<div class="dev-toast">${this.toastMsg}</div>` : "");
  }
}
