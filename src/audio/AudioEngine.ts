import { buildSoundBank } from "./SoundBank";

export interface PlayOptions {
  volume?: number;
  /** ± random playback-rate variation (0.05 = ±5%) */
  pitchVar?: number;
  rate?: number;
  /** World position for 3D sounds. Omit for 2D (player-owned) sounds. */
  x?: number;
  y?: number;
  z?: number;
  /** Fraction sent to the reverb bus. */
  reverb?: number;
  delay?: number;
}

/**
 * Thin Web Audio layer. All buffers are synthesised once during loading so
 * the first gunshot never triggers a decode or allocation spike.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  /** everything of the game world (effects, loops, ambience, score) — silenced while paused */
  private world: GainNode;
  private sfx: GainNode;
  private reverbSend: GainNode;
  /** flashbang deafening: everything except the ringing goes through this lowpass */
  private muffle: BiquadFilterNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private active = new Set<AudioBufferSourceNode>();
  private ambience: AudioBufferSourceNode[] = [];
  private lastPlay = new Map<string, number>();

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: "interactive" });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.18;
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.world = this.ctx.createGain();
    this.world.connect(this.master);
    this.sfx = this.ctx.createGain();
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 1;
    const convolver = this.ctx.createConvolver();
    convolver.buffer = this.makeImpulse(1.4, 2.6);
    const revGain = this.ctx.createGain();
    revGain.gain.value = 0.32;
    this.muffle = this.ctx.createBiquadFilter();
    this.muffle.type = "lowpass";
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.muffle.connect(this.world);
    this.reverbSend.connect(convolver).connect(revGain).connect(this.muffle);
    this.sfx.connect(this.muffle);
    this.master.connect(comp).connect(this.ctx.destination);
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = 0;
    }
  }

  async init(onProgress?: (p: number) => void) {
    const bank = await buildSoundBank(this.ctx.sampleRate, onProgress);
    for (const [name, variants] of Object.entries(bank)) {
      this.buffers.set(
        name,
        variants.map((data) => {
          const b = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
          b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          return b;
        }),
      );
    }
  }

  /**
   * Recorded samples packed into one compressed file ("atlas"): each entry is
   * [name, start s, duration s]. Entries sharing a name become random variants
   * and replace any synthesised sound of that name. Failure keeps the synth set.
   */
  async loadAtlas(url: string, table: readonly (readonly [string, number, number])[]) {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const buf = await new Promise<AudioBuffer>((res, rej) => this.ctx.decodeAudioData(data, res, rej));
      const src = buf.getChannelData(0);
      const sr = buf.sampleRate;
      const out = new Map<string, AudioBuffer[]>();
      for (const [name, start, dur] of table) {
        const a = Math.max(0, Math.round(start * sr));
        const n = Math.min(src.length - a, Math.round(dur * sr));
        if (n <= 0) continue;
        const b = this.ctx.createBuffer(1, n, sr);
        b.copyToChannel(src.subarray(a, a + n) as Float32Array<ArrayBuffer>, 0);
        if (!out.has(name)) out.set(name, []);
        out.get(name)!.push(b);
      }
      for (const [name, list] of out) this.buffers.set(name, list);
    } catch (e) {
      console.warn("audio atlas failed, keeping synthesised sounds", e);
    }
  }

  /**
   * Drop-in recordings: public/sfx/<name>.mp3 (or .ogg / .wav) replaces the synthesised sound of that
   * name, e.g. m72Launch, dzjLaunch, rocketBlast. Missing files keep the synthesised version.
   */
  async loadOverrides(names: string[]) {
    await Promise.all(
      names.map(async (name) => {
        for (const ext of ["mp3", "ogg", "wav"]) {
          try {
            const r = await fetch(`${import.meta.env.BASE_URL}sfx/${name}.${ext}`);
            if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("audio")) continue;
            const data = await r.arrayBuffer();
            const buf = await new Promise<AudioBuffer>((res, rej) => this.ctx.decodeAudioData(data, res, rej));
            this.buffers.set(name, [buf]);
            return;
          } catch {
            /* try the next format */
          }
        }
      }),
    );
  }

  /**
   * Recorded variants: public/sfx/<file>-1.wav … <file>-n.wav become the random variants of `name`
   * (e.g. the Hulk's footfalls, cut from one recording). Missing files are skipped.
   */
  async loadVariants(name: string, file: string, n: number) {
    const list = await Promise.all(
      Array.from({ length: n }, async (_, i) => {
        try {
          const r = await fetch(`${import.meta.env.BASE_URL}sfx/${file}-${i + 1}.wav`);
          if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("audio")) return null;
          const data = await r.arrayBuffer();
          return await new Promise<AudioBuffer>((res, rej) => this.ctx.decodeAudioData(data, res, rej));
        } catch {
          return null;
        }
      }),
    );
    const ok = list.filter((b): b is AudioBuffer => !!b);
    if (ok.length) this.buffers.set(name, ok);
  }

  private _muted = false;
  get muted() {
    return this._muted;
  }
  /** Master mute with a short ramp so toggling never clicks. */
  /** master volume 0..1 (settings) */
  volume = 1;
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.setMuted(this._muted);
  }
  /** ambience loop volume 0..1 (settings) */
  private ambienceGain: GainNode | null = null;
  ambienceLevel = 1;
  setAmbienceLevel(v: number) {
    this.ambienceLevel = Math.max(0, Math.min(1, v));
    this.applyAmbience();
  }
  /** ambience only plays while actually in the game — silent in pause / results; music ducks */
  private ambienceActive = false;
  setAmbienceActive(on: boolean) {
    this.ambienceActive = on;
    this.applyAmbience();
    this.applyMusic();
  }

  // ---------------------------------------------------------------- music
  private musicGain: GainNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicBuf: AudioBuffer | null = null;
  /** music volume 0..1 (settings) */
  musicLevel = 0.6;
  setMusicLevel(v: number) {
    this.musicLevel = Math.max(0, Math.min(1, v));
    this.applyMusic();
  }
  private applyMusic() {
    if (!this.musicGain) return;
    const k = this.ambienceActive ? 1 : 0.3;
    this.musicGain.gain.setTargetAtTime(0.55 * this.musicLevel * k, this.ctx.currentTime, 0.4);
  }
  /** prepare a stereo score (rendered by the caller, e.g. composeOfficeTheme) */
  setMusic(channels: [Float32Array, Float32Array]) {
    const b = this.ctx.createBuffer(2, channels[0].length, this.ctx.sampleRate);
    b.copyToChannel(channels[0] as Float32Array<ArrayBuffer>, 0);
    b.copyToChannel(channels[1] as Float32Array<ArrayBuffer>, 1);
    this.musicBuf = b;
  }
  /** a decoded track (the player's own file) instead of the procedural score */
  async setMusicFile(data: ArrayBuffer) {
    this.musicBuf = await new Promise<AudioBuffer>((res, rej) => this.ctx.decodeAudioData(data, res, rej));
  }
  startMusic() {
    if (!this.musicBuf || this.musicSrc) return;
    if (!this.musicGain) {
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0;
      this.musicGain.connect(this.world);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = this.musicBuf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSrc = src;
    this.applyMusic();
  }
  private applyAmbience() {
    if (this.ambienceGain) this.ambienceGain.gain.setTargetAtTime(this.ambienceActive ? this.ambienceLevel : 0, this.ctx.currentTime, 0.25);
  }

  /**
   * Paused: the whole game world falls silent — gunfire tails, the alarm, fires, wind, the score —
   * and comes back where it was on resume (voices keep running underneath, so nothing restarts).
   */
  setPaused(on: boolean, fade = 0.05) {
    const t = this.ctx.currentTime;
    this.world.gain.cancelScheduledValues(t);
    this.world.gain.setTargetAtTime(on ? 0 : 1, t, on ? fade : 0.2);
  }

  setMuted(on: boolean) {
    this._muted = on;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0 : 0.85 * this.volume, t, 0.015);
  }

  private ring: { osc: OscillatorNode; g: GainNode } | null = null;
  /**
   * Flashbang ear damage: the world goes dull (lowpass sweeps down, then
   * recovers) under a high tinnitus whine. amount 0..1, seconds = recovery.
   */
  deafen(amount: number, seconds: number) {
    const t = this.ctx.currentTime;
    const f = this.muffle.frequency;
    f.cancelScheduledValues(t);
    if (amount <= 0) {
      f.setValueAtTime(20000, t);
      if (this.ring) {
        this.ring.g.gain.cancelScheduledValues(t);
        this.ring.g.gain.setValueAtTime(0, t);
      }
      return;
    }
    const low = 20000 * Math.pow(380 / 20000, Math.min(1, amount));
    f.setValueAtTime(Math.min(f.value, 20000), t);
    f.exponentialRampToValueAtTime(low, t + 0.03);
    f.setValueAtTime(low, t + seconds * 0.45);
    f.exponentialRampToValueAtTime(20000, t + seconds);
    if (this.ctx.state !== "running") return;
    if (!this.ring) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 3650;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(g).connect(this.world);
      osc.start();
      this.ring = { osc, g };
    }
    const g = this.ring.g.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.09 * amount, t + 0.05);
    g.setValueAtTime(0.09 * amount, t + seconds * 0.35);
    g.exponentialRampToValueAtTime(0.0001, t + seconds * 1.1);
    this.ring.osc.frequency.setValueAtTime(3650 + Math.random() * 300, t);
  }

  resume() {
    if (this.ctx.state !== "running") void this.ctx.resume();
  }

  /** where the listener is (the player's head), for Doppler */
  readonly listenerPos = { x: 0, y: 0, z: 0 };
  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number) {
    this.listenerPos.x = px;
    this.listenerPos.y = py;
    this.listenerPos.z = pz;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(px, t);
      l.positionY.setValueAtTime(py, t);
      l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(px, py, pz);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Rate-limit a named sound (e.g. impact spam from 9 shotgun pellets). */
  canPlay(key: string, minInterval: number) {
    const now = this.ctx.currentTime;
    const last = this.lastPlay.get(key) ?? -1;
    if (now - last < minInterval) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  play(name: string, o: PlayOptions = {}) {
    const variants = this.buffers.get(name);
    if (!variants || this.ctx.state !== "running") return;
    const buf = variants[(Math.random() * variants.length) | 0];
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const pv = o.pitchVar ?? 0.04;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * pv);
    const g = this.ctx.createGain();
    g.gain.value = (o.volume ?? 1) * (1 + (Math.random() * 2 - 1) * 0.06);
    let out: AudioNode = g;
    src.connect(g);
    if (o.x !== undefined) {
      const p = this.ctx.createPanner();
      p.panningModel = "equalpower";
      p.distanceModel = "inverse";
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 200;
      p.positionX.value = o.x;
      p.positionY.value = o.y ?? 0;
      p.positionZ.value = o.z ?? 0;
      g.connect(p);
      out = p;
    }
    out.connect(this.sfx);
    if (o.reverb) {
      const s = this.ctx.createGain();
      s.gain.value = o.reverb;
      out.connect(s).connect(this.reverbSend);
    }
    src.start(this.ctx.currentTime + (o.delay ?? 0));
    this.active.add(src);
    src.onended = () => this.active.delete(src);
  }

  /** Looping 3D (or 2D) voice — fire, plasma hum. Returns a handle to move / stop it. */
  playLoop(name: string, o: PlayOptions = {}) {
    const buf = this.buffers.get(name)?.[0];
    const dead = { stop() {}, setPosition() {}, setRate() {}, setVolume() {} };
    if (!buf || this.ctx.state !== "running") return dead as { stop(fade?: number): void; setPosition(x: number, y: number, z: number): void; setRate(r: number): void; setVolume(v: number): void };
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(o.volume ?? 1, t + 0.15);
    src.connect(g);
    let p: PannerNode | null = null;
    let out: AudioNode = g;
    if (o.x !== undefined) {
      p = this.ctx.createPanner();
      p.panningModel = "equalpower";
      p.distanceModel = "inverse";
      p.refDistance = 3;
      p.rolloffFactor = 1.1;
      p.maxDistance = 200;
      p.positionX.value = o.x;
      p.positionY.value = o.y ?? 0;
      p.positionZ.value = o.z ?? 0;
      g.connect(p);
      out = p;
    }
    out.connect(this.sfx);
    if (o.reverb) {
      const r = this.ctx.createGain();
      r.gain.value = o.reverb;
      out.connect(r).connect(this.reverbSend);
    }
    src.start(t, Math.random() * buf.duration);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
    return {
      stop: (fade = 0.3) => {
        const now = this.ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + Math.max(0.01, fade));
        try {
          src.stop(now + Math.max(0.01, fade) + 0.02);
        } catch {
          /* stopped */
        }
      },
      /** loudness (a thruster opening up) */
      setVolume: (v: number) => {
        g.gain.setTargetAtTime(Math.max(0, v), this.ctx.currentTime, 0.06);
      },
      /** playback rate (Doppler shift) */
      setRate: (rate: number) => {
        src.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.03);
      },
      setPosition: (x: number, y: number, z: number) => {
        if (!p) return;
        const now = this.ctx.currentTime;
        p.positionX.setValueAtTime(x, now);
        p.positionY.setValueAtTime(y, now);
        p.positionZ.setValueAtTime(z, now);
      },
    };
  }

  /** outdoor = coast surf + wind; mountain = wind across the ridge; indoor = none */
  startAmbience(kind: "coast" | "none" | "mountain" = "coast") {
    if (this.ambience.length) return;
    const loops: [string, number][] =
      kind === "coast"
        ? [
            ["surf", 0.32],
            ["wind", 0.06],
          ]
        : kind === "mountain"
          ? [["wind", 0.13]]
          : [];
    if (!this.ambienceGain) {
      this.ambienceGain = this.ctx.createGain();
      this.ambienceGain.gain.value = 0;
      this.ambienceGain.connect(this.muffle);
    }
    for (const [name, vol] of loops) {
      const b = this.buffers.get(name)?.[0];
      if (!b) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = b;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = vol;
      src.connect(g).connect(this.ambienceGain);
      src.start();
      this.ambience.push(src);
    }
  }

  /** Stop all one-shot voices (used on restart). Ambience keeps playing. */
  stopAll() {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
  }

  get voiceCount() {
    return this.active.size;
  }

  private makeImpulse(seconds: number, decay: number) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections cluster (concrete slap) + diffuse tail
        const early = i < sr * 0.08 && Math.random() < 0.004 ? (Math.random() * 2 - 1) * 2 : 0;
        const n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
        lp += 0.35 * (n - lp); // darken the tail
        d[i] = lp + early * (1 - t);
      }
    }
    return buf;
  }
}
