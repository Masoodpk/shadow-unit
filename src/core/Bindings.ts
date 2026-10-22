/**
 * Rebindable controls. Gameplay never reads a raw key: it asks for an action
 * (`forward`, `fire`, `prone`…), and each action maps to up to two codes.
 * Codes are `KeyboardEvent.code` strings plus mouse pseudo-codes
 * (`Mouse0` left, `Mouse1` middle, `Mouse2` right, `Mouse3`/`Mouse4` side buttons).
 * Saved to localStorage, versioned so a future layout change can migrate.
 */

export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "sprint"
  | "jump"
  | "crouch"
  | "prone"
  | "leanLeft"
  | "leanRight"
  | "fire"
  | "aim"
  | "reload"
  | "melee"
  | "knife"
  | "grenade"
  | "grenadeType"
  | "lastWeapon"
  | "use"
  | "weapon1"
  | "weapon2"
  | "weapon3"
  | "weapon4"
  | "weapon5"
  | "weapon6"
  | "weapon7"
  | "sound"
  | "map"
  | "allHeroes"
  | "allVillains"
  | "godMode"
  | "arsenal";

export interface ActionDef {
  id: Action;
  label: string;
  group: "MOVEMENT" | "COMBAT" | "WEAPONS" | "OTHER" | "DEVELOPER (only while developer mode is on)";
  defaults: string[];
}

export const ACTIONS: ActionDef[] = [
  { id: "forward", label: "Move forward", group: "MOVEMENT", defaults: ["KeyW", "ArrowUp"] },
  { id: "back", label: "Move back", group: "MOVEMENT", defaults: ["KeyS", "ArrowDown"] },
  { id: "left", label: "Strafe left", group: "MOVEMENT", defaults: ["KeyA", "ArrowLeft"] },
  { id: "right", label: "Strafe right", group: "MOVEMENT", defaults: ["KeyD", "ArrowRight"] },
  { id: "sprint", label: "Sprint", group: "MOVEMENT", defaults: ["ShiftLeft", "ShiftRight"] },
  { id: "jump", label: "Jump / stand up", group: "MOVEMENT", defaults: ["Space"] },
  { id: "crouch", label: "Crouch (toggle)", group: "MOVEMENT", defaults: ["KeyC"] },
  { id: "prone", label: "Prone / crawl (toggle)", group: "MOVEMENT", defaults: ["KeyZ"] },
  { id: "leanLeft", label: "Peek left (lean)", group: "MOVEMENT", defaults: ["KeyQ"] },
  { id: "leanRight", label: "Peek right (lean)", group: "MOVEMENT", defaults: ["KeyE"] },
  { id: "use", label: "Use (doors, defuse)", group: "MOVEMENT", defaults: ["KeyF"] },
  { id: "fire", label: "Fire / stab", group: "COMBAT", defaults: ["Mouse0"] },
  { id: "aim", label: "Aim down sights", group: "COMBAT", defaults: ["Mouse2", "KeyT"] },
  { id: "reload", label: "Reload", group: "COMBAT", defaults: ["KeyR"] },
  { id: "melee", label: "Melee / quick strike", group: "COMBAT", defaults: ["KeyV", "Mouse1"] },
  { id: "knife", label: "Quick knife (any time, mid-reload too)", group: "COMBAT", defaults: ["KeyK"] },
  { id: "grenade", label: "Throw grenade", group: "COMBAT", defaults: ["KeyG"] },
  { id: "grenadeType", label: "Next grenade type", group: "COMBAT", defaults: ["KeyB"] },
  { id: "lastWeapon", label: "Last weapon", group: "WEAPONS", defaults: ["KeyX"] },
  { id: "weapon1", label: "Assault rifle", group: "WEAPONS", defaults: ["Digit1"] },
  { id: "weapon2", label: "SMG", group: "WEAPONS", defaults: ["Digit2"] },
  { id: "weapon3", label: "Sniper rifle", group: "WEAPONS", defaults: ["Digit3"] },
  { id: "weapon4", label: "Pistol", group: "WEAPONS", defaults: ["Digit4"] },
  { id: "weapon5", label: "Rocket launcher", group: "WEAPONS", defaults: ["Digit5"] },
  { id: "weapon6", label: "Combat knife", group: "WEAPONS", defaults: ["Digit6"] },
  { id: "weapon7", label: "Grenades", group: "WEAPONS", defaults: ["Digit7"] },
  { id: "sound", label: "Sound on / off", group: "OTHER", defaults: ["KeyM"] },
  { id: "map", label: "Full map (toggle)", group: "OTHER", defaults: ["KeyN"] },
  { id: "allHeroes", label: "Heroes Playground: every hero in now", group: "OTHER", defaults: ["KeyJ"] },
  { id: "allVillains", label: "Heroes Playground: every villain in now", group: "OTHER", defaults: ["KeyO"] },
  { id: "godMode", label: "God mode on / off", group: "DEVELOPER (only while developer mode is on)", defaults: ["KeyH"] },
  { id: "arsenal", label: "All weapons on / off", group: "DEVELOPER (only while developer mode is on)", defaults: ["KeyL"] },
];

/** Keys that can never be bound (pause, dev mode, perf overlay, OS/browser shortcuts). */
export const RESERVED = new Set(["Escape", "Backquote", "F3", "MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "Tab", "F5", "F11", "F12"]);

const STORE_KEY = "saltline.binds";
const VERSION = 5;

export class Bindings {
  private map = new Map<Action, string[]>();
  /** code → actions using it (rebuilt on change) */
  private byCode = new Map<string, Action[]>();
  onChange?: () => void;

  constructor() {
    this.resetDefaults(false);
    this.load();
  }

  codes(a: Action): string[] {
    return this.map.get(a) ?? [];
  }
  actionsFor(code: string): Action[] {
    return this.byCode.get(code) ?? [];
  }
  has(a: Action, code: string) {
    return this.codes(a).includes(code);
  }

  /**
   * Bind `code` to slot `slot` (0 primary, 1 secondary) of action `a`.
   * A code can only drive one action: if another action had it, that slot is cleared
   * and returned so the UI can say what moved.
   */
  set(a: Action, slot: number, code: string): Action | null {
    let stolen: Action | null = null;
    for (const [other, list] of this.map) {
      const i = list.indexOf(code);
      if (i >= 0 && !(other === a && i === slot)) {
        list.splice(i, 1);
        if (other !== a) stolen = other;
      }
    }
    const list = [...this.codes(a)];
    if (slot < list.length) list[slot] = code;
    else list.push(code);
    this.map.set(a, list.slice(0, 2));
    this.rebuild();
    this.save();
    return stolen;
  }

  clear(a: Action, slot: number) {
    const list = [...this.codes(a)];
    list.splice(slot, 1);
    this.map.set(a, list);
    this.rebuild();
    this.save();
  }

  resetDefaults(save = true) {
    this.map.clear();
    for (const d of ACTIONS) this.map.set(d.id, [...d.defaults]);
    this.rebuild();
    if (save) this.save();
  }

  /** touch screen: prompts name the on-screen button instead of a key */
  touchLabels: Partial<Record<Action, string>> | null = null;

  /** first bound key, formatted for prompts ("R", "LMB") */
  label(a: Action) {
    const t = this.touchLabels?.[a];
    if (t) return t;
    const c = this.codes(a)[0];
    return c ? codeLabel(c) : "—";
  }

  private rebuild() {
    this.byCode.clear();
    for (const [a, list] of this.map) {
      for (const c of list) {
        const l = this.byCode.get(c) ?? [];
        l.push(a);
        this.byCode.set(c, l);
      }
    }
    this.onChange?.();
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { v: number; binds: Record<string, string[]> };
      if (!data || typeof data !== "object" || !data.binds) return;
      // v3 moved F from "fire (keyboard)" to the new "use" (doors)
      if ((data.v ?? 0) < 3 && Array.isArray(data.binds.fire)) data.binds.fire = data.binds.fire.filter((c) => c !== "KeyF");
      // v4: number keys pick loadout slots (primary, pistol, launcher, knife, grenades), not one gun each
      // v5: seven slots (assault, SMG, sniper, pistol, launcher, knife, grenades)
      if ((data.v ?? 0) < 5) for (let i = 1; i <= 10; i++) delete data.binds["weapon" + i];
      for (const d of ACTIONS) {
        const saved = data.binds[d.id];
        if (Array.isArray(saved)) this.map.set(d.id, saved.filter((c) => typeof c === "string" && !RESERVED.has(c)).slice(0, 2));
      }
      // actions added since the save: their defaults, unless the player already uses that key
      const used = new Set<string>();
      for (const d of ACTIONS) if (Array.isArray(data.binds[d.id])) for (const c of this.map.get(d.id)!) used.add(c);
      for (const d of ACTIONS) if (!Array.isArray(data.binds[d.id])) this.map.set(d.id, d.defaults.filter((c) => !used.has(c)));
      this.rebuild();
    } catch {
      /* storage unavailable or corrupt: keep defaults */
    }
  }

  private save() {
    try {
      const binds: Record<string, string[]> = {};
      for (const [a, l] of this.map) binds[a] = l;
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: VERSION, binds }));
    } catch {
      /* storage unavailable */
    }
  }
}

const NAMED: Record<string, string> = {
  Mouse0: "LMB",
  Mouse1: "MMB",
  Mouse2: "RMB",
  Mouse3: "MOUSE 4",
  Mouse4: "MOUSE 5",
  Space: "SPACE",
  ShiftLeft: "L-SHIFT",
  ShiftRight: "R-SHIFT",
  AltLeft: "L-ALT",
  AltRight: "R-ALT",
  CapsLock: "CAPS",
  Enter: "ENTER",
  Backspace: "BKSP",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Backslash: "\\",
};

export function codeLabel(code: string) {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "NUM " + code.slice(6);
  return code.toUpperCase();
}

/** one shared instance: the menu edits it, the game reads it */
export const bindings = new Bindings();
