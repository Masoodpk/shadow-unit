/**
 * ARMORY: every weapon in the game with what it does, read straight from config/weapons.ts so the screen
 * can never disagree with the guns (change a damage number there and it changes here).
 *
 * Left: the arsenal grouped by kind (rifles, SMGs, sniper, sidearm, launchers, melee, throwables).
 * Right: the selected weapon: its role and where you get it, six stat bars, the exact numbers (damage per
 * body part, fire rate, magazine, reload, range), and how many hits put a soldier down on the current
 * difficulty, and which carry slot it takes (a pickup fills an empty slot, or swaps with the gun of the same
 * kind). The pictures are renders of the game's own models (src/assets/armory, made from the pickup models).
 *
 * Opened from the main menu and the pause menu (main.ts openPanel("armory")). Arrow keys move the
 * selection.
 */
import { GRENADE_TYPES, RELOAD_SPEED, SLOT_LABEL, SLOT_ORDER, THROWING_KNIFE, WEAPONS, slotOf, type WeaponConfig, type WeaponId, type GrenadeType } from "../config/weapons";
import { DIFFICULTY, type Difficulty } from "../config/difficulty";

/** renders of the in-game models, by weapon id or grenade type (the combat knife and the throwing knife share one) */
const PICS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../assets/armory/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>).map(([k, v]) => [k.replace(/^.*\/|\.webp$/g, ""), v]),
);
const pic = (key: string, alt: string, cls = "") => (PICS[key] ? `<img class="${cls}" src="${PICS[key]}" alt="${alt}" draggable="false" loading="lazy" decoding="async">` : "");

/** a soldier's health on MEDIUM (config/game.ts ENEMY.maxHealth) */
const SOLDIER_HP = 100;

type Group = "RIFLES" | "SMG" | "SNIPER" | "SIDEARM" | "LAUNCHERS" | "MELEE" | "THROWABLES";
interface Meta {
  group: Group;
  kind: string;
  blurb: string;
  source: "STARTING KIT" | "SUPPLY CACHE";
}

const META: Partial<Record<WeaponId, Meta>> = {
  rifle: { group: "RIFLES", kind: "ASSAULT RIFLE", source: "STARTING KIT", blurb: "The unit's workhorse. Fast, flat and easy to hold on target: three rounds to the chest drop a soldier, one to the head." },
  ak47: { group: "RIFLES", kind: "ASSAULT RIFLE", source: "SUPPLY CACHE", blurb: "Hits harder than anything short of the sniper, at a slower cyclic rate and with a lot more kick. Short bursts." },
  carbine: { group: "RIFLES", kind: "CARBINE", source: "SUPPLY CACHE", blurb: "A short, quick-handling carbine with a tight spread. Three to the body, and every headshot is a kill." },
  m5: { group: "RIFLES", kind: "COMPACT RIFLE", source: "SUPPLY CACHE", blurb: "Light and quick to the shoulder, very controllable. Loses its punch past mid range." },
  vector: { group: "SMG", kind: "SUBMACHINE GUN", source: "SUPPLY CACHE", blurb: "The fastest trigger in the unit at 1,000 rounds a minute, with almost no climb. Brutal up close, weak at range." },
  uzi: { group: "SMG", kind: "SUBMACHINE GUN", source: "SUPPLY CACHE", blurb: "The classic open-bolt 9 mm. Slower than the Vector and it climbs more, but each round hits harder and the 32-round mag lasts." },
  vssk: { group: "SNIPER", kind: "SUPPRESSED SNIPER", source: "SUPPLY CACHE", blurb: "One shot, one soldier: anywhere on the body at any range the map has. Five rounds, slow bolt, quiet." },
  glock: { group: "SIDEARM", kind: "PISTOL", source: "STARTING KIT", blurb: "Your backup when the rifle runs dry. Quick to draw, but it takes six to the body (three to the head) to drop a soldier." },
  m72: { group: "LAUNCHERS", kind: "ROCKET LAUNCHER", source: "SUPPLY CACHE", blurb: "A single rocket that flattens a group and anything near the blast. Reload is slow: make it count." },
  dzj08: { group: "LAUNCHERS", kind: "ROCKET LAUNCHER", source: "SUPPLY CACHE", blurb: "A heavier warhead with a bigger blast than the M72 and a flatter flight." },
  knife: { group: "MELEE", kind: "COMBAT KNIFE", source: "STARTING KIT", blurb: "Silent. A slash, a heavy stab, and a takedown from behind. The quick-knife key uses it without switching." },
};

const GRENADE_BLURB: Record<GrenadeType, string> = {
  frag: "Cook it, throw it, clear the room. Kills anyone close to the blast and hurts everyone in the radius.",
  flame: "Bursts on impact into a pool of fire that burns whoever stands in it or runs through it.",
  plasma: "Sticks to what it hits, soldiers included, then detonates hard after a short fuse.",
  flash: "Blinds and deafens everyone who looks at it. No damage: go in while they can't see.",
  knife: "Thrown flat and fast. Kills a soldier anywhere it lands; walk over it to take it back.",
};

const GROUPS: Group[] = ["RIFLES", "SMG", "SNIPER", "SIDEARM", "LAUNCHERS", "MELEE", "THROWABLES"];

type Entry = { key: string; name: string; group: Group; pic: string; weapon?: WeaponConfig; grenade?: GrenadeType };

function entries(): Entry[] {
  const out: Entry[] = [];
  for (const g of GROUPS) {
    if (g === "THROWABLES") {
      for (const t of Object.keys(GRENADE_TYPES) as GrenadeType[]) out.push({ key: "g:" + t, name: GRENADE_TYPES[t].name, group: g, pic: t, grenade: t });
      continue;
    }
    for (const id of Object.keys(META) as WeaponId[]) {
      const m = META[id]!;
      if (m.group === g) out.push({ key: id, name: WEAPONS[id].displayName, group: g, pic: id, weapon: WEAPONS[id] });
    }
  }
  return out;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function reloadTimes(w: WeaponConfig) {
  const sum = (empty: boolean) =>
    w.reload.filter((p) => !p.loop && (empty ? !p.onlyIfNotEmpty : !p.onlyIfEmpty)).reduce((a, p) => a + p.duration, 0) / RELOAD_SPEED;
  return { tactical: sum(false), empty: sum(true) };
}

/** shots to put a soldier down inside the gun's full-damage range */
function shotsToKill(w: WeaponConfig, hp: number) {
  const d = w.damage;
  const n = (mul: number) => (d.base * mul > 0 ? Math.ceil(hp / (d.base * d.pellets * mul) - 1e-9) : Infinity);
  return { body: n(1), head: n(d.headMultiplier), limb: n(d.limbMultiplier) };
}

/** the six 0–1 bars */
function bars(w: WeaponConfig): [string, number, string][] {
  const d = w.damage;
  const s = w.spread;
  if (w.knife) {
    return [
      ["DAMAGE", clamp01(w.knife.heavy.damage / 120), `${w.knife.light.damage} / ${w.knife.heavy.damage}`],
      ["ATTACK SPEED", clamp01(0.5 / w.knife.light.time), `${w.knife.light.time.toFixed(2)} s`],
      ["RANGE", clamp01(w.knife.heavy.range / 30), `${w.knife.heavy.range} m`],
      ["ACCURACY", 1, "—"],
      ["MOBILITY", clamp01((w.moveSpeedScale - 0.75) / 0.4), `${Math.round(w.moveSpeedScale * 100)}%`],
      ["HANDLING", clamp01(1 - (w.equipTime + w.adsTime) / 1.6), `${w.equipTime.toFixed(2)} s draw`],
    ];
  }
  const proj = w.projectile;
  const perShot = proj ? proj.direct : d.base * d.pellets;
  return [
    ["DAMAGE", clamp01(Math.pow(perShot / 120, 0.6)), proj ? `${proj.damage} blast` : `${d.base}`],
    ["FIRE RATE", clamp01(w.rpm / 1000), `${w.rpm} rpm`],
    ["RANGE", proj ? 1 : clamp01(Math.sqrt(d.falloffEnd / 250)), proj ? `${proj.radius} m radius` : `${d.falloffStart}–${d.falloffEnd} m`],
    ["ACCURACY", clamp01(1 - (s.ads / 0.3) * 0.5 - (s.perShot / 0.4) * 0.4 - (s.hip / 4) * 0.1), `${s.ads.toFixed(2)}° aimed`],
    ["MOBILITY", clamp01((w.moveSpeedScale - 0.75) / 0.4), `${Math.round(w.moveSpeedScale * 100)}%`],
    ["HANDLING", clamp01(1 - (w.equipTime + w.adsTime) / 1.6), `${w.adsTime.toFixed(2)} s aim`],
  ];
}

const bar = ([label, v, note]: [string, number, string]) =>
  `<div class="arm-bar"><span class="arm-bar-l">${label}</span><span class="arm-bar-t"><i style="width:${Math.round(v * 100)}%"></i></span><span class="arm-bar-n">${esc(note)}</span></div>`;
const kv = (k: string, v: string) => `<div class="arm-kv"><span>${k}</span><b>${v}</b></div>`;
const pips = (n: number) => (Number.isFinite(n) ? `<b>${n}</b><span class="arm-pips">${"▮".repeat(Math.min(n, 12))}</span>` : "<b>—</b>");

function detail(e: Entry, diff: Difficulty): string {
  const k = DIFFICULTY[diff];
  const hp = Math.round(SOLDIER_HP * k.enemyHealth);
  if (e.grenade) {
    const g = GRENADE_TYPES[e.grenade];
    const isKnife = e.grenade === "knife";
    const dmg = isKnife ? `${THROWING_KNIFE.damage} body · ${THROWING_KNIFE.headDamage} head` : g.damage > 0 ? `${g.damage} at the centre` : "none (blinds)";
    return `
      <div class="arm-head"><div class="arm-kind">THROWABLE · ${g.short}</div><h3>${esc(g.name)}</h3><div class="arm-src">STARTING KIT · REFILLED AT CACHES</div></div>
      <div class="arm-icon arm-icon-g">${pic(e.pic, g.name)}</div>
      <p class="arm-blurb">${GRENADE_BLURB[e.grenade]}</p>
      <div class="arm-specs">
        ${kv("DAMAGE", dmg)}
        ${kv("BLAST RADIUS", isKnife ? "direct hit" : `${g.radius} m`)}
        ${kv("FUSE", isKnife ? "none" : g.impact ? "on impact" : `${g.fuse.toFixed(1)} s${g.sticky ? " · sticks" : ""}`)}
        ${kv("CARRIED", `${g.count} · on the grenade belt (key ${SLOT_ORDER.indexOf("grenade") + 1})`)}
      </div>`;
  }
  const w = e.weapon!;
  const m = META[w.id]!;
  const d = w.damage;
  const specs: string[] = [];
  let ttk = "";
  if (w.knife) {
    specs.push(kv("SLASH", `${w.knife.light.damage}`), kv("HEAVY STAB", `${w.knife.heavy.damage}`), kv("TAKEDOWN (BEHIND)", `${w.knife.backstab} · always kills`), kv("REACH", `${w.knife.heavy.range} m`));
    const slash = Math.ceil(hp / w.knife.light.damage);
    const stab = Math.ceil(hp / w.knife.heavy.damage);
    ttk = `<div class="arm-ttk-row"><span>SLASHES</span>${pips(slash)}</div><div class="arm-ttk-row"><span>HEAVY STABS</span>${pips(stab)}</div><div class="arm-ttk-row"><span>FROM BEHIND</span>${pips(1)}</div>`;
  } else if (w.projectile) {
    const p = w.projectile;
    specs.push(kv("DIRECT HIT", `${p.direct}`), kv("BLAST", `${p.damage} at the centre`), kv("BLAST RADIUS", `${p.radius} m`), kv("ROCKETS", `${w.magSize} loaded · ${w.reserveMax} max`));
    const r = reloadTimes(w);
    specs.push(kv("RELOAD", `${r.empty.toFixed(1)} s`), kv("ROCKET SPEED", `${p.speed} m/s`));
    ttk = `<div class="arm-ttk-row"><span>DIRECT HIT</span>${pips(Math.ceil(hp / p.direct))}</div><div class="arm-ttk-row"><span>INSIDE THE BLAST</span>${pips(Math.ceil(hp / p.damage))}</div>`;
  } else {
    const r = reloadTimes(w);
    const stk = shotsToKill(w, hp);
    const time = (n: number) => (n <= 1 ? "instant" : `${(((n - 1) * 60) / w.rpm).toFixed(2)} s`);
    specs.push(
      kv("DAMAGE / ROUND", `${d.base}`),
      kv("HEAD · LIMB", `${Math.round(d.base * d.headMultiplier)} (×${d.headMultiplier}) · ${Math.round(d.base * d.limbMultiplier)} (×${d.limbMultiplier})`),
      kv("FIRE MODE", w.fireMode === "auto" ? "FULL AUTO" : "SEMI AUTO"),
      kv("FIRE RATE", `${w.rpm} rounds / min`),
      kv("MAGAZINE", `${w.magSize} · ${w.reserveMax} max carried`),
      kv("RELOAD", `${r.tactical.toFixed(1)} s · ${r.empty.toFixed(1)} s empty`),
      kv("FULL DAMAGE TO", `${d.falloffStart} m, ${Math.round(d.minDamageScale * 100)}% past ${d.falloffEnd} m`),
      kv("MAX RANGE", `${d.range} m`),
    );
    ttk = `<div class="arm-ttk-row"><span>HEAD</span>${pips(stk.head)}<em>${time(stk.head)}</em></div>
      <div class="arm-ttk-row"><span>BODY</span>${pips(stk.body)}<em>${time(stk.body)}</em></div>
      <div class="arm-ttk-row"><span>ARMS · LEGS</span>${pips(stk.limb)}<em>${time(stk.limb)}</em></div>`;
  }
  const slot = slotOf(w);
  const rivals = (Object.keys(META) as WeaponId[]).filter((id) => id !== w.id && slotOf(WEAPONS[id]) === slot).map((id) => WEAPONS[id].displayName);
  const carry =
    `<div class="arm-slot"><b>${SLOT_LABEL[slot]} SLOT · KEY ${SLOT_ORDER.indexOf(slot) + 1}</b>` +
    (slot === "melee"
      ? `<span>Always carried: it never leaves your kit, and the quick-knife key uses it from any weapon.</span>`
      : rivals.length
      ? `<span>Picked up with the slot empty, it's simply added. With ${rivals.join(" / ")} in it, the two are swapped and yours is left on the ground.</span>`
      : `<span>The only weapon of its kind: picking another one up only tops up its ammo.</span>`) +
    `</div>`;
  return `
    <div class="arm-head"><div class="arm-kind">${m.kind}</div><h3>${esc(w.displayName)}</h3><div class="arm-src ${m.source === "STARTING KIT" ? "kit" : ""}">${m.source}</div></div>
    <div class="arm-icon">${pic(e.pic, w.displayName)}</div>
    <p class="arm-blurb">${m.blurb}</p>
    ${carry}
    <div class="arm-bars">${bars(w).map(bar).join("")}</div>
    <div class="arm-ttk"><div class="arm-ttk-h">HITS TO DOWN A SOLDIER <span>${k.label} · ${hp} HP</span></div>${ttk}</div>
    <div class="arm-specs">${specs.join("")}</div>`;
}

export class Armory {
  private list: Entry[] = entries();
  private sel = "rifle";
  private diff: Difficulty = "medium";
  private keys = (e: KeyboardEvent) => this.onKey(e);

  constructor(private root: HTMLElement) {
    root.innerHTML = `<div class="armory"><nav class="arm-list" aria-label="Weapons"></nav><section class="arm-detail" aria-live="polite"></section></div>`;
    root.querySelector(".arm-list")!.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
      if (b) this.select(b.dataset.key!);
    });
  }

  /** draw it for this difficulty and start listening for the arrow keys */
  open(diff: Difficulty) {
    this.diff = diff;
    const nav = this.root.querySelector(".arm-list")!;
    let html = "";
    let group = "";
    for (const e of this.list) {
      if (e.group !== group) {
        group = e.group;
        html += `<div class="arm-group">${group}</div>`;
      }
      html += `<button type="button" class="arm-item" data-key="${e.key}"><span class="arm-item-icon">${pic(e.pic, "")}</span><span class="arm-item-name">${esc(e.name)}</span></button>`;
    }
    nav.innerHTML = html;
    this.select(this.sel);
    window.addEventListener("keydown", this.keys);
  }

  close() {
    window.removeEventListener("keydown", this.keys);
  }

  private select(key: string) {
    const e = this.list.find((x) => x.key === key) ?? this.list[0];
    this.sel = e.key;
    for (const b of this.root.querySelectorAll<HTMLElement>(".arm-item")) b.classList.toggle("on", b.dataset.key === e.key);
    this.root.querySelector(".arm-detail")!.innerHTML = detail(e, this.diff);
    this.root.querySelector<HTMLElement>(`.arm-item[data-key="${e.key}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private onKey(e: KeyboardEvent) {
    const step = e.code === "ArrowDown" || e.code === "ArrowRight" ? 1 : e.code === "ArrowUp" || e.code === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const i = this.list.findIndex((x) => x.key === this.sel);
    this.select(this.list[(i + step + this.list.length) % this.list.length].key);
  }
}
