import type { AudioEngine } from "./AudioEngine";

export type BarkEvent = "contact" | "grenade" | "reload" | "manDown" | "flankL" | "flankR" | "search" | "suppress" | "hit" | "alarm";

/** what soldiers shout — the moment-to-moment chatter of a firefight */
const LINES: Record<BarkEvent, string[]> = {
  contact: ["Contact! Contact!", "Enemy spotted!", "There he is!", "Hostile, over there!", "Intruder! Open fire!"],
  grenade: ["Grenade out!", "Frag out!", "Fire in the hole!"],
  reload: ["Reloading!", "Changing mag, cover me!", "I'm out! Reloading!"],
  manDown: ["Man down!", "They got him!", "We lost one!", "He's dead! Watch out!"],
  flankL: ["Flanking left!", "Moving left!", "I'll go around the left!"],
  flankR: ["Flanking right!", "Moving right!", "Going around the right!"],
  search: ["Where'd he go?", "Lost visual!", "Spread out, find him!", "Check the corners!"],
  suppress: ["Covering fire!", "Keep his head down!", "Suppressing!"],
  hit: ["I'm hit!", "Agh! I'm hit!", "Medic!"],
  alarm: ["All units, intruder in the base!", "We've got an intruder, sweep the area!", "Base under attack, move!"],
};

/** how far a shout carries (m) */
const RANGE = 38;

/**
 * Enemy voice lines, Call of Duty style: short shouts when they spot you, throw a grenade, reload,
 * lose a man, move round your flank or lose sight of you. Each soldier has his own voice (pitch,
 * speed) and the shout fades with distance; a caption shows what was said.
 *
 * Recorded lines win: put `public/sfx/vo/manifest.json` (e.g. `{"contact": 3, "grenade": 2}`) and
 * the files `public/sfx/vo/contact_1.mp3` … next to it and those are played (positional, in the game
 * mix). Without them the browser's own speech voice reads the lines.
 */
export class Barks {
  private last = -99;
  private lastEvent = new Map<BarkEvent, number>();
  private lastSoldier = new Map<number, number>();
  private recorded: Partial<Record<BarkEvent, number>> = {};
  private voices: SpeechSynthesisVoice[] = [];
  private caption: HTMLElement | null;
  private captionT = 0;
  enabled = true;
  muted = false;
  volume = 1;

  constructor(private audio: AudioEngine) {
    this.caption = document.getElementById("barks");
    const synth = typeof speechSynthesis !== "undefined" ? speechSynthesis : null;
    const pick = () => {
      const all = synth?.getVoices() ?? [];
      const en = all.filter((v) => /^en/i.test(v.lang));
      // deeper (male) English voices first; any English voice otherwise
      const male = en.filter((v) => /male|daniel|alex|fred|arthur|aaron|guy|david|mark|james|george|ralph|rishi/i.test(v.name) && !/female/i.test(v.name));
      this.voices = male.length ? male : en;
    };
    pick();
    synth?.addEventListener?.("voiceschanged", pick);
    void this.loadRecorded();
  }

  private async loadRecorded() {
    try {
      const base = import.meta.env.BASE_URL + "sfx/vo/";
      const r = await fetch(base + "manifest.json");
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return;
      const m = (await r.json()) as Record<string, number>;
      const names: string[] = [];
      for (const [ev, n] of Object.entries(m)) for (let i = 1; i <= n; i++) names.push(`vo/${ev}_${i}`);
      await this.audio.loadOverrides(names);
      this.recorded = m as Partial<Record<BarkEvent, number>>;
    } catch {
      /* none */
    }
  }

  /**
   * Soldier `who` (index) shouts `ev` from (x, y, z); `dist` = distance to the listener.
   * Rate-limited: one voice at a time across the base, the same kind of line not twice in a row.
   */
  say(who: number, ev: BarkEvent, x: number, y: number, z: number, dist: number, now: number, force = false) {
    if (!this.enabled || this.muted || (dist > RANGE && ev !== "alarm")) return;
    const gap = ev === "alarm" ? 0 : 2.2;
    if (!force && now - this.last < gap) return;
    if (!force && now - (this.lastEvent.get(ev) ?? -99) < (ev === "contact" ? 7 : 9)) return;
    if (!force && now - (this.lastSoldier.get(who) ?? -99) < 5) return;
    this.last = now;
    this.lastEvent.set(ev, now);
    this.lastSoldier.set(who, now);
    const lines = LINES[ev];
    const pickIdx = (Math.random() * lines.length) | 0;
    const radio = ev === "alarm";
    // loud close by, carried over the radio for the alarm call
    const vol = radio ? 0.55 : Math.max(0, Math.min(1, 1.15 - dist / RANGE)) * 0.9;
    const n = this.recorded[ev];
    if (n) {
      const i = 1 + ((Math.random() * n) | 0);
      if (radio) this.audio.play(`vo/${ev}_${i}`, { volume: vol * this.volume });
      else this.audio.play(`vo/${ev}_${i}`, { x, y, z, volume: this.volume });
    } else this.speak(who, lines[pickIdx], vol * this.volume, radio);
    this.show(radio ? "RADIO" : "HOSTILE", n ? "" : lines[pickIdx]);
  }

  private speak(who: number, text: string, vol: number, radio: boolean) {
    if (typeof speechSynthesis === "undefined" || vol < 0.03) return;
    const u = new SpeechSynthesisUtterance(text);
    if (this.voices.length) u.voice = this.voices[who % this.voices.length];
    u.lang = u.voice?.lang ?? "en-US";
    // every soldier sounds a little different; shouting = fast and clipped
    u.pitch = radio ? 0.75 : 0.6 + ((who * 37) % 10) / 22;
    u.rate = 1.12 + ((who * 13) % 7) / 40;
    u.volume = vol;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  private show(who: string, text: string) {
    if (!this.caption || !text) return;
    this.caption.innerHTML = `<b>${who}</b> ${text}`;
    this.caption.classList.add("on");
    this.captionT = 2.6;
  }

  update(dt: number) {
    if (this.captionT > 0) {
      this.captionT -= dt;
      if (this.captionT <= 0) this.caption?.classList.remove("on");
    }
  }

  /** pause / end of round: stop talking */
  silence() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.captionT = 0;
    this.caption?.classList.remove("on");
  }
}
