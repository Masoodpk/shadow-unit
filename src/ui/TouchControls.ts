import type { Action } from "../core/Bindings";
import type { Input } from "../core/Input";

/**
 * On-screen controls for phones and tablets, laid out like the mobile shooters
 * (CoD Mobile, PUBG Mobile):
 *   - left half: a floating move stick that appears under the thumb; push it well
 *     past its ring, forwards, to sprint
 *   - right half: drag anywhere to look; the big FIRE button also looks while held,
 *     so you can track a target and shoot with one thumb
 *   - a cluster round FIRE: aim (toggle), crouch (hold: prone), reload, jump,
 *     grenade (hold: next type), knife, weapon swap, use; a second FIRE on the left
 *   - top right: map and pause
 * Every button drives the same actions as the keys (Input.actionDown / actionUp),
 * so gameplay can't tell a tap from a key press.
 *
 * Left out on touch: lean / peek, the number keys (SWAP cycles the carried weapons)
 * and the developer keys.
 */

/** a phone or tablet: a touch screen as the main pointer, no hover. `?touch=1` / `?touch=0` force it */
export function isTouchDevice(): boolean {
  const q = new URLSearchParams(location.search).get("touch");
  if (q === "1") return true;
  if (q === "0") return false;
  return matchMedia("(hover: none) and (pointer: coarse)").matches && navigator.maxTouchPoints > 0;
}

/** what prompts call the buttons ("<b>USE</b> OPEN DOOR") */
export const TOUCH_LABELS: Partial<Record<Action, string>> = {
  fire: "FIRE",
  aim: "AIM",
  reload: "RELOAD",
  use: "USE",
  jump: "JUMP",
  crouch: "CROUCH",
  prone: "HOLD CROUCH",
  grenade: "NADE",
  grenadeType: "HOLD NADE",
  knife: "KNIFE",
  melee: "KNIFE",
  inspect: "INSPECT",
  throwKnife: "THROW KNIFE",
  map: "MAP",
};

type Kind = "hold" | "long" | "tap";
interface ButtonDef {
  id: string;
  icon: string;
  label: string;
  /** hold: down / up with the finger. long: `action` on a short tap, `longAction` after a hold. tap: `onTap` */
  kind: Kind;
  action?: Action;
  longAction?: Action;
  onTap?: () => void;
  /** FIRE: the finger also looks */
  looks?: boolean;
}

/** a long press is this long (ms) */
const LONG_MS = 380;
/** look speed: radians per CSS pixel relative to the mouse's, at a 900 px wide screen (so a phone and a tablet turn the same per swipe) */
const LOOK_GAIN = 1.7;

const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  fire: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  aim: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>'),
  reload: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'),
  jump: svg('<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>'),
  crouch: svg('<path d="M12 4v9"/><path d="M6 10l6 6 6-6"/><path d="M5 20h14"/>'),
  grenade: svg('<circle cx="12" cy="14" r="6"/><path d="M10 8V5h4v3"/><path d="M14 5l3-2"/>'),
  knife: svg('<path d="M4 20l9-9"/><path d="M13 11l7-7c0 5-2 8-5 9"/><path d="M6 15l3 3"/>'),
  swap: svg('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
  use: svg('<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5"/><path d="M12 10V4a1.5 1.5 0 0 1 3 0v6"/><path d="M15 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-2.5-4a1.5 1.5 0 0 1 2.5-1.6L9 14"/>'),
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
};

interface Track {
  kind: "stick" | "look" | "button";
  x: number;
  y: number;
  /** stick: where the base sits */
  ox?: number;
  oy?: number;
  btn?: ButtonDef;
  el?: HTMLElement;
  longTimer?: number;
  longDone?: boolean;
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private stickBase: HTMLDivElement;
  private stickKnob: HTMLDivElement;
  private sprintTag: HTMLDivElement;
  private tracks = new Map<number, Track>();
  private sprinting = false;
  private buttons = new Map<string, HTMLElement>();
  private defs: Map<string, ButtonDef>;
  private raf = 0;

  constructor(private input: Input, private opts: { scale: number; onPause: () => void; onTouch?: () => void }) {
    const root = (this.root = document.createElement("div"));
    root.id = "touch";
    const defs: ButtonDef[] = [
      { id: "fire", icon: ICONS.fire, label: "", kind: "hold", action: "fire", looks: true },
      { id: "fire-l", icon: ICONS.fire, label: "", kind: "hold", action: "fire" },
      { id: "aim", icon: ICONS.aim, label: "AIM", kind: "hold", action: "aim" },
      { id: "crouch", icon: ICONS.crouch, label: "CROUCH", kind: "long", action: "crouch", longAction: "prone" },
      { id: "reload", icon: ICONS.reload, label: "RELOAD", kind: "hold", action: "reload" },
      { id: "jump", icon: ICONS.jump, label: "JUMP", kind: "hold", action: "jump" },
      { id: "grenade", icon: ICONS.grenade, label: "NADE", kind: "long", action: "grenade", longAction: "grenadeType" },
      { id: "knife", icon: ICONS.knife, label: "KNIFE", kind: "hold", action: "knife" },
      { id: "swap", icon: ICONS.swap, label: "SWAP", kind: "tap", onTap: () => (this.input.wheel += 1) },
      { id: "use", icon: ICONS.use, label: "USE", kind: "hold", action: "use" },
      { id: "map", icon: ICONS.map, label: "", kind: "hold", action: "map" },
      { id: "pause", icon: ICONS.pause, label: "", kind: "tap", onTap: () => this.opts.onPause() },
    ];
    for (const d of defs) {
      const b = document.createElement("div");
      b.className = `tc-btn tc-${d.id}`;
      b.dataset.btn = d.id;
      b.innerHTML = d.icon + (d.label ? `<span>${d.label}</span>` : "");
      root.appendChild(b);
      this.buttons.set(d.id, b);
    }
    this.defs = new Map(defs.map((d) => [d.id, d]));
    const ghost = document.createElement("div");
    ghost.className = "tc-stick-ghost";
    root.appendChild(ghost);
    this.stickBase = document.createElement("div");
    this.stickBase.className = "tc-stick hidden";
    this.stickKnob = document.createElement("div");
    this.stickKnob.className = "tc-knob";
    this.sprintTag = document.createElement("div");
    this.sprintTag.className = "tc-sprint";
    this.sprintTag.textContent = "SPRINT";
    this.stickBase.append(this.sprintTag, this.stickKnob);
    root.appendChild(this.stickBase);
    document.body.appendChild(root);
    this.setScale(opts.scale);

    root.addEventListener("pointerdown", this.onDown);
    root.addEventListener("pointermove", this.onMove);
    root.addEventListener("pointerup", this.onUp);
    root.addEventListener("pointercancel", this.onUp);
    root.addEventListener("lostpointercapture", this.onUp);
    root.addEventListener("contextmenu", (e) => e.preventDefault());
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      this.buttons.get("aim")!.classList.toggle("on", this.input.adsHeld);
    };
    tick();
  }

  /** the button size, 0.7–1.4 */
  setScale(s: number) {
    document.body.style.setProperty("--ts", String(s));
  }

  /** let go of everything (paused, dead, a menu over the game) */
  reset() {
    for (const t of this.tracks.values()) this.release(t, true);
    this.tracks.clear();
    this.input.moveX = this.input.moveY = 0;
  }

  dispose() {
    this.reset();
    cancelAnimationFrame(this.raf);
    this.root.remove();
  }

  /** the stick's radius in CSS pixels (follows the button size) */
  private get radius() {
    return this.stickBase.offsetWidth / 2 || 60;
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault();
    this.opts.onTouch?.();
    // (a finger whose lift we never heard about: let go of what it held first)
    const stale = this.tracks.get(e.pointerId);
    if (stale) {
      this.tracks.delete(e.pointerId);
      this.release(stale);
    }
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* already gone */
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-btn]");
    const t: Track = { kind: "look", x: e.clientX, y: e.clientY };
    if (el) {
      const btn = this.defs.get(el.dataset.btn!)!;
      t.kind = "button";
      t.btn = btn;
      t.el = el;
      el.classList.add("down");
      navigator.vibrate?.(8);
      if (btn.kind === "hold") this.input.actionDown(btn.action!);
      else if (btn.kind === "tap") btn.onTap?.();
      else
        t.longTimer = window.setTimeout(() => {
          t.longDone = true;
          this.tap(btn.longAction!);
          navigator.vibrate?.(18);
        }, LONG_MS);
    } else if (e.clientX < window.innerWidth * 0.42 && ![...this.tracks.values()].some((o) => o.kind === "stick")) {
      // the stick appears under the thumb (kept clear of the screen edge)
      const r = this.radius;
      t.kind = "stick";
      t.ox = Math.max(r + 8, Math.min(window.innerWidth * 0.42, e.clientX));
      t.oy = Math.max(r + 40, Math.min(window.innerHeight - r - 8, e.clientY));
      this.stickBase.style.left = `${t.ox}px`;
      this.stickBase.style.top = `${t.oy}px`;
      this.stickBase.classList.remove("hidden");
      this.root.classList.add("sticking");
      this.updateStick(t, e.clientX, e.clientY);
    }
    this.tracks.set(e.pointerId, t);
  };

  private onMove = (e: PointerEvent) => {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    if (t.kind === "stick") this.updateStick(t, e.clientX, e.clientY);
    else if (t.kind === "look" || t.btn?.looks) {
      const k = (LOOK_GAIN * 900) / Math.max(window.innerWidth, window.innerHeight, 1);
      // (all the movement since the last event, coalesced ones included)
      this.input.look((e.clientX - t.x) * k, (e.clientY - t.y) * k);
    }
    t.x = e.clientX;
    t.y = e.clientY;
  };

  private onUp = (e: PointerEvent) => {
    const t = this.tracks.get(e.pointerId);
    if (!t) return;
    this.tracks.delete(e.pointerId);
    this.release(t);
  };

  /** a finger lifted (`cancel`: taken away by a pause — a half-done long press does nothing) */
  private release(t: Track, cancel = false) {
    if (t.kind === "stick") {
      this.input.moveX = this.input.moveY = 0;
      this.setSprint(false);
      this.stickBase.classList.add("hidden");
      this.root.classList.remove("sticking");
    } else if (t.kind === "button" && t.btn) {
      t.el?.classList.remove("down");
      const b = t.btn;
      if (b.kind === "hold") this.input.actionUp(b.action!);
      else if (b.kind === "long") {
        clearTimeout(t.longTimer);
        if (!t.longDone && !cancel) this.tap(b.action!);
      }
    }
  }

  /** a quick press: seen by `hit()` this frame */
  private tap(a: Action) {
    this.input.actionDown(a);
    this.input.actionUp(a);
  }

  private updateStick(t: Track, x: number, y: number) {
    const r = this.radius;
    const dx = x - t.ox!;
    const dy = y - t.oy!;
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    this.stickKnob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`;
    // a small dead zone, then full range
    const n = Math.min(1, d / r);
    const m = n < 0.12 ? 0 : (n - 0.12) / 0.88;
    this.input.moveX = d > 0 ? (dx / d) * m : 0;
    this.input.moveY = d > 0 ? (-dy / d) * m : 0;
    // thumb pushed well past the ring, forwards: sprint (until it comes back inside)
    const fwd = d > 0 ? -dy / d : 0;
    if (!this.sprinting && d > r * 1.35 && fwd > 0.75) this.setSprint(true);
    else if (this.sprinting && (d < r * 0.9 || fwd < 0.5)) this.setSprint(false);
  }

  private setSprint(on: boolean) {
    if (on === this.sprinting) return;
    this.sprinting = on;
    this.stickBase.classList.toggle("sprint", on);
    if (on) {
      this.input.actionDown("sprint");
      navigator.vibrate?.(12);
    } else this.input.actionUp("sprint");
  }
}
