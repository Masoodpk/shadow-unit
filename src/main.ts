import { mpHealthUrl, mpServerUrl } from "./config/net";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import "./styles.css";
import type { Game, GameState, RoundStats } from "./core/Game";
import { ACTIONS, Action, RESERVED, bindings, codeLabel } from "./core/Bindings";
import { STAGES, StageId, stageInfo } from "./config/stages";
import { DIFFICULTY, DIFFICULTIES, Difficulty, difficulty } from "./config/difficulty";
import nightshiftThumb from "./assets/thumbs/nightshift.webp?url";
import frostlineThumb from "./assets/thumbs/frostline.webp?url";
import sandstormThumb from "./assets/thumbs/sandstorm.webp?url";
import whiteoutThumb from "./assets/thumbs/whiteout.webp?url";
import metroThumb from "./assets/thumbs/metro.webp?url";
import { TOUCH_LABELS, TouchControls, isTouchDevice } from "./ui/TouchControls";

/** stage thumbnails: real renders of each stage */
const THUMBS: Record<StageId, string> = { office: frostlineThumb, dust2: sandstormThumb, metro: metroThumb, nightshift: nightshiftThumb, whiteout: whiteoutThumb };

/**
 * Boot flow (plain DOM, so it shows before the engine is parsed):
 *   title (engine downloads in the background) → main menu → stage select →
 *   stage loading → play (starts by itself; the first click captures the mouse).
 * Clearing a stage offers the next one ("NEXT STAGE" reloads straight into it).
 * Settings and controls are panels opened from the main menu or the pause menu.
 * "Main menu" from inside a stage reloads the page (the engine is built once per stage).
 */
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const show = (id: string, on: boolean) => $(id).classList.toggle("hidden", !on);

const store = {
  get(k: string, d: string) {
    try {
      return localStorage.getItem("saltline." + k) ?? d;
    } catch {
      return d;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem("saltline." + k, v);
    } catch {
      /* storage unavailable */
    }
  },
};
const session = {
  get(k: string) {
    try {
      return sessionStorage.getItem("saltline." + k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) sessionStorage.removeItem("saltline." + k);
      else sessionStorage.setItem("saltline." + k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

let game: Game | null = null;

/**
 * Phones and tablets: on-screen controls instead of mouse and keys (ui/TouchControls), no pointer
 * lock (the game runs as in the no-lock fallback), prompts naming the buttons, fullscreen and
 * landscape where the browser allows it, and low graphics unless changed.
 */
const touch = isTouchDevice();
let touchUi: TouchControls | null = null;
if (touch) {
  document.body.classList.add("touch");
  bindings.touchLabels = TOUCH_LABELS;
}
/**
 * Fullscreen (+ landscape lock on touch). Both need a click or tap behind them, so they're asked for on
 * the clicks that start and resume play. A computer goes fullscreen too unless the setting is off;
 * ESC leaves fullscreen (and pauses, as before) and RESUME goes back in. iPhone Safari has neither.
 */
function goFullscreen() {
  if (!touch && !(toggles?.fullscreen.value ?? true)) return;
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const lock = () => (touch ? (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.("landscape").catch(() => undefined) : undefined);
  try {
    if (document.fullscreenElement) void lock();
    else if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: "hide" }).then(lock, () => undefined);
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here */
  }
}

/**
 * Menu music: its own little Web Audio player (the game's audio engine only exists once a stage
 * loads). Starts on the first key / click (browsers need a gesture), fades out on launch, and comes
 * back in the pause menu (the game itself falls silent there). Can be switched off in settings.
 */
const menuMusic = {
  ctx: null as AudioContext | null,
  gain: null as GainNode | null,
  started: false,
  /** in a menu (title, stage select, pause) rather than in the game */
  active: true,
  async start() {
    if (this.started) return;
    this.started = true;
    try {
      const ctx = (this.ctx = new AudioContext());
      const gain = (this.gain = ctx.createGain());
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      let buf: AudioBuffer | null = null;
      try {
        const r = await fetch(import.meta.env.BASE_URL + "music/menu.mp3");
        if (r.ok && (r.headers.get("content-type") ?? "").startsWith("audio")) buf = await ctx.decodeAudioData(await r.arrayBuffer());
      } catch {
        /* no own track */
      }
      if (!buf) {
        const { composeMenuTheme } = await import("./audio/Music");
        const [l, rr] = composeMenuTheme(ctx.sampleRate);
        buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
        buf.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
        buf.copyToChannel(rr as Float32Array<ArrayBuffer>, 1);
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.apply();
    } catch {
      /* audio unavailable */
    }
  },
  apply() {
    if (!this.ctx || !this.gain) return;
    const on = this.active && toggles.menuMusic.value && !toggles.muted.value;
    const v = on ? 0.5 * prefs.volume * prefs.music : 0;
    if (on && this.ctx.state === "suspended") void this.ctx.resume();
    this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, this.active ? 0.6 : 0.3);
  },
  /** into the game (fade out) / back to a menu (fade in) */
  setActive(on: boolean) {
    this.active = on;
    if (on) void this.start();
    this.apply();
  },
  stop() {
    this.setActive(false);
  },
};
const startMenuMusic = () => void menuMusic.start();
window.addEventListener("keydown", startMenuMusic, { once: true });
window.addEventListener("mousedown", startMenuMusic, { once: true });
window.addEventListener("touchend", startMenuMusic, { once: true });
/** no pointer lock: the cursor-bound fallback, and always on a touch screen */
let lockFallback = touch;
/** pointer lock has succeeded at least once (so a later refusal is the browser's re-lock cooldown) */
let lockWorked = false;
const asStage = (v: string | null | undefined): StageId => (STAGES.some((s) => s.id === v) ? (v as StageId) : STAGES[0].id);
let stage: StageId = asStage(store.get("stage", STAGES[0].id));

// ------------------------------------------------------------------ settings
const num = (k: string, d: number) => {
  const v = parseFloat(store.get(k, String(d)));
  return Number.isFinite(v) ? v : d;
};
const prefs = {
  sens: num("sens", 1),
  fov: num("fov", 70),
  volume: num("volume", 1),
  ambience: num("ambience", 1),
  music: num("music", 0.6),
  quality: (store.get("quality", touch ? "low" : "high") === "low" ? "low" : "high") as "high" | "low",
  /** on-screen button size (touch) */
  touchScale: num("touchScale", 1),
};

function bindRange(id: string, key: keyof typeof prefs, fmt: (v: number) => string, apply: (v: number) => void) {
  const el = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(id + "-val");
  el.value = String(prefs[key]);
  out.textContent = fmt(prefs[key] as number);
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    (prefs[key] as number) = v;
    out.textContent = fmt(v);
    store.set(key, String(v));
    apply(v);
  });
}
bindRange("set-sens", "sens", (v) => v.toFixed(2), (v) => game?.setSensitivity(v));
bindRange("set-touch", "touchScale", (v) => `${Math.round(v * 100)}%`, (v) => touchUi?.setScale(v));
if (touch) $("sens-label").textContent = "LOOK SENSITIVITY";
bindRange("set-fov", "fov", (v) => `${Math.round(v)}°`, (v) => game?.setFov(v));
bindRange("set-vol", "volume", (v) => `${Math.round(v * 100)}%`, (v) => {
  game?.audio?.setVolume(v);
  menuMusic.apply();
});
bindRange("set-amb", "ambience", (v) => `${Math.round(v * 100)}%`, (v) => game?.audio?.setAmbienceLevel(v));
bindRange("set-music", "music", (v) => `${Math.round(v * 100)}%`, (v) => {
  game?.audio?.setMusicLevel(v);
  menuMusic.apply();
});
// ------------------------------------------------------------------ difficulty (stage screen + SETTINGS)
const DIFF_NOTE: Record<Difficulty, string> = {
  easy: "enemies go down fast · their fire hurts less · health comes back sooner",
  medium: "the game as designed",
  hard: "tougher enemies · sharper, quicker aim · every hit costs more",
};
function setDifficulty(d: Difficulty) {
  difficulty.set(d);
  store.set("difficulty", difficulty.id);
  game?.setDifficulty(difficulty.id);
  for (const id of ["stage-difficulty", "set-difficulty"]) $<HTMLSelectElement>(id).value = difficulty.id;
  // (what it does, on hover)
  $("dp-wrap").title = DIFF_NOTE[difficulty.id];
}
for (const id of ["stage-difficulty", "set-difficulty"]) $<HTMLSelectElement>(id).addEventListener("change", (e) => setDifficulty((e.target as HTMLSelectElement).value as Difficulty));
setDifficulty((DIFFICULTIES as string[]).includes(store.get("difficulty", "medium")) ? (store.get("difficulty", "medium") as Difficulty) : "medium");

const qSel = $<HTMLSelectElement>("set-quality");
qSel.value = prefs.quality;
qSel.addEventListener("change", () => {
  prefs.quality = qSel.value === "low" ? "low" : "high";
  store.set("quality", prefs.quality);
});

const toggles = {
  muted: { id: "set-sound", value: store.get("muted", "0") === "1", invert: true, key: "muted" },
  // (off on every fresh launch — kept on only between the stages of this session, which reload the page)
  devMode: { id: "set-dev", value: session.get("dev") === "1", invert: false, key: "dev" },
  aimToggle: { id: "set-aim", value: store.get("aimToggle", "1") === "1", invert: false, key: "aimToggle" },
  menuMusic: { id: "set-menumusic", value: store.get("menuMusic", "1") === "1", invert: false, key: "menuMusic" },
  fullscreen: { id: "set-fullscreen", value: store.get("fullscreen", "1") === "1", invert: false, key: "fullscreen" },
};
type ToggleKey = keyof typeof toggles;
function syncToggle(key: ToggleKey, v: boolean) {
  const t = toggles[key];
  t.value = v;
  if (key === "devMode") session.set("dev", v ? "1" : "0");
  else store.set(t.key, v ? "1" : "0");
  const checked = t.invert ? !v : v;
  $<HTMLInputElement>(t.id).checked = checked;
  $(t.id + "-val").textContent = checked ? "ON" : "OFF";
  if (key === "devMode") {
    // developer mode off: its options off with it
    if (!v) devOpts.god = devOpts.arsenal = false;
    syncDevSwitches();
  }
}
/** the developer options (god mode, all weapons): the switches in CONTROLS, the H / L keys in play */
const devOpts = { god: false, arsenal: false };
function syncDevSwitches() {
  const dev = toggles.devMode.value;
  const set = (id: string, v: boolean) => {
    $<HTMLInputElement>(id).checked = v;
    $(id + "-val").textContent = v ? "ON" : "OFF";
  };
  set("ctl-dev", dev);
  set("ctl-god", dev && devOpts.god);
  set("ctl-arsenal", dev && devOpts.arsenal);
  $("dev-switches").classList.toggle("off", !dev);
}
for (const key of Object.keys(toggles) as ToggleKey[]) {
  const t = toggles[key];
  syncToggle(key, t.value);
  $<HTMLInputElement>(t.id).addEventListener("change", (e) => {
    const checked = (e.target as HTMLInputElement).checked;
    const v = t.invert ? !checked : checked;
    syncToggle(key, v);
    if (key === "muted") {
      game?.setMuted(v);
      menuMusic.apply();
    } else if (key === "menuMusic") menuMusic.apply();
    else if (key === "aimToggle") game?.setAimToggle(v);
    else if (key === "fullscreen") {
      /* used on the next deploy / resume */
    } else game?.setDevMode(v);
  });
}
$<HTMLInputElement>("ctl-dev").addEventListener("change", (e) => {
  const v = (e.target as HTMLInputElement).checked;
  syncToggle("devMode", v);
  game?.setDevMode(v);
});
$<HTMLInputElement>("ctl-god").addEventListener("change", (e) => {
  devOpts.god = toggles.devMode.value && (e.target as HTMLInputElement).checked;
  game?.setGod(devOpts.god);
  syncDevSwitches();
});
$<HTMLInputElement>("ctl-arsenal").addEventListener("change", (e) => {
  devOpts.arsenal = toggles.devMode.value && (e.target as HTMLInputElement).checked;
  game?.setArsenal(devOpts.arsenal);
  syncDevSwitches();
});

// ------------------------------------------------------------------ panels (settings / controls / credits)
let panelReturn = "menu";
function openPanel(id: "settings" | "controls" | "credits" | "mp", from: string) {
  panelReturn = from;
  show(from, false);
  show(id, true);
  if (id === "controls") renderBinds();
}
function closePanels() {
  cancelCapture();
  for (const p of ["settings", "controls", "credits", "mp"]) show(p, false);
  show(panelReturn, true);
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".panel-back")) b.addEventListener("click", closePanels);

// ------------------------------------------------------------------ key bindings UI
let capture: { action: Action; slot: number; el: HTMLElement } | null = null;
function renderBinds() {
  const list = $("bind-list");
  list.innerHTML = "";
  let group = "";
  for (const d of ACTIONS) {
    if (d.group !== group) {
      group = d.group;
      const h = document.createElement("div");
      h.className = "bind-group";
      h.textContent = group;
      list.appendChild(h);
    }
    const row = document.createElement("div");
    row.className = "bind-row";
    const label = document.createElement("span");
    label.className = "bind-label";
    label.textContent = d.label;
    row.appendChild(label);
    const codes = bindings.codes(d.id);
    for (let slot = 0; slot < 2; slot++) {
      const k = document.createElement("button");
      k.className = "bind-key" + (codes[slot] ? "" : " empty");
      k.textContent = codes[slot] ? codeLabel(codes[slot]) : "—";
      k.addEventListener("click", (e) => {
        e.stopPropagation();
        startCapture(d.id, slot, k);
      });
      k.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (capture) return;
        if (bindings.codes(d.id)[slot]) {
          bindings.clear(d.id, slot);
          renderBinds();
        }
      });
      row.appendChild(k);
    }
    list.appendChild(row);
  }
  updateHints();
}
function startCapture(action: Action, slot: number, el: HTMLElement) {
  cancelCapture();
  capture = { action, slot, el };
  el.classList.add("capturing");
  el.textContent = "PRESS A KEY";
  $("bind-msg").textContent = "";
  // the click that started the capture must not be taken as the new binding
  setTimeout(() => {
    window.addEventListener("keydown", onCaptureKey, true);
    window.addEventListener("mousedown", onCaptureMouse, true);
  }, 0);
}
function cancelCapture() {
  window.removeEventListener("keydown", onCaptureKey, true);
  window.removeEventListener("mousedown", onCaptureMouse, true);
  if (capture) {
    capture = null;
    renderBinds();
  }
}
function finishCapture(code: string) {
  if (!capture) return;
  const { action, slot } = capture;
  if (RESERVED.has(code)) {
    $("bind-msg").textContent = `${codeLabel(code)} is reserved (pause / developer keys) — pick another key.`;
    return;
  }
  const stolen = bindings.set(action, slot, code);
  const def = ACTIONS.find((a) => a.id === action)!;
  const msg = stolen ? `${codeLabel(code)} → ${def.label}  (removed from “${ACTIONS.find((a) => a.id === stolen)!.label}”)` : `${codeLabel(code)} → ${def.label}`;
  cancelCapture();
  renderBinds();
  $("bind-msg").textContent = msg;
}
function onCaptureKey(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  if (e.code === "Escape") {
    cancelCapture();
    return;
  }
  finishCapture(e.code);
}
function onCaptureMouse(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  finishCapture(e.button === 0 && e.ctrlKey ? "Mouse2" : "Mouse" + e.button);
}
$("btn-binds-reset").addEventListener("click", () => {
  bindings.resetDefaults();
  renderBinds();
  $("bind-msg").textContent = "Default keys restored.";
});
function updateHints() {
  $("hint-lean").textContent = bindings.label("leanLeft");
  $("hint-lean2").textContent = bindings.label("leanRight");
  $("hint-prone").textContent = bindings.label("prone");
}
updateHints();
if (touch) {
  document.querySelector("#menu .menu-hint")!.innerHTML = "Tip: left thumb moves (push the stick far forward to sprint) · drag on the right to look · <b>hold CROUCH</b> to go prone";
  $("splash-continue").textContent = "TAP TO CONTINUE";
}

// ------------------------------------------------------------------ title → menu → stages
function goMenu() {
  for (const s of ["splash", "stages", "settings", "controls", "credits"]) show(s, false);
  show("menu", true);
  // (an invite link: straight on to the MULTIPLAYER screen, once)
  if (pendingInvite) {
    pendingInvite = false;
    openMpPanel?.();
  }
}
let pendingInvite = false;
let openMpPanel: (() => void) | null = null;
let splashDone = false;
function leaveSplash() {
  if (splashDone || !engineReady) return;
  splashDone = true;
  window.removeEventListener("keydown", leaveSplash);
  window.removeEventListener("mousedown", leaveSplash);
  $("splash").classList.add("fade-out");
  setTimeout(goMenu, 380);
}
let engineReady = false;
let gameModule: Promise<typeof import("./core/Game")> | null = null;
function prefetchEngine() {
  if (!gameModule) gameModule = import("./core/Game");
  return gameModule;
}
function runSplash() {
  loadVideo("splash", true);
  const fill = $("splash-fill");
  const step = $("splash-step");
  let p = 0;
  // the download has no byte progress (dynamic import), so ease towards 90 % until it resolves
  const timer = setInterval(() => {
    p += (0.9 - p) * 0.06;
    fill.style.width = `${Math.round(p * 100)}%`;
    $("splash-pct").textContent = `${Math.round(p * 100)}%`;
  }, 50);
  const minTime = new Promise((r) => setTimeout(r, 1800));
  Promise.all([prefetchEngine(), minTime])
    .then(() => {
      clearInterval(timer);
      loadVideo("splash", false);
      fill.style.width = "100%";
      step.textContent = "Ready — 100%";
      engineReady = true;
      show("splash-continue", true);
      window.addEventListener("keydown", leaveSplash);
      window.addEventListener("mousedown", leaveSplash);
      setTimeout(leaveSplash, 3500);
    })
    .catch((err) => {
      clearInterval(timer);
      step.textContent = "Failed to load: " + (err instanceof Error ? err.message : String(err));
    });
}

/** the stage carousel: one row of cards, the chosen one centred; ◂ ▸ (and the arrow keys) step through */
function stepStage(d: number) {
  const i = STAGES.findIndex((s) => s.id === stage);
  stage = STAGES[(i + d + STAGES.length) % STAGES.length].id;
  store.set("stage", stage);
  renderStages();
}
$("stage-prev").addEventListener("click", () => stepStage(-1));
window.addEventListener("resize", () => layoutStages(STAGES.findIndex((s) => s.id === stage)));
$("stage-next").addEventListener("click", () => stepStage(1));
window.addEventListener("keydown", (e) => {
  if ($("stages").classList.contains("hidden")) return;
  if (e.code === "ArrowRight") stepStage(1);
  else if (e.code === "ArrowLeft") stepStage(-1);
  else if (e.code === "Enter") void deploy();
});
function renderStages() {
  const list = $("stage-list");
  list.innerHTML = "";
  for (const s of STAGES) {
    const card = document.createElement("button");
    card.className = `stage-card stage-${s.id}` + (s.id === stage ? " on" : "");
    const done = store.get("cleared_" + s.id, "0") === "1";
    card.innerHTML = `<div class="stage-thumb" style="background-image:url(${THUMBS[s.id]})"><span class="stage-tag">${s.tag}</span>${done ? '<span class="stage-done">✓ CLEARED</span>' : ""}</div><div class="stage-body"><div class="brand-kicker">${s.kicker}</div><div class="stage-name">${s.name}</div><div class="stage-loc">${s.location}</div><div class="stage-desc">${s.description}</div></div>`;
    card.addEventListener("click", () => {
      stage = s.id;
      store.set("stage", stage);
      renderStages();
    });
    card.addEventListener("dblclick", () => void deploy());
    list.appendChild(card);
  }
  // (whole cards only: as many as fit across the window, sized to fill it exactly, and the row slid a
  // whole card at a time so the chosen one is in view — centring it left the end cards cut in half)
  const i = STAGES.findIndex((s) => s.id === stage);
  requestAnimationFrame(() => layoutStages(i));
}
function layoutStages(i: number) {
  const list = $("stage-list");
  const win = list.parentElement as HTMLElement;
  const cs = getComputedStyle(win);
  const inner = win.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const gap = parseFloat(getComputedStyle(list).columnGap) || 16;
  const n = STAGES.length;
  const k = Math.max(1, Math.min(n, Math.floor((inner + gap) / (270 + gap))));
  const w = (inner - gap * (k - 1)) / k;
  for (const c of Array.from(list.children) as HTMLElement[]) {
    // (border-box: the card's 1 px border inside that width, or each ran 2 px over and the last one was cut)
    c.style.boxSizing = "border-box";
    c.style.flex = `0 0 ${w}px`;
    c.style.minWidth = "0";
  }
  // (all the cards fit: no arrows, no dots — they're only there when some are off it)
  const fits = k >= n;
  for (const id of ["stage-prev", "stage-next", "stage-dots"]) $(id).style.visibility = fits ? "hidden" : "visible";
  $("stage-prev").style.display = $("stage-next").style.display = fits ? "none" : "";
  const first = Math.max(0, Math.min(n - k, i - Math.floor((k - 1) / 2)));
  list.style.transform = `translateX(${-first * (w + gap)}px)`;
  const dots = $("stage-dots");
  dots.innerHTML = STAGES.map((s, k) => `<span class="${k === i ? "on" : ""}" title="${s.name}"></span>`).join("");
}
$("btn-play").addEventListener("click", () => {
  goFullscreen();
  show("menu", false);
  // (the stage screen always opens on the first stage)
  stage = STAGES[0].id;
  store.set("stage", stage);
  renderStages();
  show("stages", true);
});
$("btn-stages-back").addEventListener("click", goMenu);
$("btn-settings").addEventListener("click", () => openPanel("settings", "menu"));
$("btn-controls").addEventListener("click", () => openPanel("controls", "menu"));
$("btn-credits").addEventListener("click", () => openPanel("credits", "menu"));

// ------------------------------------------------------------------ online deathmatch
/** set when a multiplayer game is being deployed (Black Ledger, no soldiers, the others are the enemy) */
let mpSettings: import("./net/MpClient").MpSettings | null = null;
/** the server: config/net (the public Render service on the live site; this machine when run locally) */
const mpDefaultUrl = () => mpServerUrl();
$<HTMLInputElement>("mp-name").value = store.get("mpName", "");
$<HTMLInputElement>("mp-room").value = store.get("mpRoom", "");
$<HTMLInputElement>("mp-url").value = store.get("mpUrl", "") || mpDefaultUrl();
// (the address field is for testing only: friends never need it)
if (store.get("mpUrl", "") || import.meta.env.DEV) $("mp-url-row").classList.remove("hidden");
$("mp-advanced").addEventListener("click", (e) => {
  e.preventDefault();
  $("mp-url-row").classList.toggle("hidden");
});
/**
 * The server's state on the MULTIPLAYER screen, polled while it's open. The first poll is also what
 * wakes a sleeping free host (Render stops it after 15 idle minutes; it's back within about a minute).
 */
let mpPoll = 0;
async function pollMpServer() {
  const el = $("mp-server");
  const url = $<HTMLInputElement>("mp-url").value.trim() || mpDefaultUrl();
  const t0 = performance.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch(mpHealthUrl(url), { signal: ctl.signal, cache: "no-store" });
    clearTimeout(to);
    const j = (await r.json()) as { players: number; rooms: number };
    el.className = "mp-server ok";
    el.textContent = `● SERVER ONLINE · ${j.players} PLAYING IN ${j.rooms} ROOM${j.rooms === 1 ? "" : "S"} · ${Math.round(performance.now() - t0)} MS`;
  } catch {
    el.className = "mp-server wait";
    el.textContent = "◌ WAKING UP THE SERVER — UP TO A MINUTE AFTER A QUIET SPELL. YOU CAN JOIN NOW: IT KEEPS TRYING.";
  }
}
function openMp() {
  openPanel("mp", "menu");
  void pollMpServer();
  clearInterval(mpPoll);
  mpPoll = window.setInterval(() => {
    if ($("mp").classList.contains("hidden")) clearInterval(mpPoll);
    else void pollMpServer();
  }, 5000);
}
$("btn-mp").addEventListener("click", openMp);
// an invite link (…/?room=CODE): the MULTIPLAYER screen, the code filled in
const invited = new URLSearchParams(location.search).get("room");
if (invited && !new URLSearchParams(location.search).has("quick")) {
  $<HTMLInputElement>("mp-room").value = invited.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  $("mp-note").textContent = `You've been invited to room ${$<HTMLInputElement>("mp-room").value}. Type your name and press JOIN ROOM.`;
  pendingInvite = true;
}
openMpPanel = openMp;
// (the pause menu, online: the link to send friends)
$("btn-invite-p").addEventListener("click", () => {
  const code = game?.mpRoom;
  if (!code) return;
  const link = `${location.origin}${location.pathname}?room=${code}`;
  void navigator.clipboard?.writeText(link).then(
    () => ($("btn-invite-p").textContent = "LINK COPIED ✓"),
    () => ($("btn-invite-p").textContent = link),
  );
  setTimeout(() => ($("btn-invite-p").textContent = "COPY INVITE LINK"), 2500);
});
function startMp(room: string) {
  const name = $<HTMLInputElement>("mp-name").value.trim().slice(0, 16) || "OPERATOR";
  const url = $<HTMLInputElement>("mp-url").value.trim() || mpDefaultUrl();
  store.set("mpName", name);
  store.set("mpRoom", room);
  store.set("mpUrl", url === mpDefaultUrl() ? "" : url);
  mpSettings = { url, room, name };
  $("btn-invite-p").classList.remove("hidden");
  stage = "nightshift";
  show("mp", false);
  goFullscreen();
  void deploy();
}
const roomCode = () => Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ"[(Math.random() * 24) | 0]).join("");
$("btn-mp-join").addEventListener("click", () => {
  const room = $<HTMLInputElement>("mp-room").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!room) {
    $("mp-note").textContent = "Type the room code your friend gave you — or CREATE ROOM to make one.";
    return;
  }
  startMp(room);
});
$("btn-mp-create").addEventListener("click", () => startMp(roomCode()));
$("btn-mp-quick").addEventListener("click", () => startMp(""));

// ------------------------------------------------------------------ in-game flow
function fmtStats(s: RoundStats) {
  const t = Math.floor(s.time);
  return [
    `TIME        ${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`,
    `DIFFICULTY  ${DIFFICULTY[difficulty.id].label}`,
    `HOSTILES    ${s.kills} / ${s.total}`,
    `HEADSHOTS   ${s.headshots}`,
    `ACCURACY    ${(s.accuracy * 100).toFixed(0)}%`,
    `DMG TAKEN   ${Math.round(s.damageTaken)}`,
  ].join("\n");
}

function onState(state: GameState, stats?: RoundStats) {
  const info = stageInfo(stage);
  show("pause", state === "paused");
  // the pause menu and the result screens have the menu music (the game is silent behind them)
  menuMusic.setActive(state === "paused" || state === "dead" || state === "won");
  show("result", state === "dead" || state === "won");
  if (state !== "paused") for (const p of ["settings", "controls", "credits"]) show(p, false);
  if (state !== "playing") touchUi?.reset();
  document.body.classList.toggle("ingame", state === "playing");
  // loading finished: straight into the stage (no "click to engage" screen)
  if (state === "ready") void autoStart();
  if (state === "playing") show("engage", false);
  updateAimHint();
  const next = nextStage();
  show("btn-next", state === "won" && next !== null);
  $("btn-restart").classList.toggle("primary", !(state === "won" && next !== null));
  // died past a mission checkpoint: back to it (or the whole mission again)
  const cp = state === "dead" ? game?.checkpoint ?? null : null;
  $("btn-restart").textContent = cp ? `RETRY FROM ${cp}` : "RESTART";
  show("btn-restart-full", !!cp);
  if (next) $("btn-next").textContent = `NEXT STAGE · ${stageInfo(next).name} ▸`;
  if (state === "dead" || state === "won") {
    game?.input.exitLock();
    $("result-title").textContent = stats?.title ?? (state === "won" ? "SECTOR CLEARED" : "MISSION FAILED");
    // completion is remembered (stage select marks it)
    if (state === "won") store.set("cleared_" + stage, "1");
    $("result-title").style.color = state === "won" ? "var(--teal)" : "var(--blood)";
    $("result-kicker").textContent = stats?.kicker ?? (state === "won" ? `${info.name} // SECURED` : `${info.name} // OPERATOR DOWN`);
    if (stats) $("result-stats").textContent = fmtStats(stats);
  }
}

const TIPS = [
  "Peek around a corner with lean — only your head and gun are exposed.",
  "Prone is the smallest target and the steadiest aim. Crawl to stay hidden.",
  "The combat knife kills instantly from behind.",
  "Rockets hit hard over a wide area — keep your distance from the impact.",
  "Health slowly comes back if you avoid taking hits for a few seconds.",
];

/** the stage after the current one (in menu order), or null after the last */
function nextStage(): StageId | null {
  const i = STAGES.findIndex((s) => s.id === stage);
  return i >= 0 && i + 1 < STAGES.length ? STAGES[i + 1].id : null;
}

/**
 * Start the stage the moment loading ends. Pointer lock needs a user gesture: if the click that
 * launched the mission is still "fresh" the lock is taken now, otherwise the first click in the
 * game takes it (that click never fires the weapon — input ignores buttons until locked).
 */
/** until when a lock failure belongs to the automatic attempt (the error event can arrive late) */
let autoLockUntil = 0;
async function autoStart() {
  const g = game;
  if (!g || g.state !== "ready") return;
  g.begin();
  // (touch: nothing to capture — the on-screen controls are live at once)
  if (touch) {
    g.input.locked = true;
    return;
  }
  const act = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (act && !act.isActive) return;
  autoLockUntil = performance.now() + 1500;
  await g.input.requestLock();
}
function updateAimHint() {
  const g = game;
  show("aim-hint", !!g && g.state === "playing" && !g.input.locked && !lockFallback);
}
// the first click while playing without the mouse captured: capture it (and wake the audio)
document.addEventListener(
  "mousedown",
  () => {
    const g = game;
    if (!g || g.state !== "playing" || g.input.locked || lockFallback) return;
    g.audio.resume();
    void g.input.requestLock();
  },
  true,
);

/** the loading video: behind a loading screen only while it's loading — played from the start, stopped after */
function loadVideo(screen: string, on: boolean) {
  const v = document.querySelector<HTMLVideoElement>(`#${screen} .load-video`);
  if (!v) return;
  if (on) {
    v.classList.remove("done");
    v.currentTime = 0;
    void v.play().catch(() => undefined);
  } else {
    v.pause();
    v.classList.add("done");
  }
}
async function deploy() {
  if (game) return;
  menuMusic.stop();
  const info = stageInfo(stage);
  show("stages", false);
  show("menu", false);
  show("loading", true);
  loadVideo("loading", true);
  $("load-kicker").textContent = `INSERTING // ${info.name} · ${DIFFICULTY[difficulty.id].label}`;
  $("load-title").textContent = info.name;
  $("load-tips").textContent = TIPS[(Math.random() * TIPS.length) | 0];
  $("engage-kicker").textContent = `${info.name} // READY`;
  $("obj-text").textContent = info.objective;
  const fill = $("load-fill");
  const step = $("load-step");
  const { Game } = await prefetchEngine();
  const g = new Game(
    $<HTMLCanvasElement>("game"),
    {
      stage,
      quality: prefs.quality,
      sensitivity: prefs.sens,
      fov: prefs.fov,
      volume: prefs.volume,
      ambience: prefs.ambience,
      music: prefs.music,
      muted: toggles.muted.value,
      devMode: toggles.devMode.value,
      // (touch: AIM is a toggle button)
      aimToggle: touch || toggles.aimToggle.value,
      mp: mpSettings ?? undefined,
    },
    {
      onStateChange: onState,
      onSettingChange: (k, v) => {
        // (H / L in play: the CONTROLS switches follow)
        if (k === "god" || k === "arsenal") {
          devOpts[k] = v;
          syncDevSwitches();
        } else syncToggle(k as ToggleKey, v);
      },
    },
  );
  game = g;
  if (touch) {
    g.input.touchMode = true;
    touchUi = new TouchControls(g.input, { scale: prefs.touchScale, onPause: () => g.pause(), onTouch: () => g.audio.resume() });
  }
  g.input.onLockChange = (locked) => {
    updateAimHint();
    if (locked) {
      g.audio.resume();
      lockWorked = true;
      lockFallback = false;
      $("resume-note").textContent = "";
      if (g.state === "ready") g.begin();
      else if (g.state === "paused") g.resume();
    } else if (g.state === "playing" && !lockFallback) g.pause();
  };
  g.input.onLockError = () => {
    // the automatic attempt after loading had no click behind it: wait for the first click
    if (performance.now() < autoLockUntil && !lockWorked) {
      g.input.locked = false;
      updateAimHint();
      return;
    }
    if (lockWorked) {
      // Pointer lock worked before: the browser refuses a re-lock for a moment after you leave
      // (Esc, Alt+Tab, another window). Stay paused and ask for one more click — never drop into
      // the cursor-bound fallback, which can't turn a full 360°.
      g.input.locked = false;
      $("resume-note").textContent = "Click RESUME again to take back control.";
      return;
    }
    // Embedded contexts (sandboxed iframes) that never allow pointer lock — degrade gracefully.
    lockFallback = true;
    $("engage-note").textContent = "Pointer lock is blocked here — mouse-look works while the cursor stays in the window. Open in a full browser tab for proper FPS controls.";
    g.input.locked = true;
    updateAimHint();
    if (g.state === "ready") g.begin();
    else if (g.state === "paused") g.resume();
  };
  // leaving the tab / window: pause, drop held keys, and fix the canvas size on return
  const leave = () => {
    if (quick) return; // dev quick mode drives the game from scripts in a background pane
    g.input.clearAll();
    if (g.state === "playing") {
      g.pause();
      g.input.exitLock();
    }
  };
  window.addEventListener("blur", leave);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) leave();
    else g.engine?.resize();
  });
  window.addEventListener("focus", () => g.engine?.resize());
  try {
    const times: [string, number][] = [];
    (window as unknown as Record<string, unknown>).__loadTimes = times;
    const t0 = performance.now();
    const pct = $("load-pct");
    let shown = 0;
    await g.load((p, label) => {
      // never step backwards (sub-steps report their own progress)
      shown = Math.max(shown, Math.round(p * 100));
      fill.style.width = `${shown}%`;
      pct.textContent = `${shown}%`;
      step.textContent = label;
      if (!times.length || times[times.length - 1][0] !== label) times.push([label, Math.round(performance.now() - t0)]);
    });
    times.push(["done", Math.round(performance.now() - t0)]);
    // developer switches set in CONTROLS before deploying
    if (toggles.devMode.value) {
      g.setGod(devOpts.god);
      g.setArsenal(devOpts.arsenal);
    }
  } catch (err) {
    step.textContent = "Failed to start: " + (err instanceof Error ? err.message : String(err));
    console.error(err);
    return;
  }
  show("loading", false);
  loadVideo("loading", false);
  if (import.meta.env.DEV || new URLSearchParams(location.search).has("autotest")) {
    (window as unknown as Record<string, unknown>).__saltline = g;
  }
  if (quick) installDevHelpers(g);
}

// the FULL SCREEN buttons (menu, pause): in and out, whatever the setting; their label follows
function toggleFullscreen() {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  const d = document as Document & { webkitExitFullscreen?: () => void; webkitFullscreenElement?: Element };
  try {
    if (document.fullscreenElement || d.webkitFullscreenElement) void (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: "hide" }).catch(() => undefined);
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here */
  }
}
const syncFsButtons = () => {
  const on = !!document.fullscreenElement;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".fs-btn")) b.textContent = on ? "EXIT FULL SCREEN" : "FULL SCREEN";
};
for (const id of ["btn-fullscreen", "btn-fullscreen-p"]) $(id).addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", syncFsButtons);
syncFsButtons();

$("btn-deploy").addEventListener("click", () => {
  goFullscreen();
  void deploy();
});
// touch: turned to portrait mid-fight — pause (the "turn your device" card shows over the game)
matchMedia("(orientation: portrait)").addEventListener("change", (e) => {
  if (touch && e.matches && game?.state === "playing") game.pause();
});
// Without pointer lock the browser doesn't exit on ESC for us — handle pause manually.
window.addEventListener("keydown", (e) => {
  if (!game || e.code !== "Escape" || capture) return;
  const panelOpen = ["settings", "controls", "credits"].some((p) => !$(p).classList.contains("hidden"));
  if (panelOpen) {
    closePanels();
    return;
  }
  if (!lockFallback) return;
  if (game.state === "playing") game.pause();
  else if (game.state === "paused") game.resume();
});
$("engage").addEventListener("click", () => {
  if (!game) return;
  game.audio.resume();
  if (lockFallback) {
    game.input.locked = true;
    game.begin();
  } else void game.input.requestLock();
});
$("btn-resume").addEventListener("click", () => {
  if (!game) return;
  goFullscreen();
  if (lockFallback) game.resume();
  else void game.input.requestLock();
});
const restart = (fromCheckpoint = false) => {
  if (!game) return;
  game.restart(fromCheckpoint);
  if (!lockFallback) {
    game.pause();
    void game.input.requestLock();
  }
};
$("btn-restart").addEventListener("click", () => restart(game?.state === "dead" && !!game.checkpoint));
$("btn-restart-full").addEventListener("click", () => restart());
// the engine is built once per stage: reload and deploy the next stage straight away
$("btn-next").addEventListener("click", () => {
  const next = nextStage();
  if (!next) return;
  store.set("stage", next);
  session.set("autodeploy", next);
  location.reload();
});
$("btn-restart-p").addEventListener("click", () => restart());
$("btn-settings-p").addEventListener("click", () => openPanel("settings", "pause"));
$("btn-controls-p").addEventListener("click", () => openPanel("controls", "pause"));
const toMainMenu = () => {
  session.set("skipSplash", "1");
  location.reload();
};
$("btn-mainmenu").addEventListener("click", toMainMenu);
$("btn-mainmenu-p").addEventListener("click", toMainMenu);

/**
 * Dev-only test helpers for ?quick: start without pointer lock, and a window.T toolbox that
 * freezes game time while rendering continues (so screenshots show an exact frame).
 */
function installDevHelpers(g: Game) {
  g.input.locked = true;
  g.begin();
  const w = window as unknown as Record<string, unknown>;
  // test-only access to the game's internals
  const dev = () => g as unknown as { player: { camera: import("@babylonjs/core/Cameras/camera").Camera; reset(p: Vector3, yaw: number): void }; level: import("./level/KestrelPoint").LevelData };
  w.TS = 1;
  Object.defineProperty(g.dev, "timeScale", { get: () => w.TS as number, configurable: true });
  const tap = (code: string) => {
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
    window.dispatchEvent(new KeyboardEvent("keyup", { code }));
  };
  w.T = {
    g,
    /** load every roster model in a row in front of `at` and report rig / height / clips */
    /** Babylon's own counters over `frames` rendered frames: where the render time goes */
    instr: async (frames = 60) => {
      const { SceneInstrumentation } = await import("@babylonjs/core/Instrumentation/sceneInstrumentation");
      const sc = (g as unknown as { scene: import("@babylonjs/core/scene").Scene }).scene;
      const si = new SceneInstrumentation(sc);
      si.captureActiveMeshesEvaluationTime = si.captureRenderTargetsRenderTime = si.captureRenderTime = si.captureFrameTime = si.captureCameraRenderTime = true;
      for (let i = 0; i < frames; i++) sc.render();
      const r = {
        frame: si.frameTimeCounter.average, render: si.renderTimeCounter.average, eval: si.activeMeshesEvaluationTimeCounter.average,
        rtt: si.renderTargetsRenderTimeCounter.average, camera: si.cameraRenderTimeCounter.average, draws: si.drawCallsCounter.average,
      };
      si.dispose();
      return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +(+v).toFixed(2)]));
    },
    roster: async (x = 0, y = 0, z = 0, stance = true) => {
      const { auditRoster } = await import("./characters/rosterAudit");
      const r = await auditRoster((g as unknown as { scene: import("@babylonjs/core/scene").Scene }).scene, new Vector3(x, y, z), 3.2, stance);
      (w as Record<string, unknown>).ROSTER_RIGS = r.rigs;
      return r.rows;
    },
    api: g.debugApi,
    tap,
    key: (code: string, down: boolean) => window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { code })),
    click: (button = 0) => {
      document.dispatchEvent(new MouseEvent("mousedown", { button }));
      document.dispatchEvent(new MouseEvent("mouseup", { button }));
    },
    freeze: () => (w.TS = 0),
    run: () => (w.TS = 1),
    /** advance n fixed 60 Hz steps (works while frozen) */
    step: (n: number) => {
      const prev = w.TS;
      w.TS = 1;
      for (let i = 0; i < n; i++) {
        g.scene.incrementRenderId();
        g.step(1 / 60);
        g.input.endFrame();
      }
      w.TS = prev;
    },
    /** look from a free camera at (x,y,z) towards (tx,ty,tz); T.back() returns to the player's eyes */
    fly: (x: number, y: number, z: number, tx: number, ty: number, tz: number, fov = 1.0) => {
      const pc = dev().player.camera;
      if (!w.FC) {
        const fc = new UniversalCamera("devFly", new Vector3(x, y, z), g.scene);
        fc.minZ = 0.05;
        fc.maxZ = 3000;
        w.FC = fc;
      }
      const fc = w.FC as UniversalCamera;
      fc.fov = fov;
      fc.position.set(x, y, z);
      fc.setTarget(new Vector3(tx, ty, tz));
      g.scene.activeCamera = fc;
      void pc;
    },
    back: () => (g.scene.activeCamera = dev().player.camera),
    /** put the player on the nav node nearest (x, z), facing yaw (god mode on) */
    go: (x: number, z: number, yaw = 0) => {
      const d = dev();
      g.scene.activeCamera = d.player.camera;
      let best = d.level.nav.nodes[0], bd = Infinity;
      for (const n of d.level.nav.nodes) {
        const q = (n.p.x - x) ** 2 + (n.p.z - z) ** 2;
        if (q < bd) (bd = q), (best = n);
      }
      d.player.reset(best.p.clone(), yaw);
      g.dev.god = true;
      return best.p;
    },
  };
}

// ------------------------------------------------------------------ boot
const quick = import.meta.env.DEV ? new URLSearchParams(location.search).get("quick") : null;
if (quick) {
  // dev: ?quick=<stage> skips the title and menus and deploys straight away
  show("splash", false);
  engineReady = splashDone = true;
  stage = asStage(quick);
  // (dev: ?quick=nightshift&mp=ROOM&name=X — straight into an online room)
  const q = new URLSearchParams(location.search);
  if (q.has("mp")) mpSettings = { url: q.get("mpurl") ?? mpDefaultUrl(), room: (q.get("mp") ?? "").toUpperCase(), name: q.get("name") ?? "DEV" };
  void deploy();
} else if (session.get("autodeploy")) {
  // "NEXT STAGE" from the result screen
  const next = session.get("autodeploy");
  session.set("autodeploy", null);
  show("splash", false);
  engineReady = splashDone = true;
  stage = asStage(next);
  void deploy();
} else if (session.get("skipSplash")) {
  session.set("skipSplash", null);
  show("splash", false);
  void prefetchEngine();
  engineReady = splashDone = true;
  goMenu();
} else runSplash();
