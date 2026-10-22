/**
 * DOM HUD. Crisp at any resolution, zero GPU cost, and every setter writes
 * to the DOM only when the value actually changes (no per-frame layout work).
 */
import { GRENADE_ICONS, WEAPON_ICONS } from "./icons";
import { BloodScreen } from "./BloodScreen";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export class Hud {
  private root = $("hud");
  private hpNum = $("hp-num");
  private hpFill = $("hp-fill");
  private hpGhost = $("hp-ghost");
  private vitals = $("vitals");
  private wpnName = $("wpn-name");
  private wpnIcon = $("wpn-icon");
  private wpnSwitch = $("wpn-switch");
  private switchT = 0;
  private blood = new BloodScreen($("hud"));
  private ammoMag = $("ammo-mag");
  private ammoRes = $("ammo-res");
  private ticks = $("ammo-ticks");
  private slots: HTMLElement[] = [];
  private scope = $("scope");
  private crosshair = $("crosshair");
  private hitmarker = $("hitmarker");
  private killfeed = $("killfeed");
  private prompt = $("prompt");
  private vignette = $("dmg-vignette");
  private indicators = $("dmg-indicators");
  private hostiles = $("hostile-count");
  private flashEl = $("flashbang");
  private equip = $("equip");
  private stanceEl = $("stance");
  private lastStance = "";
  private lastFlash = -1;
  private promptOverride = 0;
  private indicatorPool: HTMLDivElement[] = [];
  private indicatorIdx = 0;

  private last = { hp: -1, mag: -999, res: -999, wpn: "", gap: -1, chOpacity: -1, prompt: "", hostiles: -1, magSize: -1 };
  private hitTimer = 0;
  private vignetteT = 0;

  constructor(slots: { label: string; grenade?: boolean; title?: string }[]) {
    const holder = $("wpn-slots");
    holder.innerHTML = "";
    for (const s of slots) {
      const sp = document.createElement("span");
      sp.textContent = s.label;
      if (s.grenade) sp.classList.add("nade-slot");
      if (s.title) sp.title = s.title;
      holder.appendChild(sp);
      this.slots.push(sp);
    }
    for (let i = 0; i < 4; i++) {
      const d = document.createElement("div");
      d.style.opacity = "0";
      this.indicators.appendChild(d);
      this.indicatorPool.push(d);
    }
  }

  /** stance + lean readout above the vitals ("PRONE · ◀ PEEK") */
  setStance(stance: "stand" | "crouch" | "prone", lean: number) {
    const s = stance === "prone" ? "<b>PRONE</b>" : stance === "crouch" ? "<b>CROUCHED</b>" : "STANDING";
    const l = lean < -0.35 ? " · <b>◀ PEEK</b>" : lean > 0.35 ? " · <b>PEEK ▶</b>" : "";
    const txt = s + l;
    if (txt === this.lastStance) return;
    this.lastStance = txt;
    this.stanceEl.innerHTML = txt;
  }

  show(on: boolean) {
    this.root.classList.toggle("hidden", !on);
  }

  setHealth(hp: number, max: number) {
    const v = Math.ceil(hp);
    if (v === this.last.hp) return;
    this.last.hp = v;
    this.hpNum.textContent = String(v);
    const f = Math.max(0, hp / max);
    this.hpFill.style.transform = `scaleX(${f})`;
    this.hpGhost.style.transform = `scaleX(${f})`;
    this.vitals.classList.toggle("low", f < 0.3);
  }

  /** which loadout slots hold something (an empty launcher slot is greyed out) */
  setCarried(filled: boolean[]) {
    this.slots.forEach((s, i) => s.classList.toggle("empty", !filled[i]));
  }

  /** weapon in hand: its silhouette; the name + slot strip show for a moment after a switch */
  setWeapon(name: string, slot: number, id?: string) {
    if (name === this.last.wpn) return;
    const first = this.last.wpn === "";
    this.last.wpn = name;
    this.wpnName.textContent = name;
    this.wpnIcon.innerHTML = (id && WEAPON_ICONS[id]) || "";
    this.wpnIcon.dataset.w = id ?? "";
    this.slots.forEach((s, i) => s.classList.toggle("on", i === slot));
    this.last.magSize = -1;
    if (!first) {
      this.switchT = 2.2;
      this.wpnSwitch.classList.add("show");
    }
  }

  setAmmo(mag: number, reserve: number, magSize: number, shells: boolean) {
    if (magSize !== this.last.magSize) {
      this.last.magSize = magSize;
      this.ticks.innerHTML = "";
      this.ticks.classList.toggle("shells", shells);
      for (let i = 0; i < magSize; i++) this.ticks.appendChild(document.createElement("i"));
      this.last.mag = -999;
    }
    if (mag !== this.last.mag) {
      this.last.mag = mag;
      this.ammoMag.textContent = mag < 0 ? "—" : String(mag);
      this.ammoMag.classList.toggle("low", mag > 0 && mag <= Math.ceil(magSize * 0.25));
      this.ammoMag.classList.toggle("empty", mag === 0);
      const kids = this.ticks.children;
      for (let i = 0; i < kids.length; i++) kids[i].classList.toggle("spent", i >= mag);
    }
    if (reserve !== this.last.res) {
      this.last.res = reserve;
      this.ammoRes.textContent = reserve < 0 ? "" : String(reserve);
      this.ammoRes.parentElement?.classList.toggle("nores", reserve < 0);
    }
  }

  /** flashbang white-out 0..1 */
  setFlash(v: number) {
    const q = Math.round(v * 100) / 100;
    if (q === this.lastFlash) return;
    this.lastFlash = q;
    this.flashEl.style.opacity = String(Math.min(1, q * 1.05));
    this.flashEl.style.backdropFilter = q > 0.02 ? `blur(${(q * 9).toFixed(1)}px) brightness(${(1 + q * 1.4).toFixed(2)})` : "none";
  }

  private lastNadeKey = "";
  /**
   * Equipment, shooter-style: the tactical (flashbang) and the lethal grenade selected on the belt,
   * each an icon + count, with the throw / swap keys under them.
   */
  setGrenades(inv: Record<string, number>, current: string, keys?: { throw: string; swap: string }) {
    const key = current + Object.values(inv).join(",") + (keys ? keys.throw + keys.swap : "");
    if (key === this.lastNadeKey) return;
    this.lastNadeKey = key;
    const lethal = current === "flash" ? (["frag", "flame", "plasma"].find((t) => inv[t] > 0) ?? "frag") : current;
    const lethalCount = inv[lethal] ?? 0;
    const tac = inv.flash ?? 0;
    this.equip.innerHTML =
      `<span class="eq ${current === "flash" ? "on" : ""} ${tac <= 0 ? "empty" : ""}" title="Tactical">${GRENADE_ICONS.flash}<b>${tac}</b></span>` +
      `<span class="eq ${current !== "flash" ? "on" : ""} ${lethalCount <= 0 ? "empty" : ""}" title="Lethal">${GRENADE_ICONS[lethal] ?? GRENADE_ICONS.frag}<b>${lethalCount}</b></span>` +
      `<span class="eq-keys"><i>${keys?.throw ?? "G"}</i><i>${keys?.swap ?? "B"}</i></span>`;
  }

  /** short-lived message that wins over the normal prompt */
  flashPrompt(text: string) {
    this.promptOverride = 0;
    this.setPrompt(text, true);
    this.promptOverride = 1.3;
  }

  setHostiles(n: number) {
    if (n === this.last.hostiles) return;
    this.last.hostiles = n;
    this.hostiles.textContent = String(n);
  }

  /** gap in px derived from the real spread cone so the crosshair is honest. */
  setCrosshair(spreadDeg: number, fovDeg: number, opacity: number) {
    const h = window.innerHeight;
    const gap = Math.round((Math.tan((spreadDeg * Math.PI) / 180) / Math.tan((fovDeg * Math.PI) / 360)) * (h / 2)) + 4;
    const g = Math.min(gap, 90);
    if (g !== this.last.gap) {
      this.last.gap = g;
      this.crosshair.style.setProperty("--gap", g + "px");
    }
    const o = Math.round(opacity * 20) / 20;
    if (o !== this.last.chOpacity) {
      this.last.chOpacity = o;
      this.crosshair.style.opacity = String(o);
    }
  }

  hit(kind: "body" | "head", killed: boolean) {
    this.hitmarker.classList.toggle("head", kind === "head");
    this.hitmarker.classList.toggle("kill", killed);
    this.hitmarker.style.opacity = "1";
    this.hitmarker.style.transform = killed ? "scale(1.35)" : kind === "head" ? "scale(1.2)" : "scale(1)";
    this.hitTimer = killed ? 0.32 : 0.16;
  }

  kill(headshot: boolean) {
    const d = document.createElement("div");
    d.textContent = headshot ? "HEADSHOT · HOSTILE DOWN" : "HOSTILE DOWN";
    if (headshot) d.className = "hs";
    this.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 1850);
  }

  damage(amount: number, relYaw: number, hpFrac = 1) {
    this.blood.hit(amount, relYaw, hpFrac);
    const d = this.indicatorPool[this.indicatorIdx];
    this.indicatorIdx = (this.indicatorIdx + 1) % this.indicatorPool.length;
    d.style.transform = `rotate(${relYaw}rad)`;
    d.getAnimations().forEach((a) => a.cancel());
    d.animate([{ opacity: Math.min(1, 0.5 + amount / 15) }, { opacity: 0 }], { duration: 1100, easing: "ease-in" });
    this.vignetteT = Math.min(1, this.vignetteT + amount / 10);
  }

  /** a hard landing: no direction — the red closes in from every edge */
  fallDamage(amount: number) {
    this.vignetteT = Math.min(1, this.vignetteT + 0.45 + amount / 25);
  }

  private scopeOn = false;
  setScope(on: boolean) {
    if (on === this.scopeOn) return;
    this.scopeOn = on;
    this.scope.classList.toggle("hidden", !on);
  }

  setPrompt(text: string, warn = false) {
    if (this.promptOverride > 0 || text === this.last.prompt) return;
    this.last.prompt = text;
    this.prompt.innerHTML = text;
    this.prompt.classList.toggle("warn", warn);
  }

  update(dt: number, hpFrac: number) {
    if (this.promptOverride > 0) this.promptOverride -= dt;
    if (this.switchT > 0) {
      this.switchT -= dt;
      if (this.switchT <= 0) this.wpnSwitch.classList.remove("show");
    }
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitmarker.style.opacity = "0";
    }
    // damage vignette: flash + persistent tint at low health
    this.vignetteT = Math.max(0, this.vignetteT - dt * 1.6);
    const low = hpFrac < 0.35 ? (0.35 - hpFrac) * 1.6 : 0;
    const v = Math.min(1, this.vignetteT + low);
    this.vignette.style.opacity = v.toFixed(2);
  }

  reset() {
    this.last = { hp: -1, mag: -999, res: -999, wpn: "", gap: -1, chOpacity: -1, prompt: "", hostiles: -1, magSize: -1 };
    this.blood.clear();
    this.vignetteT = 0;
    this.hitTimer = 0;
    this.promptOverride = 0;
    this.lastNadeKey = "";
    this.hitmarker.style.opacity = "0";
    this.killfeed.innerHTML = "";
    for (const d of this.indicatorPool) {
      d.getAnimations().forEach((a) => a.cancel());
      d.style.opacity = "0";
    }
    this.setPrompt("");
  }
}
