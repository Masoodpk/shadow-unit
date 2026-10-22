/**
 * Procedural sound design. Every sound in SALTLINE is synthesised at load
 * time from layered noise/sine sources — zero downloads, no licensing
 * concerns, and a consistent "dry concrete + salt air" sonic identity.
 *
 * Each entry produces a few variants so repeated shots never sound robotic.
 */

type Buf = Float32Array;

let SR = 48000;
const len = (sec: number) => new Float32Array(Math.max(1, Math.floor(sec * SR)));
const noise = () => Math.random() * 2 - 1;

function lowpass(b: Buf, fc: number, passes = 1) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  for (let p = 0; p < passes; p++) {
    let y = 0;
    for (let i = 0; i < b.length; i++) {
      y += a * (b[i] - y);
      b[i] = y;
    }
  }
  return b;
}
function highpass(b: Buf, fc: number) {
  const a = 1 - Math.exp((-2 * Math.PI * fc) / SR);
  let y = 0;
  for (let i = 0; i < b.length; i++) {
    y += a * (b[i] - y);
    b[i] = b[i] - y;
  }
  return b;
}
const bandpass = (b: Buf, lo: number, hi: number) => lowpass(highpass(b, lo), hi, 2);

/** Fill with enveloped noise. env(tSeconds) → amplitude */
function noiseLayer(sec: number, env: (t: number) => number) {
  const b = len(sec);
  for (let i = 0; i < b.length; i++) b[i] = noise() * env(i / SR);
  return b;
}
/** Sine with frequency f(t) and amplitude env(t). */
function toneLayer(sec: number, f: (t: number) => number, env: (t: number) => number) {
  const b = len(sec);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += (2 * Math.PI * f(t)) / SR;
    b[i] = Math.sin(ph) * env(t);
  }
  return b;
}
/** Metallic ring: inharmonic partials with exponential decay. */
function ring(sec: number, freqs: number[], tau: number) {
  const b = len(sec);
  const phases = freqs.map(() => Math.random() * 6.28);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    let s = 0;
    for (let k = 0; k < freqs.length; k++) s += Math.sin(phases[k] + 2 * Math.PI * freqs[k] * t) / (k + 1);
    b[i] = s * Math.exp(-t / tau);
  }
  return b;
}
function mix(target: Buf, src: Buf, atSec = 0, gain = 1) {
  const o = Math.floor(atSec * SR);
  const n = Math.min(src.length, target.length - o);
  for (let i = 0; i < n; i++) target[o + i] += src[i] * gain;
  return target;
}
function softclip(b: Buf, drive: number) {
  const k = Math.tanh(drive);
  for (let i = 0; i < b.length; i++) b[i] = Math.tanh(b[i] * drive) / k;
  return b;
}
function normalize(b: Buf, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i]));
  if (m > 0) for (let i = 0; i < b.length; i++) b[i] *= peak / m;
  return b;
}
/** Short fade in/out to avoid clicks */
function fade(b: Buf, inSec = 0.001, outSec = 0.02) {
  const ni = Math.floor(inSec * SR);
  const no = Math.floor(outSec * SR);
  for (let i = 0; i < ni && i < b.length; i++) b[i] *= i / ni;
  for (let i = 0; i < no && i < b.length; i++) b[b.length - 1 - i] *= i / no;
  return b;
}
const ex = (tau: number) => (t: number) => Math.exp(-t / tau);
const attackDecay = (att: number, tau: number) => (t: number) => (t < att ? t / att : Math.exp(-(t - att) / tau));
const r = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- weapons
function rifleShot() {
  const out = len(0.45);
  const p = r(0.95, 1.05);
  mix(out, highpass(noiseLayer(0.06, ex(0.0055)), 1600), 0, 1.1);
  mix(out, toneLayer(0.25, (t) => (58 + 140 * Math.exp(-t / 0.018)) * p, ex(0.045)), 0, 1.0);
  mix(out, lowpass(noiseLayer(0.3, ex(0.045)), 2600 * p, 2), 0, 1.4);
  mix(out, lowpass(noiseLayer(0.45, attackDecay(0.01, 0.13)), 650, 2), 0.004, 0.9);
  mix(out, highpass(noiseLayer(0.01, ex(0.002)), 3000), 0.011, 0.3);
  mix(out, ring(0.06, [2150 * p, 3480 * p, 5100], 0.009), 0.046, 0.14);
  return fade(normalize(softclip(out, 1.9)), 0.0005, 0.05);
}
function akShot() {
  const out = len(0.55);
  const p = r(0.92, 1.0);
  mix(out, highpass(noiseLayer(0.07, ex(0.007)), 1200), 0, 1.1);
  mix(out, toneLayer(0.3, (t) => (48 + 120 * Math.exp(-t / 0.022)) * p, ex(0.06)), 0, 1.25);
  mix(out, lowpass(noiseLayer(0.35, ex(0.06)), 2000 * p, 2), 0, 1.5);
  mix(out, lowpass(noiseLayer(0.55, attackDecay(0.012, 0.16)), 520, 2), 0.004, 1.0);
  mix(out, ring(0.07, [1650 * p, 2900 * p, 4300], 0.012), 0.05, 0.18);
  return fade(normalize(softclip(out, 2.2)), 0.0005, 0.06);
}
function pistolShot() {
  const out = len(0.35);
  const p = r(0.97, 1.06);
  mix(out, highpass(noiseLayer(0.05, ex(0.0045)), 2000), 0, 1.0);
  mix(out, toneLayer(0.15, (t) => (90 + 160 * Math.exp(-t / 0.012)) * p, ex(0.03)), 0, 0.8);
  mix(out, lowpass(noiseLayer(0.22, ex(0.035)), 3000 * p, 2), 0, 1.2);
  mix(out, lowpass(noiseLayer(0.35, attackDecay(0.008, 0.09)), 700, 2), 0.003, 0.6);
  mix(out, ring(0.05, [2600 * p, 4200], 0.008), 0.03, 0.2);
  return fade(normalize(softclip(out, 1.7)), 0.0005, 0.04);
}
/** Suppressed 12.7 mm: no supersonic-free crack, heavy thump + mechanical clatter. */
function suppressedShot() {
  const out = len(0.45);
  const p = r(0.95, 1.03);
  mix(out, toneLayer(0.25, (t) => (55 + 70 * Math.exp(-t / 0.03)) * p, ex(0.05)), 0, 1.2);
  mix(out, lowpass(noiseLayer(0.2, ex(0.03)), 900, 2), 0, 1.0);
  mix(out, bandpass(noiseLayer(0.06, ex(0.012)), 1200, 3500), 0, 0.35);
  mix(out, ring(0.1, [1900 * p, 3100, 4700], 0.02), 0.02, 0.35);
  mix(out, highpass(noiseLayer(0.02, ex(0.003)), 3000), 0.6 / 10, 0.25);
  return fade(normalize(softclip(out, 1.5)), 0.001, 0.05);
}
/** 5.56 from a short barrel: harsher blast, more concussion, polymer-and-steel snap. */
function m5Shot() {
  const out = len(0.42);
  const p = r(1.0, 1.08);
  mix(out, highpass(noiseLayer(0.05, ex(0.004)), 2200), 0, 1.25);
  mix(out, bandpass(noiseLayer(0.09, ex(0.016)), 900, 4200), 0.001, 1.1);
  mix(out, toneLayer(0.2, (t) => (66 + 170 * Math.exp(-t / 0.014)) * p, ex(0.035)), 0, 0.95);
  mix(out, lowpass(noiseLayer(0.25, ex(0.034)), 3200 * p, 2), 0, 1.25);
  mix(out, lowpass(noiseLayer(0.42, attackDecay(0.008, 0.1)), 760, 2), 0.003, 0.75);
  mix(out, ring(0.04, [2900 * p, 4400 * p, 6300], 0.006), 0.034, 0.18);
  mix(out, highpass(noiseLayer(0.008, ex(0.0015)), 4000), 0.032, 0.35);
  return fade(normalize(softclip(out, 2.3)), 0.0005, 0.045);
}
/** .45 ACP SMG: subsonic — no crack, a round low "thup" and the Super V's busy mechanical clack. */
function vectorShot() {
  const out = len(0.36);
  const p = r(0.96, 1.05);
  mix(out, bandpass(noiseLayer(0.05, ex(0.007)), 500, 2600), 0, 1.2);
  mix(out, toneLayer(0.22, (t) => (92 + 120 * Math.exp(-t / 0.02)) * p, ex(0.045)), 0, 1.35);
  mix(out, lowpass(noiseLayer(0.22, ex(0.03)), 1700 * p, 2), 0, 1.1);
  mix(out, lowpass(noiseLayer(0.34, attackDecay(0.01, 0.08)), 480, 2), 0.004, 0.8);
  // bolt + inertia block slamming down
  mix(out, ring(0.05, [1250 * p, 2350 * p, 3900], 0.008), 0.017, 0.38);
  mix(out, highpass(noiseLayer(0.012, ex(0.0025)), 1800), 0.018, 0.4);
  mix(out, ring(0.03, [1700 * p, 3100], 0.005), 0.041, 0.18);
  return fade(normalize(softclip(out, 1.8)), 0.0005, 0.04);
}
function rifleTail() {
  const out = lowpass(noiseLayer(1.3, attackDecay(0.06, 0.38)), 380, 2);
  mix(out, lowpass(noiseLayer(1.3, (t) => (t > 0.22 ? Math.exp(-(t - 0.22) / 0.25) : 0)), 700, 2), 0, 0.5);
  return fade(normalize(out, 0.8), 0.003, 0.2);
}
function akTail() {
  const out = lowpass(noiseLayer(1.6, attackDecay(0.07, 0.46)), 300, 2);
  mix(out, lowpass(noiseLayer(1.6, (t) => (t > 0.25 ? Math.exp(-(t - 0.25) / 0.32) : 0)), 560, 2), 0, 0.55);
  return fade(normalize(out, 0.85), 0.003, 0.25);
}
function m5Tail() {
  const out = lowpass(noiseLayer(1.2, attackDecay(0.05, 0.32)), 520, 2);
  mix(out, bandpass(noiseLayer(1.2, (t) => (t > 0.15 ? Math.exp(-(t - 0.15) / 0.22) : 0)), 600, 1800), 0, 0.45);
  return fade(normalize(out, 0.8), 0.003, 0.2);
}
function smgTail() {
  const out = lowpass(noiseLayer(0.85, attackDecay(0.04, 0.2)), 420, 2);
  mix(out, lowpass(noiseLayer(0.85, (t) => (t > 0.12 ? Math.exp(-(t - 0.12) / 0.16) : 0)), 900, 2), 0, 0.35);
  return fade(normalize(out, 0.7), 0.003, 0.15);
}
function pistolTail() {
  const out = lowpass(noiseLayer(0.9, attackDecay(0.03, 0.22)), 650, 2);
  mix(out, bandpass(noiseLayer(0.9, (t) => (t > 0.1 ? Math.exp(-(t - 0.1) / 0.18) : 0)), 800, 2600), 0, 0.3);
  return fade(normalize(out, 0.65), 0.003, 0.15);
}
function enemyShot() {
  const out = len(0.5);
  const p = r(0.88, 0.98);
  mix(out, highpass(noiseLayer(0.05, ex(0.006)), 1300), 0, 0.8);
  mix(out, toneLayer(0.25, (t) => (70 + 110 * Math.exp(-t / 0.02)) * p, ex(0.05)), 0, 0.9);
  mix(out, lowpass(noiseLayer(0.35, ex(0.06)), 1900 * p, 2), 0, 1.3);
  mix(out, lowpass(noiseLayer(0.5, attackDecay(0.02, 0.16)), 520, 2), 0.01, 1.0);
  return fade(normalize(softclip(out, 1.7)), 0.0005, 0.05);
}
function scrape(sec: number, lo: number, hi: number, gain = 1) {
  return bandpass(noiseLayer(sec, (t) => Math.sin((Math.PI * t) / sec) * gain), lo, hi);
}
function magOut() {
  const out = len(0.3);
  mix(out, ring(0.04, [3100, 4700], 0.005), 0, 0.6);
  mix(out, scrape(0.12, 1800, 6000, 0.6), 0.02, 1);
  mix(out, lowpass(noiseLayer(0.05, ex(0.012)), 1100), 0.12, 0.5);
  return fade(normalize(out, 0.7));
}
function magIn() {
  const out = len(0.3);
  mix(out, scrape(0.06, 1500, 5000, 0.5), 0, 0.8);
  mix(out, toneLayer(0.1, () => 170, ex(0.02)), 0.055, 0.9);
  mix(out, lowpass(noiseLayer(0.06, ex(0.012)), 1400), 0.055, 1.2);
  mix(out, ring(0.06, [2600, 3900, 5800], 0.01), 0.06, 0.5);
  return fade(normalize(out, 0.85));
}
function boltRelease() {
  const out = len(0.3);
  mix(out, scrape(0.05, 1500, 4500, 0.6), 0, 1);
  mix(out, ring(0.15, [2300, 3900, 5600, 7200], 0.022), 0.05, 0.9);
  mix(out, highpass(noiseLayer(0.02, ex(0.003)), 2500), 0.05, 0.9);
  mix(out, lowpass(noiseLayer(0.04, ex(0.01)), 800), 0.05, 0.6);
  return fade(normalize(out, 0.85));
}
// ---------------------------------------------------------------- per-gun reload foley
interface MagSpec {
  /** metallic partials of the magazine / receiver */
  ring: number[];
  tau: number;
  /** scrape band */
  lo: number;
  hi: number;
  /** body thud (Hz) — heavier guns lower */
  thud: number;
  /** 0..1 how metallic (steel AK mag) vs polymer */
  metal: number;
}
function makeMagOut(m: MagSpec) {
  const out = len(0.34);
  const f = r(0.97, 1.03);
  mix(out, ring(0.04, [m.ring[0] * 1.4 * f, m.ring[1] * 1.3 * f], 0.004), 0, 0.5); // release button
  mix(out, scrape(0.1 + m.metal * 0.04, m.lo, m.hi, 0.7), 0.018, 1);
  mix(out, ring(0.12, m.ring.map((x) => x * f), m.tau * (0.5 + m.metal)), 0.03, 0.25 + m.metal * 0.35);
  mix(out, lowpass(noiseLayer(0.06, ex(0.012)), m.thud * 6), 0.13, 0.45);
  return fade(normalize(out, 0.72));
}
function makeMagIn(m: MagSpec) {
  const out = len(0.36);
  const f = r(0.97, 1.03);
  mix(out, scrape(0.07, m.lo, m.hi, 0.5), 0, 0.75);
  mix(out, toneLayer(0.1, () => m.thud * f, ex(0.022)), 0.06, 1.0);
  mix(out, lowpass(noiseLayer(0.07, ex(0.012)), m.thud * 8), 0.06, 1.2);
  mix(out, ring(0.08, m.ring.map((x) => x * f), m.tau), 0.062, 0.45 + m.metal * 0.3);
  // catch clicks into place
  mix(out, highpass(noiseLayer(0.01, ex(0.002)), 3000), 0.085, 0.45);
  mix(out, ring(0.03, [m.ring[2] * 1.2 * f], 0.004), 0.086, 0.3);
  return fade(normalize(out, 0.88));
}
function makeBolt(o: { slide: number; ring: number[]; tau: number; thud: number; double?: boolean }) {
  const out = len(0.42);
  const f = r(0.97, 1.03);
  mix(out, scrape(o.slide, 1300, 4800, 0.6), 0, 1);
  if (o.double) {
    // pull back to the stop, then let it fly home
    mix(out, ring(0.08, o.ring.map((x) => x * 0.9 * f), o.tau * 0.7), o.slide, 0.5);
    mix(out, scrape(o.slide * 0.6, 1600, 5200, 0.5), o.slide + 0.07, 0.8);
  }
  const home = o.double ? o.slide * 1.6 + 0.08 : o.slide;
  mix(out, ring(0.16, o.ring.map((x) => x * f), o.tau), home, 0.9);
  mix(out, highpass(noiseLayer(0.02, ex(0.003)), 2500), home, 0.9);
  mix(out, lowpass(noiseLayer(0.05, ex(0.012)), o.thud * 7), home, 0.7);
  mix(out, toneLayer(0.06, () => o.thud * f, ex(0.015)), home, 0.5);
  return fade(normalize(out, 0.85));
}
const MAGS: Record<string, MagSpec> = {
  m4: { ring: [2600, 3900, 5800], tau: 0.01, lo: 1600, hi: 5600, thud: 170, metal: 0.55 },
  ak: { ring: [1700, 2650, 4100], tau: 0.016, lo: 1100, hi: 4200, thud: 125, metal: 1 },
  poly: { ring: [2200, 3500, 5200], tau: 0.006, lo: 1400, hi: 4600, thud: 185, metal: 0.15 },
  vssk: { ring: [1500, 2400, 3700], tau: 0.014, lo: 900, hi: 3600, thud: 110, metal: 0.9 },
  pistol: { ring: [3300, 5100, 7200], tau: 0.006, lo: 2000, hi: 6500, thud: 240, metal: 0.35 },
  vector: { ring: [2000, 3300, 4800], tau: 0.007, lo: 1300, hi: 4800, thud: 160, metal: 0.25 },
};
const m4MagOut = () => makeMagOut(MAGS.m4);
const m4MagIn = () => makeMagIn(MAGS.m4);
const m4Bolt = () => makeBolt({ slide: 0.04, ring: [2300, 3900, 5600, 7200], tau: 0.022, thud: 150 }); // bolt catch slap
const akMagOut = () => makeMagOut(MAGS.ak);
const akMagIn = () => makeMagIn(MAGS.ak);
const akBolt = () => makeBolt({ slide: 0.07, ring: [1500, 2500, 3600, 5200], tau: 0.03, thud: 110, double: true });
const polyMagOut = () => makeMagOut(MAGS.poly);
const polyMagIn = () => makeMagIn(MAGS.poly);
const m5Bolt = () => makeBolt({ slide: 0.045, ring: [2500, 4200, 6100], tau: 0.016, thud: 160 });
const vsskMagOut = () => makeMagOut(MAGS.vssk);
const vsskMagIn = () => makeMagIn(MAGS.vssk);
const vsskBolt = () => makeBolt({ slide: 0.08, ring: [1300, 2200, 3300, 4700], tau: 0.035, thud: 95, double: true });
const vsskCycle = () => makeBolt({ slide: 0.03, ring: [1400, 2300, 3500], tau: 0.02, thud: 100 });
const pistolMagOut = () => makeMagOut(MAGS.pistol);
const pistolMagIn = () => makeMagIn(MAGS.pistol);
const slideRelease = () => makeBolt({ slide: 0.025, ring: [2900, 4600, 6800], tau: 0.012, thud: 210 });
const vectorMagOut = () => makeMagOut(MAGS.vector);
const vectorMagIn = () => makeMagIn(MAGS.vector);
const vectorBolt = () => makeBolt({ slide: 0.055, ring: [2100, 3400, 5000], tau: 0.014, thud: 150, double: true });

// ---------------------------------------------------------------- flashbang
function pinPull() {
  const out = len(0.42);
  mix(out, ring(0.05, [3400, 5200], 0.006), 0, 0.5); // finger on the ring
  mix(out, scrape(0.11, 2500, 7500, 0.7), 0.08, 1); // pin sliding out
  mix(out, ring(0.25, [2750, 4150, 6300, 8100], 0.045), 0.19, 0.8); // ring jingles free
  mix(out, highpass(noiseLayer(0.01, ex(0.002)), 4000), 0.19, 0.5);
  return fade(normalize(out, 0.75));
}
function spoon() {
  const out = len(0.35);
  mix(out, highpass(noiseLayer(0.008, ex(0.002)), 3000), 0, 0.8); // striker snaps
  mix(out, ring(0.3, [3600, 5300, 7900], 0.05), 0.004, 0.7); // spoon flies, pings
  mix(out, ring(0.06, [1900, 3100], 0.01), 0.002, 0.35);
  return fade(normalize(out, 0.5));
}
function grenadeThrow() {
  const out = bandpass(noiseLayer(0.38, (t) => Math.sin((Math.PI * t) / 0.38) ** 3), 400, 2600);
  mix(out, foley(), 0, 0.5);
  return fade(normalize(out, 0.5));
}
function grenadeBounce() {
  const out = len(0.4);
  const f = r(0.9, 1.12);
  mix(out, ring(0.35, [820 * f, 1630 * f, 2710 * f, 4100 * f], 0.05), 0, 0.9); // hollow steel can
  mix(out, lowpass(noiseLayer(0.04, ex(0.008)), 1400), 0, 1);
  mix(out, highpass(noiseLayer(0.01, ex(0.002)), 3000), 0, 0.4);
  return fade(normalize(out, 0.6));
}
/** The bang: an enormous broadband crack (~170 dB at 1.5 m), a short low thump and a ringing concrete tail. */
function flashBang() {
  const out = len(2.4);
  mix(out, noiseLayer(0.02, ex(0.004)), 0, 1.6);
  mix(out, highpass(noiseLayer(0.12, ex(0.02)), 1200), 0, 1.4);
  mix(out, toneLayer(0.5, (t) => 38 + 90 * Math.exp(-t / 0.03), ex(0.09)), 0, 1.6);
  mix(out, lowpass(noiseLayer(0.8, ex(0.12)), 900, 2), 0.002, 1.3);
  mix(out, lowpass(noiseLayer(2.4, attackDecay(0.03, 0.55)), 380, 2), 0.01, 0.9);
  mix(out, bandpass(noiseLayer(2.4, (t) => (t > 0.08 ? Math.exp(-(t - 0.08) / 0.4) : 0)), 600, 2400), 0, 0.35);
  return fade(normalize(softclip(out, 3.2), 0.98), 0.0003, 0.4);
}

function dryFire() {
  const out = len(0.1);
  mix(out, ring(0.06, [4100, 1250, 6300], 0.005), 0, 1);
  mix(out, highpass(noiseLayer(0.01, ex(0.0015)), 3000), 0, 0.7);
  return fade(normalize(out, 0.6));
}
function foley() {
  const out = bandpass(noiseLayer(0.3, (t) => Math.sin((Math.PI * t) / 0.3) * (0.6 + 0.4 * Math.sin(t * 90))), 700, 3200);
  mix(out, ring(0.05, [2100, 3300], 0.01), r(0.1, 0.2), 0.15);
  return fade(normalize(out, 0.4));
}
function weaponSwitch() {
  const out = foley();
  mix(out, ring(0.08, [1900, 3100, 4800], 0.013), 0.16, 0.25);
  mix(out, lowpass(noiseLayer(0.03, ex(0.008)), 1100), 0.16, 0.3);
  return fade(normalize(out, 0.5));
}

// ---------------------------------------------------------------- grenades
/**
 * Fragmentation grenade, modelled on the big arcade-military blasts: a hard
 * supersonic crack, a chest-thumping sub-bass drop, a fat blast body, debris
 * pattering down, and a rolling rumble that hangs in the air.
 */
function fragBoom() {
  const out = len(3.6);
  const p = r(0.94, 1.05);
  mix(out, noiseLayer(0.012, ex(0.0028)), 0, 2.2);
  mix(out, highpass(noiseLayer(0.09, ex(0.013)), 900), 0, 1.6);
  mix(out, toneLayer(0.9, (t) => (31 + 115 * Math.exp(-t / 0.045)) * p, attackDecay(0.002, 0.24)), 0, 2.4);
  mix(out, toneLayer(0.5, (t) => (62 + 60 * Math.exp(-t / 0.03)) * p, ex(0.09)), 0, 0.9);
  mix(out, lowpass(noiseLayer(0.9, ex(0.11)), 1500, 2), 0.002, 1.9);
  mix(out, lowpass(noiseLayer(3.6, attackDecay(0.05, 0.95)), 150, 2), 0.02, 1.5);
  mix(out, lowpass(noiseLayer(3.6, (t) => (t > 0.15 ? Math.exp(-(t - 0.15) / 0.65) : 0)), 420, 2), 0, 0.65);
  for (let i = 0; i < 28; i++) mix(out, bandpass(noiseLayer(0.02, ex(0.004)), 1400, 5200), r(0.12, 1.4), r(0.04, 0.16));
  for (let i = 0; i < 9; i++) mix(out, ring(0.08, [r(2000, 4500), r(5000, 7200)], 0.01), r(0.2, 1.3), r(0.025, 0.07));
  return fade(normalize(softclip(out, 3.0), 0.98), 0.0003, 0.6);
}
/** Incendiary: a fuel "whump", a rushing ignition and the first crackles. */
function fireIgnite() {
  const out = len(1.8);
  mix(out, bandpass(noiseLayer(1.4, (t) => (t < 0.12 ? t / 0.12 : Math.exp(-(t - 0.12) / 0.38))), 220, 2600), 0, 1.3);
  mix(out, toneLayer(0.6, (t) => 48 + 40 * Math.exp(-t / 0.05), ex(0.14)), 0, 1.4);
  mix(out, lowpass(noiseLayer(0.5, ex(0.08)), 700, 2), 0, 1.0);
  for (let i = 0; i < 14; i++) mix(out, highpass(noiseLayer(0.008, ex(0.0016)), 2500), r(0.2, 1.6), r(0.1, 0.3));
  return fade(normalize(softclip(out, 2.0), 0.9), 0.002, 0.3);
}
/** Seamless burning loop: roar + crackle + hiss. */
function fireLoop() {
  const L = 4;
  const b = len(L + 0.5);
  const roar = lowpass(noiseLayer(L + 0.5, (t) => 0.7 + 0.3 * Math.sin(t * 2.3) * Math.sin(t * 0.9)), 320, 2);
  mix(b, roar, 0, 1.4);
  mix(b, bandpass(noiseLayer(L + 0.5, () => 0.35), 1800, 6000), 0, 0.25);
  for (let i = 0; i < 70; i++) mix(b, highpass(noiseLayer(0.01, ex(0.0018)), 2200), r(0, L + 0.4), r(0.15, 0.55));
  for (let i = 0; i < 18; i++) mix(b, lowpass(noiseLayer(0.05, ex(0.012)), 900), r(0, L + 0.4), r(0.2, 0.5));
  return normalize(loopify(b, 0.5), 0.7);
}
/** Armed plasma: a charging, wavering electric hum (loop). */
function plasmaHum() {
  const L = 2;
  const b = len(L + 0.25);
  mix(b, toneLayer(L + 0.25, () => 180, (t) => 0.6 + 0.4 * Math.sin(t * 2 * Math.PI * 9)), 0, 0.5);
  mix(b, toneLayer(L + 0.25, () => 182.5, () => 0.5), 0, 0.4);
  mix(b, toneLayer(L + 0.25, () => 541, (t) => 0.3 + 0.3 * Math.sin(t * 2 * Math.PI * 4)), 0, 0.25);
  mix(b, bandpass(noiseLayer(L + 0.25, (t) => 0.4 + 0.6 * Math.max(0, Math.sin(t * 2 * Math.PI * 6))), 1500, 5000), 0, 0.18);
  return normalize(loopify(b, 0.25), 0.55);
}
function plasmaStick() {
  const out = len(0.45);
  mix(out, lowpass(noiseLayer(0.05, ex(0.01)), 900), 0, 1);
  mix(out, ring(0.2, [1900, 2850, 4300], 0.03), 0, 0.5);
  mix(out, toneLayer(0.4, (t) => 300 + 1600 * t, (t) => Math.min(1, t / 0.05) * Math.exp(-t / 0.25)), 0.02, 0.45);
  return fade(normalize(out, 0.7));
}
/** Plasma detonation: electric snap, crackling arcs, a falling zap and a deep thump. */
function plasmaBlast() {
  const out = len(2.4);
  mix(out, noiseLayer(0.01, ex(0.002)), 0, 1.8);
  mix(out, toneLayer(0.8, (t) => 36 + 90 * Math.exp(-t / 0.05), attackDecay(0.002, 0.2)), 0, 2.0);
  mix(out, toneLayer(0.6, (t) => 2400 * Math.exp(-t / 0.12) + 120, ex(0.18)), 0, 0.6);
  const crackle = bandpass(
    noiseLayer(1.2, (t) => (Math.random() < 0.35 ? 1 : 0.1) * Math.exp(-t / 0.35)),
    1800,
    7000,
  );
  mix(out, crackle, 0.005, 1.1);
  mix(out, lowpass(noiseLayer(2.4, attackDecay(0.04, 0.6)), 220, 2), 0.01, 1.0);
  return fade(normalize(softclip(out, 2.6), 0.95), 0.0003, 0.4);
}

// ---------------------------------------------------------------- hits & impacts
function hitMarker() {
  return fade(normalize(toneLayer(0.07, (t) => 1900 - 900 * t, ex(0.018)), 0.5));
}
function hitHead() {
  const out = len(0.25);
  mix(out, ring(0.25, [3100, 4650, 6900], 0.05), 0, 0.8);
  mix(out, toneLayer(0.07, (t) => 2400 - 900 * t, ex(0.02)), 0, 0.6);
  mix(out, lowpass(noiseLayer(0.05, ex(0.012)), 1600), 0, 0.5);
  return fade(normalize(out, 0.6));
}
function killConfirm() {
  const out = len(0.35);
  mix(out, toneLayer(0.3, () => 880, ex(0.06)), 0, 0.5);
  mix(out, toneLayer(0.3, () => 1320, ex(0.07)), 0.05, 0.4);
  mix(out, lowpass(noiseLayer(0.06, ex(0.02)), 500), 0, 0.6);
  return fade(normalize(out, 0.45));
}
function fleshHit() {
  const out = len(0.18);
  mix(out, lowpass(noiseLayer(0.15, ex(0.03)), 700, 2), 0, 1);
  mix(out, toneLayer(0.1, () => r(85, 110), ex(0.035)), 0, 0.8);
  mix(out, highpass(noiseLayer(0.02, ex(0.004)), 2200), 0, 0.3);
  return fade(normalize(out, 0.75));
}
function impactConcrete() {
  const out = len(0.22);
  mix(out, highpass(noiseLayer(0.05, ex(0.008)), 1400), 0, 1);
  mix(out, lowpass(noiseLayer(0.2, ex(0.04)), 1200), 0.004, 0.6);
  for (let i = 0; i < 4; i++) mix(out, highpass(noiseLayer(0.01, ex(0.002)), 3000), r(0.02, 0.12), 0.2);
  return fade(normalize(out, 0.6));
}
function impactMetal() {
  const out = len(0.35);
  const f = r(0.85, 1.2);
  mix(out, ring(0.35, [1150 * f, 2730 * f, 4120 * f, 6050 * f], 0.07), 0, 0.8);
  mix(out, highpass(noiseLayer(0.03, ex(0.005)), 2000), 0, 0.8);
  return fade(normalize(out, 0.6));
}
function ricochet() {
  const f0 = r(2600, 3600);
  const out = toneLayer(0.32, (t) => f0 - 2000 * t + 120 * Math.sin(t * 160), (t) => Math.sin((Math.PI * t) / 0.32) * Math.exp(-t / 0.2));
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 2000), 0, 0.5);
  return fade(normalize(out, 0.4));
}
function casing() {
  const out = len(0.3);
  const f = r(3800, 6200);
  mix(out, ring(0.12, [f, f * 1.47, f * 2.13], 0.035), 0, 1);
  mix(out, ring(0.1, [f * 1.02, f * 1.5], 0.02), r(0.08, 0.13), 0.45);
  mix(out, ring(0.06, [f * 0.98], 0.012), r(0.17, 0.22), 0.2);
  return fade(normalize(out, 0.35));
}
function shellDrop() {
  const out = len(0.25);
  mix(out, ring(0.08, [r(700, 900), 1650], 0.02), 0, 0.8);
  mix(out, lowpass(noiseLayer(0.04, ex(0.01)), 1200), 0, 0.7);
  mix(out, ring(0.06, [r(800, 1000)], 0.015), r(0.1, 0.14), 0.35);
  return fade(normalize(out, 0.35));
}
function footstep() {
  const out = len(0.18);
  mix(out, lowpass(noiseLayer(0.12, ex(0.025)), r(380, 560), 2), 0, 1);
  mix(out, highpass(noiseLayer(0.08, ex(0.015)), 2500), r(0.0, 0.01), 0.18); // grit
  mix(out, toneLayer(0.06, () => r(70, 95), ex(0.02)), 0, 0.5);
  return fade(normalize(out, 0.5));
}
function land() {
  const out = len(0.3);
  mix(out, lowpass(noiseLayer(0.2, ex(0.05)), 450, 2), 0, 1);
  mix(out, toneLayer(0.15, () => 65, ex(0.04)), 0, 0.8);
  mix(out, foley(), 0.02, 0.3);
  return fade(normalize(out, 0.6));
}
function playerHurt() {
  const out = len(0.35);
  mix(out, lowpass(noiseLayer(0.3, ex(0.07)), 320, 2), 0, 1);
  mix(out, toneLayer(0.25, (t) => 75 - 30 * t, ex(0.08)), 0, 1);
  mix(out, highpass(noiseLayer(0.02, ex(0.004)), 1800), 0, 0.25);
  return fade(normalize(out, 0.8));
}
function bulletWhiz() {
  const out = bandpass(noiseLayer(0.22, (t) => Math.sin((Math.PI * t) / 0.22) ** 2), 1800, 5200);
  return fade(normalize(out, 0.35));
}
function bodyFall() {
  const out = len(0.5);
  mix(out, lowpass(noiseLayer(0.3, ex(0.06)), 380, 2), 0, 1);
  mix(out, toneLayer(0.2, () => 58, ex(0.06)), 0, 0.8);
  mix(out, lowpass(noiseLayer(0.25, ex(0.05)), 500, 2), 0.16, 0.5);
  for (let i = 0; i < 3; i++) mix(out, ring(0.06, [r(1800, 3800), r(4000, 6000)], 0.012), r(0.02, 0.2), 0.12);
  return fade(normalize(out, 0.7));
}
/** Melee: the swing (cloth + gear rustle + air whoosh) */
function meleeSwing() {
  const out = len(0.35);
  const p = r(0.9, 1.1);
  mix(out, bandpass(noiseLayer(0.3, (t) => Math.sin(Math.min(1, t / 0.3) * Math.PI) ** 1.5), 500 * p, 2600 * p), 0, 1);
  mix(out, highpass(noiseLayer(0.12, ex(0.03)), 2500), 0.02, 0.25);
  for (let i = 0; i < 2; i++) mix(out, ring(0.04, [r(2600, 4200), r(5000, 7000)], 0.008), r(0.0, 0.08), 0.08);
  return fade(normalize(out, 0.55), 0.01, 0.05);
}
/** Melee: rifle butt / pistol frame into a body (thud, gear rattle, grunt of air) */
function meleeHit() {
  const out = len(0.42);
  mix(out, toneLayer(0.18, (t) => 95 * Math.exp(-t / 0.05) + 55, ex(0.05)), 0, 1.2);
  mix(out, lowpass(noiseLayer(0.12, ex(0.018)), 900, 2), 0, 1.2);
  mix(out, bandpass(noiseLayer(0.05, ex(0.008)), 1500, 4500), 0.002, 0.5);
  for (let i = 0; i < 3; i++) mix(out, ring(0.07, [r(1500, 2600), r(3200, 5200)], 0.012), r(0.01, 0.09), 0.14);
  mix(out, lowpass(noiseLayer(0.2, attackDecay(0.02, 0.06)), 600, 2), 0.06, 0.35);
  return fade(normalize(softclip(out, 1.6), 0.85), 0.0005, 0.06);
}
function weaponDrop() {
  const out = len(0.45);
  mix(out, ring(0.3, [r(700, 900), r(1900, 2300), 3400], 0.05), 0, 0.6);
  mix(out, lowpass(noiseLayer(0.06, ex(0.012)), 900), 0, 0.8);
  mix(out, ring(0.15, [r(800, 1000), 2500], 0.03), r(0.15, 0.22), 0.3);
  return fade(normalize(out, 0.5));
}
/** Enemy helmet-radio squelch when they detect you — part of the faction's identity. */
function radioChirp() {
  const out = len(0.42);
  mix(out, bandpass(noiseLayer(0.06, ex(0.03)), 1500, 4000), 0, 0.5);
  mix(out, toneLayer(0.08, () => 1250, (t) => (t < 0.07 ? 1 : 0)), 0.05, 0.25);
  const chatter = bandpass(
    noiseLayer(0.24, (t) => (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * r(9, 14))) * Math.sin((Math.PI * t) / 0.24)),
    500,
    2200,
  );
  mix(out, chatter, 0.13, 0.55);
  mix(out, bandpass(noiseLayer(0.05, ex(0.02)), 1500, 4000), 0.37, 0.5);
  return fade(normalize(softclip(out, 2), 0.42));
}

// ---------------------------------------------------------------- rockets & knife
/**
 * Noise through a band whose edges move over time (a source flying away: the band falls).
 * lo(t), hi(t) in Hz; a one-pole high-pass then a two-pass low-pass, recomputed per sample.
 */
function sweptBand(sec: number, env: (t: number) => number, lo: (t: number) => number, hi: (t: number) => number) {
  const b = len(sec);
  let h = 0, l1 = 0, l2 = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const x = noise() * env(t);
    const ah = 1 - Math.exp((-2 * Math.PI * lo(t)) / SR);
    h += ah * (x - h);
    const hp = x - h;
    const al = 1 - Math.exp((-2 * Math.PI * hi(t)) / SR);
    l1 += al * (hp - l1);
    l2 += al * (l1 - l2);
    b[i] = l2;
  }
  return b;
}
/**
 * Rocket-motor crackle: the tearing, popping texture of solid propellant — dense random
 * impulses of random strength, band-limited. `density` = pops per second, env scales them.
 */
function crackle(sec: number, density: number, env: (t: number) => number, lo = 700, hi = 7000) {
  const b = len(sec);
  const p = density / SR;
  for (let i = 0; i < b.length; i++) {
    if (Math.random() < p) {
      const a = env(i / SR) * Math.pow(Math.random(), 1.8) * (Math.random() < 0.5 ? -1 : 1);
      const n = 6 + ((Math.random() * 60) | 0);
      for (let k = 0; k < n && i + k < b.length; k++) b[i + k] += a * Math.exp(-k / (n * 0.3)) * (k % 2 ? -0.6 : 1);
    }
  }
  return bandpass(b, lo, hi);
}
/** a delayed, darker copy (a wall / the ground answering the bang) */
function echo(out: Buf, src: Buf, at: number, gain: number, fc: number) {
  return mix(out, lowpass(Float32Array.from(src), fc, 2), at, gain);
}

/**
 * M72 LAW: the motor burns out inside the tube, so it's one enormous event — a sharp supersonic
 * crack, a chest-hitting boom, the backblast tearing out behind your head, then only the rocket's
 * fading whoosh and the bang coming back off the surroundings.
 */
function m72Launch() {
  const out = len(3.0);
  const p = r(0.95, 1.05);
  // crack: N-wave-ish broadband snap + bright burst
  mix(out, noiseLayer(0.006, ex(0.0015)), 0, 2.2);
  mix(out, highpass(noiseLayer(0.05, ex(0.008)), 1500), 0, 1.6);
  // boom: pitch-dropping low thump and a body of low noise
  const boom = len(1.2);
  mix(boom, toneLayer(1.0, (t) => (34 + 110 * Math.exp(-t / 0.035)) * p, attackDecay(0.002, 0.2)), 0, 2.4);
  mix(boom, lowpass(noiseLayer(0.9, ex(0.12)), 1300 * p, 2), 0.001, 2.0);
  mix(out, boom, 0, 1);
  // backblast: a broad rush of gas, crackling as it tears out
  mix(out, bandpass(noiseLayer(1.0, attackDecay(0.006, 0.26)), 180, 6500), 0.003, 1.3);
  mix(out, crackle(0.8, 2400, (t) => Math.exp(-t / 0.18)), 0.004, 1.2);
  // the rocket leaving: a tearing whoosh whose band falls as it pulls away
  mix(
    out,
    sweptBand(1.8, (t) => (t < 0.04 ? t / 0.04 : Math.exp(-(t - 0.04) / 0.45)), (t) => 500 - 250 * Math.min(1, t / 1.5), (t) => 5200 * Math.exp(-t / 0.9) + 900),
    0.02,
    1.0,
  );
  // the surroundings answer
  echo(out, boom, 0.19 * p, 0.4, 900);
  echo(out, boom, 0.47 * p, 0.22, 600);
  mix(out, lowpass(noiseLayer(3.0, attackDecay(0.05, 0.9)), 160, 2), 0.01, 1.0);
  return fade(normalize(softclip(out, 2.8), 0.97), 0.0003, 0.5);
}
/**
 * DZJ-08: a booster charge kicks the rocket out (pop + boom + backblast), then about 15 m out the
 * sustainer lights with a second bang and the roar of the motor carrying it away.
 */
function dzjLaunch() {
  const out = len(3.4);
  const p = r(0.95, 1.04);
  mix(out, noiseLayer(0.006, ex(0.0016)), 0, 2.0);
  mix(out, highpass(noiseLayer(0.04, ex(0.007)), 1700), 0, 1.3);
  const boom = len(1.0);
  mix(boom, toneLayer(0.9, (t) => (40 + 95 * Math.exp(-t / 0.04)) * p, attackDecay(0.002, 0.17)), 0, 2.2);
  mix(boom, lowpass(noiseLayer(0.8, ex(0.1)), 1500 * p, 2), 0.001, 1.8);
  mix(out, boom, 0, 1);
  mix(out, bandpass(noiseLayer(0.9, attackDecay(0.006, 0.22)), 200, 6000), 0.003, 1.2);
  mix(out, crackle(0.5, 2000, (t) => Math.exp(-t / 0.14)), 0.004, 1.0);
  // sustainer ignition: a sharp secondary pop, then a crackling roar that recedes
  const ign = 0.2 * p;
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 900), ign, 1.0);
  mix(out, toneLayer(0.4, (t) => 70 + 80 * Math.exp(-t / 0.03), ex(0.08)), ign, 1.1);
  const roarEnv = (t: number) => (t < 0.05 ? t / 0.05 : Math.exp(-(t - 0.05) / 0.8));
  mix(out, sweptBand(2.6, roarEnv, () => 250, (t) => 4500 * Math.exp(-t / 1.4) + 700), ign, 1.0);
  mix(out, crackle(2.4, 3200, (t) => roarEnv(t) * 0.9, 900, 6000), ign + 0.01, 0.9);
  echo(out, boom, 0.21 * p, 0.38, 900);
  echo(out, boom, 0.52 * p, 0.2, 600);
  mix(out, lowpass(noiseLayer(3.4, attackDecay(0.05, 1.0)), 150, 2), 0.01, 0.9);
  return fade(normalize(softclip(out, 2.7), 0.97), 0.0003, 0.6);
}
/** Rocket motor in flight (loop, DZJ-08): a crackling, tearing roar with a slight flutter. */
function rocketMotor() {
  const L = 1.6;
  const b = len(L + 0.3);
  mix(b, bandpass(noiseLayer(L + 0.3, (t) => 0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 17)), 350, 3800), 0, 0.9);
  mix(b, crackle(L + 0.3, 3500, () => 1, 900, 6500), 0, 1.4);
  mix(b, lowpass(noiseLayer(L + 0.3, () => 0.8), 200, 2), 0, 0.8);
  return normalize(loopify(b, 0.3), 0.65);
}
/** M72 rocket in flight (loop): the motor is spent — only air tearing past the body and fins. */
function rocketWhoosh() {
  const L = 1.4;
  const b = len(L + 0.3);
  mix(b, bandpass(noiseLayer(L + 0.3, (t) => 0.8 + 0.2 * Math.sin(t * 2 * Math.PI * 9)), 900, 5200), 0, 1.0);
  mix(b, bandpass(noiseLayer(L + 0.3, () => 0.6), 2600, 3400), 0, 0.5);
  mix(b, lowpass(noiseLayer(L + 0.3, () => 0.5), 300, 2), 0, 0.4);
  return normalize(loopify(b, 0.3), 0.4);
}
/**
 * A warhead going off: a harder crack and a deeper, longer boom than a grenade, the shock rolling
 * off the surroundings, then dirt, gravel and scrap raining down for a couple of seconds.
 */
function rocketBlast() {
  const out = len(4.4);
  const p = r(0.94, 1.04);
  mix(out, noiseLayer(0.01, ex(0.0025)), 0, 2.4);
  mix(out, highpass(noiseLayer(0.1, ex(0.015)), 800), 0, 1.7);
  const boom = len(1.6);
  mix(boom, toneLayer(1.4, (t) => (26 + 100 * Math.exp(-t / 0.06)) * p, attackDecay(0.002, 0.32)), 0, 2.6);
  mix(boom, toneLayer(0.6, (t) => (55 + 60 * Math.exp(-t / 0.03)) * p, ex(0.11)), 0, 1.0);
  mix(boom, lowpass(noiseLayer(1.2, ex(0.16)), 1300, 2), 0.002, 2.1);
  mix(out, boom, 0, 1);
  mix(out, crackle(0.6, 1800, (t) => Math.exp(-t / 0.12), 500, 5000), 0.003, 0.9);
  echo(out, boom, 0.24 * p, 0.42, 700);
  echo(out, boom, 0.61 * p, 0.25, 450);
  echo(out, boom, 1.05 * p, 0.12, 350);
  mix(out, lowpass(noiseLayer(4.4, attackDecay(0.06, 1.3)), 120, 2), 0.02, 1.6);
  // debris coming down: gravel patter and a few metal pings
  for (let i = 0; i < 60; i++) mix(out, bandpass(noiseLayer(0.02, ex(0.004)), 900, 5500), 0.35 + Math.pow(Math.random(), 1.5) * 2.4, r(0.03, 0.14));
  for (let i = 0; i < 8; i++) mix(out, ring(0.1, [r(1800, 4200), r(4800, 7000)], 0.012), r(0.5, 2.4), r(0.02, 0.06));
  return fade(normalize(softclip(out, 3.0), 0.98), 0.0003, 0.7);
}
/**
 * Base alarm (loop): a PA klaxon heard through the building — a one-second two-tone horn blast
 * (a minor third, slightly sour, with a small pitch "lift" as the horn spins up), then a pause with
 * the blast coming back off the far walls. 2.4 s per blast; low and band-limited so it carries
 * without drilling into the ear.
 */
function siren() {
  const P = 2.4;
  const L = P * 2;
  const n = Math.floor(L * SR);
  const dry = new Float32Array(n);
  let p1 = 0, p2 = 0;
  for (let k = 0; k < 2; k++) {
    const o = Math.floor(k * P * SR);
    const blast = Math.floor(1.05 * SR);
    for (let i = 0; i < blast; i++) {
      const t = i / SR;
      const env = Math.min(1, t / 0.05) * Math.min(1, (1.05 - t) / 0.12);
      const lift = 1 - 0.06 * Math.exp(-t / 0.09);
      p1 += (2 * Math.PI * 233 * lift) / SR;
      p2 += (2 * Math.PI * 277 * lift) / SR;
      // reedy horn: a few odd harmonics on each tone
      const h = (ph: number) => Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.28 * Math.sin(3 * ph) + 0.12 * Math.sin(5 * ph);
      dry[o + i] = (h(p1) + 0.8 * h(p2)) * env;
    }
  }
  bandpass(dry, 160, 1900);
  // the building answers: two late, darker reflections, wrapped round so the loop is seamless
  const out = Float32Array.from(dry);
  for (const [d, g, fc] of [[0.32, 0.32, 1100], [0.71, 0.18, 800]] as const) {
    const e = lowpass(Float32Array.from(dry), fc, 2);
    const off = Math.floor(d * SR);
    for (let i = 0; i < n; i++) out[(i + off) % n] += e[i] * g;
  }
  return normalize(softclip(out, 1.2), 0.5);
}
/** Launcher reload: tube slid onto the shoulder, latch, cover snap. */
function rocketLoad() {
  const out = len(0.9);
  mix(out, bandpass(noiseLayer(0.35, (t) => Math.sin(Math.min(1, t / 0.35) * Math.PI)), 300, 2400), 0, 0.6);
  mix(out, ring(0.12, [r(900, 1300), r(2100, 2800), r(3600, 4400)], 0.03), 0.36, 0.7);
  mix(out, toneLayer(0.1, (t) => 140 * Math.exp(-t / 0.03) + 70, ex(0.03)), 0.36, 0.8);
  mix(out, ring(0.08, [r(2600, 3400), r(5200, 6400)], 0.012), 0.62, 0.45);
  return fade(normalize(out, 0.8), 0.002, 0.05);
}
/** A window shattering: a sharp crack, a burst of bright noise and shards tinkling down. */
function glassBreak() {
  const out = len(1.4);
  mix(out, highpass(noiseLayer(0.02, ex(0.004)), 1800), 0, 1.4);
  mix(out, bandpass(noiseLayer(0.35, ex(0.08)), 2500, 9000), 0.003, 1.0);
  for (let i = 0; i < 26; i++) mix(out, ring(0.12, [r(3500, 6000), r(6500, 9500)], r(0.015, 0.04)), r(0.02, 1.1) ** 1.3, r(0.06, 0.22));
  for (let i = 0; i < 10; i++) mix(out, highpass(noiseLayer(0.03, ex(0.006)), 3000), r(0.15, 1.2), r(0.08, 0.2));
  return fade(normalize(softclip(out, 1.4), 0.85), 0.0005, 0.15);
}
/** Door: latch click, then a short hinge creak as it swings. */
function doorOpen() {
  const out = len(0.9);
  mix(out, ring(0.05, [r(1800, 2400), r(3600, 4400)], 0.01), 0, 0.5);
  mix(out, bandpass(noiseLayer(0.06, ex(0.012)), 900, 3500), 0, 0.35);
  // creak: a slowly rising squeak with flutter
  mix(out, toneLayer(0.55, (t) => r(380, 460) + t * 260 + Math.sin(t * 90) * 18, (t) => Math.sin(Math.min(1, t / 0.55) * Math.PI) * 0.6), 0.08, 0.22);
  mix(out, bandpass(noiseLayer(0.5, (t) => Math.sin(Math.min(1, t / 0.5) * Math.PI)), 300, 1400), 0.08, 0.25);
  return fade(normalize(out, 0.6), 0.001, 0.08);
}
/** Door swinging shut: a wooden thud and the latch. */
function doorShut() {
  const out = len(0.5);
  mix(out, toneLayer(0.2, (t) => 85 * Math.exp(-t / 0.04) + 60, ex(0.05)), 0, 1.2);
  mix(out, lowpass(noiseLayer(0.12, ex(0.02)), 900, 2), 0, 0.9);
  mix(out, ring(0.06, [r(1900, 2500), r(3800, 4600)], 0.012), 0.015, 0.4);
  return fade(normalize(softclip(out, 1.5), 0.8), 0.001, 0.06);
}
/** A steel door kicked in: the boot on the plate, the lock tearing, the slab slamming the wall. */
function doorKick() {
  const out = len(1.6);
  mix(out, toneLayer(0.25, (t) => 70 * Math.exp(-t / 0.06) + 42, ex(0.08)), 0, 1.6);
  mix(out, lowpass(noiseLayer(0.18, ex(0.03)), 1200, 2), 0, 1.2);
  mix(out, ring(0.5, [r(420, 520), r(880, 1020), r(1700, 1900), r(2600, 2900)], 0.18), 0.005, 0.7);
  mix(out, highpass(noiseLayer(0.05, ex(0.01)), 2500), 0.01, 0.5); // the lock
  // the slab hits the wall
  mix(out, toneLayer(0.3, (t) => 60 * Math.exp(-t / 0.05) + 38, ex(0.1)), 0.23, 1.4);
  mix(out, ring(0.9, [r(300, 360), r(610, 700), r(1250, 1400)], 0.35), 0.23, 0.6);
  mix(out, lowpass(noiseLayer(0.6, ex(0.25)), 600, 2), 0.24, 0.5); // dust and rattle
  return fade(normalize(softclip(out, 1.8), 0.95), 0.001, 0.2);
}
/** Heavy boots approaching down a concrete corridor: six slow steps, getting louder. */
function bossSteps() {
  const out = len(2.4);
  for (let i = 0; i < 6; i++) {
    const t = i * 0.38;
    const g = 0.35 + i * 0.13;
    mix(out, lowpass(noiseLayer(0.12, ex(0.03)), 500, 2), t, g);
    mix(out, toneLayer(0.08, () => 58, ex(0.03)), t, g * 0.9);
  }
  return echo(Float32Array.from(normalize(out, 0.7)), out, 0.09, 0.25, 900);
}
/** An electric motor driving a heavy gate / blast door: hum, gear whine, a clunk at each end. */
function gateMotor() {
  const L = 3.6;
  const out = len(L);
  mix(out, doorShut(), 0, 0.6);
  mix(out, toneLayer(L - 0.4, (t) => 95 + 6 * Math.sin(t * 7), (t) => Math.min(1, t / 0.2) * Math.min(1, (L - 0.4 - t) / 0.3)), 0.15, 0.45);
  mix(out, bandpass(noiseLayer(L - 0.4, (t) => Math.min(1, t / 0.3) * Math.min(1, (L - 0.4 - t) / 0.3)), 600, 2400), 0.15, 0.3);
  mix(out, toneLayer(L - 0.4, (t) => 880 + 40 * Math.sin(t * 3), (t) => 0.25 * Math.min(1, t / 0.3) * Math.min(1, (L - 0.4 - t) / 0.3)), 0.15, 0.15);
  mix(out, doorShut(), L - 0.3, 0.8);
  return fade(normalize(out, 0.75), 0.002, 0.1);
}
/** The lift going down: brake release, a long falling motor tone, cable rattle, the stop. */
function liftRide() {
  const L = 3.2;
  const out = len(L);
  mix(out, doorShut(), 0, 0.5);
  mix(out, toneLayer(L - 0.5, (t) => 120 - t * 14, (t) => Math.min(1, t / 0.3) * Math.min(1, (L - 0.5 - t) / 0.4)), 0.2, 0.5);
  mix(out, bandpass(noiseLayer(L - 0.5, (t) => 0.6 + 0.4 * Math.sin(t * 23)), 300, 1600), 0.2, 0.35);
  mix(out, doorShut(), L - 0.35, 1.0);
  return fade(normalize(out, 0.7), 0.002, 0.1);
}
/** A terminal accepting a login: three beeps and a confirm chirp. */
function terminalBeep() {
  const out = len(0.9);
  for (let i = 0; i < 3; i++) mix(out, toneLayer(0.07, () => 1800 + i * 200, (t) => (t < 0.06 ? 1 : 0)), i * 0.12, 0.35);
  mix(out, toneLayer(0.22, (t) => 1400 + t * 3000, (t) => Math.sin((t / 0.22) * Math.PI)), 0.45, 0.4);
  return fade(normalize(out, 0.5));
}
/** The bunker's air: ventilation rumble, a transformer hum, faint machinery (loop). */
function bunkerHum() {
  const L = 6;
  const b = len(L);
  mix(b, lowpass(noiseLayer(L, () => 1), 220, 2), 0, 1);
  mix(b, toneLayer(L, () => 50, () => 0.35), 0, 1);
  mix(b, toneLayer(L, () => 100, () => 0.18), 0, 1);
  mix(b, bandpass(noiseLayer(L, (t) => 0.2 + 0.15 * Math.sin(t * 1.3)), 900, 2600), 0, 0.4);
  return normalize(loopify(b, 0.5), 0.5);
}
/** Knife slash through the air: thin, fast swish with a blade ring. */
function knifeSlash() {
  const out = len(0.28);
  const p = r(0.92, 1.12);
  mix(out, bandpass(noiseLayer(0.22, (t) => Math.sin(Math.min(1, t / 0.22) * Math.PI) ** 2.2), 1400 * p, 6500 * p), 0, 1);
  mix(out, ring(0.12, [r(5200, 6400), r(7600, 9000)], 0.03), 0.01, 0.05);
  return fade(normalize(out, 0.5), 0.004, 0.03);
}
/** Blade into a body: wet stab, cloth tear, dull thud. */
function knifeStab() {
  const out = len(0.4);
  mix(out, lowpass(noiseLayer(0.09, ex(0.022)), 1100, 2), 0, 1.1);
  mix(out, toneLayer(0.12, (t) => 120 * Math.exp(-t / 0.03) + 60, ex(0.035)), 0, 0.9);
  mix(out, bandpass(noiseLayer(0.14, attackDecay(0.01, 0.05)), 700, 3200), 0.01, 0.6);
  mix(out, highpass(noiseLayer(0.05, ex(0.012)), 3000), 0.0, 0.3);
  return fade(normalize(softclip(out, 1.6), 0.85), 0.001, 0.08);
}
/** Blade on concrete / metal: scrape and clink. */
function knifeWall() {
  const out = len(0.35);
  mix(out, ring(0.25, [r(2400, 3000), r(4300, 5200), r(6800, 7600)], 0.05), 0, 0.6);
  mix(out, highpass(noiseLayer(0.12, ex(0.03)), 2200), 0, 0.5);
  return fade(normalize(out, 0.6), 0.001, 0.06);
}

// ---------------------------------------------------------------- ambience loops
function loopify(b: Buf, xfadeSec: number) {
  const n = Math.floor(xfadeSec * SR);
  const outLen = b.length - n;
  const out = new Float32Array(outLen);
  out.set(b.subarray(0, outLen));
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = b[outLen + i] * (1 - t) + b[i] * t;
  }
  return out;
}
function surf() {
  const L = 16;
  const b = len(L + 1);
  // swells at multiples of 1/L Hz so the loop is periodic
  const env = (t: number) => {
    const w = 0.5 + 0.5 * Math.sin((2 * Math.PI * 2 * t) / L) * 0.7 + 0.3 * Math.sin((2 * Math.PI * 3 * t) / L + 1.3);
    return 0.25 + 0.75 * Math.pow(Math.max(0, w), 2.2);
  };
  for (let i = 0; i < b.length; i++) b[i] = noise() * env(i / SR);
  const rumble = lowpass(Float32Array.from(b), 260, 2);
  const hiss = bandpass(Float32Array.from(b), 900, 3800);
  for (let i = 0; i < b.length; i++) b[i] = rumble[i] * 1.6 + hiss[i] * 0.22;
  return normalize(loopify(b, 1), 0.6);
}
function wind() {
  const L = 12;
  const b = len(L + 1);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    b[i] = noise() * (0.5 + 0.35 * Math.sin((2 * Math.PI * t) / L) + 0.15 * Math.sin((2 * Math.PI * 3 * t) / L));
  }
  bandpass(b, 250, 900);
  return normalize(loopify(b, 1), 0.5);
}

const RECIPES: Record<string, [() => Buf, number]> = {
  rifleShot: [rifleShot, 4],
  m4Shot: [rifleShot, 4],
  m5Shot: [m5Shot, 4],
  vectorShot: [vectorShot, 4],
  rifleTail: [rifleTail, 2],
  akTail: [akTail, 2],
  m5Tail: [m5Tail, 2],
  smgTail: [smgTail, 2],
  pistolTail: [pistolTail, 2],
  m4MagOut: [m4MagOut, 2],
  m4MagIn: [m4MagIn, 2],
  m4Bolt: [m4Bolt, 2],
  akMagOut: [akMagOut, 2],
  akMagIn: [akMagIn, 2],
  akBolt: [akBolt, 2],
  polyMagOut: [polyMagOut, 2],
  polyMagIn: [polyMagIn, 2],
  m5Bolt: [m5Bolt, 2],
  vsskMagOut: [vsskMagOut, 2],
  vsskMagIn: [vsskMagIn, 2],
  vsskBolt: [vsskBolt, 2],
  vsskCycle: [vsskCycle, 2],
  pistolMagOut: [pistolMagOut, 2],
  pistolMagIn: [pistolMagIn, 2],
  slideRelease: [slideRelease, 2],
  vectorMagOut: [vectorMagOut, 2],
  vectorMagIn: [vectorMagIn, 2],
  vectorBolt: [vectorBolt, 2],
  pinPull: [pinPull, 2],
  spoon: [spoon, 2],
  grenadeThrow: [grenadeThrow, 2],
  grenadeBounce: [grenadeBounce, 3],
  flashBang: [flashBang, 2],
  fragBoom: [fragBoom, 2],
  fireIgnite: [fireIgnite, 1],
  fireLoop: [fireLoop, 1],
  plasmaHum: [plasmaHum, 1],
  plasmaStick: [plasmaStick, 1],
  plasmaBlast: [plasmaBlast, 2],
  akShot: [akShot, 4],
  pistolShot: [pistolShot, 4],
  suppressedShot: [suppressedShot, 3],

  enemyShot: [enemyShot, 4],

  magOut: [magOut, 2],
  magIn: [magIn, 2],
  boltRelease: [boltRelease, 2],

  dryFire: [dryFire, 1],
  foley: [foley, 3],
  weaponSwitch: [weaponSwitch, 2],
  hitMarker: [hitMarker, 1],
  hitHead: [hitHead, 2],
  killConfirm: [killConfirm, 1],
  fleshHit: [fleshHit, 3],
  impactConcrete: [impactConcrete, 3],
  impactMetal: [impactMetal, 3],
  ricochet: [ricochet, 3],
  casing: [casing, 5],
  shellDrop: [shellDrop, 3],
  footstep: [footstep, 6],
  land: [land, 2],
  playerHurt: [playerHurt, 3],
  bulletWhiz: [bulletWhiz, 3],
  bodyFall: [bodyFall, 2],
  meleeSwing: [meleeSwing, 3],
  m72Launch: [m72Launch, 2],
  dzjLaunch: [dzjLaunch, 2],
  rocketMotor: [rocketMotor, 1],
  rocketWhoosh: [rocketWhoosh, 1],
  rocketBlast: [rocketBlast, 2],
  rocketLoad: [rocketLoad, 2],
  siren: [siren, 1],
  doorKick: [doorKick, 1],
  bossSteps: [bossSteps, 1],
  gateMotor: [gateMotor, 1],
  liftRide: [liftRide, 1],
  terminalBeep: [terminalBeep, 1],
  bunkerHum: [bunkerHum, 1],
  knifeSlash: [knifeSlash, 3],
  glassBreak: [glassBreak, 3],
  doorOpen: [doorOpen, 3],
  doorShut: [doorShut, 2],
  knifeStab: [knifeStab, 3],
  knifeWall: [knifeWall, 2],
  meleeHit: [meleeHit, 3],
  weaponDrop: [weaponDrop, 2],
  radioChirp: [radioChirp, 3],
  surf: [surf, 1],
  wind: [wind, 1],
  hulkRoar: [hulkRoar, 2],
  hulkSlam: [hulkSlam, 2],
  hulkPunch: [hulkPunch, 3],
  hulkStep: [hulkStep, 3],
  hulkIncoming: [hulkIncoming, 1],
  hulkLeap: [hulkLeap, 2],
  hulkClap: [hulkClap, 2],
  webShoot: [webShoot, 3],
  webHit: [webHit, 2],
  webZip: [webZip, 2],
  swingWhoosh: [swingWhoosh, 2],
  heatBeam: [heatBeam, 1],
  frostBreath: [frostBreath, 1],
  sonicBoom: [sonicBoom, 2],
  iceFreeze: [iceFreeze, 2],
  iceShatter: [iceShatter, 3],
  superPunch: [superPunch, 3],
  carEngine: [carEngine, 1],
  carSkid: [carSkid, 1],
  batarang: [batarang, 2],
  smokePop: [smokePop, 1],
  thrustLoop: [thrustLoop, 1],
  repulsorFire: [repulsorFire, 3],
  repulsorCharge: [repulsorCharge, 1],
  unibeam: [unibeam, 1],
  ironClank: [ironClank, 2],
  servo: [servo, 3],
};


// ---------------------------------------------------------------- the Hulk
/**
 * A roar: a huge, rough voice — a low buzzing fundamental that rises as the roar opens and sags at
 * the end, its harmonics shaped by an open-mouth formant, and a rasp (noise gated by the buzz:
 * the growl) over it, then a chest rumble under it all.
 */
function hulkRoar() {
  const T = 2.6;
  const out = len(T);
  const p = r(0.92, 1.06);
  const env = (t: number) => (t < 0.18 ? t / 0.18 : t < 1.9 ? 1 - (t - 0.18) * 0.12 : Math.max(0, (1 - 0.21) * (1 - (t - 1.9) / 0.7)));
  const pitch = (t: number) => (62 + 34 * Math.sin(Math.min(1, t / 0.5) * Math.PI * 0.5) - 18 * Math.max(0, t - 1.6)) * p;
  const buzz = len(T), rasp = len(T);
  let ph = 0;
  for (let i = 0; i < buzz.length; i++) {
    const t = i / SR;
    // a voice wobbles: slow vibrato and a little roughness in the period
    ph += (2 * Math.PI * pitch(t) * (1 + 0.025 * Math.sin(t * 31) + 0.02 * noise())) / SR;
    let v = 0;
    for (let k = 1; k <= 24; k++) v += Math.sin(k * ph) / k;
    buzz[i] = v * env(t);
    rasp[i] = noise() * (0.35 + 0.65 * Math.max(0, Math.sin(ph))) * env(t);
  }
  mix(out, bandpass(buzz.slice(), 160, 1300), 0, 1.4);
  mix(out, bandpass(buzz.slice(), 600, 2600), 0, 0.5);
  mix(out, lowpass(buzz, 220, 2), 0, 0.9);
  mix(out, bandpass(rasp, 350, 3200), 0, 0.9);
  mix(out, lowpass(noiseLayer(T, (t) => env(t) * 0.8), 110, 2), 0, 1.2);
  return fade(normalize(softclip(out, 2.4), 0.98), 0.01, 0.35);
}
/**
 * Something enormous falling out of the sky at you: air tearing past, rising in pitch and loudness
 * as it comes down (a filtered rush with a sweeping band), a rumble swelling under it.
 */
function hulkIncoming() {
  const T = 2.4;
  const out = len(T);
  const rush = noiseLayer(T, (t) => Math.pow(t / T, 1.6));
  // a band that sweeps up as it nears: done in slices (each slice its own band-pass)
  const slices = 24;
  for (let k = 0; k < slices; k++) {
    const a = k / slices, b = (k + 1) / slices;
    const seg = rush.slice(Math.floor(a * rush.length), Math.floor(b * rush.length));
    const fc = 180 + 1800 * Math.pow(a, 1.4);
    mix(out, bandpass(seg, fc * 0.6, fc * 1.5), a * T, 1.2);
  }
  mix(out, lowpass(noiseLayer(T, (t) => Math.pow(t / T, 2.2)), 120, 2), 0, 1.6);
  return fade(normalize(out, 0.85), 0.2, 0.03);
}
/** A short rush of air: him springing into a leap */
function hulkLeap() {
  const out = len(0.9);
  mix(out, bandpass(noiseLayer(0.9, attackDecay(0.12, 0.25)), 250, 1600), 0, 1.2);
  mix(out, toneLayer(0.4, (t) => 45 + 30 * Math.exp(-t / 0.05), ex(0.12)), 0, 0.9);
  return fade(normalize(out, 0.8), 0.01, 0.2);
}
/** The thunderclap: a crack like a gunshot the size of a building, then a booming wall of air. */
function hulkClap() {
  const out = len(3.2);
  const p = r(0.95, 1.05);
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 1500), 0, 2.4);
  mix(out, bandpass(noiseLayer(0.12, ex(0.03)), 400, 5000), 0, 1.8);
  mix(out, toneLayer(1.4, (t) => (34 + 90 * Math.exp(-t / 0.04)) * p, attackDecay(0.002, 0.45)), 0, 2.6);
  mix(out, lowpass(noiseLayer(3.2, attackDecay(0.02, 0.9)), 260, 2), 0.01, 2.0);
  mix(out, bandpass(noiseLayer(2.0, attackDecay(0.08, 0.5)), 200, 1400), 0.05, 0.9);
  return fade(normalize(softclip(out, 2.8), 0.99), 0.0003, 0.8);
}
/** His weight landing (a leap, a smash): a deep thud, cracking ground, debris settling. */
function hulkSlam() {
  const out = len(2.4);
  const p = r(0.9, 1.08);
  mix(out, toneLayer(1.2, (t) => (26 + 80 * Math.exp(-t / 0.05)) * p, attackDecay(0.003, 0.32)), 0, 2.8);
  mix(out, lowpass(noiseLayer(0.6, ex(0.09)), 900, 2), 0, 2.0);
  mix(out, lowpass(noiseLayer(2.4, attackDecay(0.04, 0.7)), 180, 2), 0.01, 1.6);
  for (let i = 0; i < 22; i++) mix(out, bandpass(noiseLayer(0.03, ex(0.006)), 700, 4200), r(0.02, 0.6), r(0.05, 0.2));
  for (let i = 0; i < 30; i++) mix(out, highpass(noiseLayer(0.012, ex(0.003)), 2500), r(0.3, 2.0), r(0.02, 0.07));
  return fade(normalize(softclip(out, 2.6), 0.98), 0.0005, 0.5);
}
/** A giant fist landing (on you) */
function hulkPunch() {
  const out = len(0.6);
  const p = r(0.85, 1.1);
  mix(out, toneLayer(0.35, (t) => (55 + 140 * Math.exp(-t / 0.02)) * p, ex(0.08)), 0, 1.8);
  mix(out, lowpass(noiseLayer(0.25, ex(0.04)), 1400, 2), 0, 1.4);
  mix(out, bandpass(noiseLayer(0.05, ex(0.01)), 1500, 5000), 0, 0.5);
  return fade(normalize(softclip(out, 2.2), 0.95), 0.0005, 0.2);
}
/** A heavy footfall */
function hulkStep() {
  const out = len(0.5);
  mix(out, toneLayer(0.4, (t) => 38 + 50 * Math.exp(-t / 0.03), ex(0.09)), 0, 1.6);
  mix(out, lowpass(noiseLayer(0.3, ex(0.05)), 500, 2), 0, 1.0);
  return fade(normalize(out, 0.9), 0.001, 0.15);
}

// ---------------------------------------------------------------- Spider-Man's webs
/** "thwip": a fast hiss of web leaving the shooter, a tiny mechanical click under it */
function webShoot() {
  const out = len(0.22);
  const p = r(0.92, 1.1);
  // the hiss sweeps down as the line pays out
  const hiss = noiseLayer(0.16, (t) => Math.exp(-t / 0.05) * Math.min(1, t / 0.004));
  mix(out, bandpass(hiss, 2200 * p, 7500 * p), 0, 1);
  mix(out, toneLayer(0.05, (t) => (2400 - 9000 * t) * p, ex(0.012)), 0, 0.25);
  mix(out, highpass(noiseLayer(0.01, ex(0.002)), 4000), 0, 0.5);
  return fade(normalize(out, 0.6), 0.001, 0.04);
}
/** web landing on something: a wet slap */
function webHit() {
  const out = len(0.2);
  mix(out, lowpass(noiseLayer(0.12, ex(0.025)), 1800, 2), 0, 1);
  mix(out, toneLayer(0.06, (t) => 180 * Math.exp(-t / 0.03) + 90, ex(0.02)), 0, 0.5);
  return fade(normalize(out, 0.55), 0.001, 0.05);
}
/** a web line snapping taut and pulling: a short rising zip */
function webZip() {
  const out = len(0.4);
  const p = r(0.9, 1.1);
  mix(out, bandpass(noiseLayer(0.35, (t) => Math.sin(Math.min(1, t / 0.35) * Math.PI)), 900 * p, 4200 * p), 0, 0.8);
  mix(out, toneLayer(0.3, (t) => (300 + 900 * t) * p, (t) => 0.3 * Math.sin(Math.min(1, t / 0.3) * Math.PI)), 0, 0.3);
  return fade(normalize(out, 0.5), 0.01, 0.08);
}
/** air rushing past at the bottom of a swing */
function swingWhoosh() {
  const out = len(0.9);
  const p = r(0.85, 1.1);
  mix(out, bandpass(noiseLayer(0.85, (t) => Math.sin(Math.min(1, t / 0.85) * Math.PI) ** 1.6), 300 * p, 1600 * p), 0, 1);
  mix(out, lowpass(noiseLayer(0.85, (t) => Math.sin(Math.min(1, t / 0.85) * Math.PI) ** 2), 400), 0, 0.6);
  return fade(normalize(out, 0.5), 0.05, 0.15);
}

// ---------------------------------------------------------------- Iron Man
/** the boot thrusters: a jet's roar (loops — the loop's start and end are the same noise floor) */
function thrustLoop() {
  const out = len(2);
  mix(out, lowpass(noiseLayer(2, () => 1), 900, 2), 0, 1);
  mix(out, bandpass(noiseLayer(2, () => 0.6), 1200, 5200), 0, 0.35);
  // a low burner rumble with a slow flutter
  mix(out, toneLayer(2, () => 62, (t) => 0.25 + 0.1 * Math.sin(t * 2 * Math.PI * 7)), 0, 0.5);
  return normalize(out, 0.7);
}
/** a repulsor shot: a bright zap with a pressure thump under it */
function repulsorFire() {
  const out = len(0.45);
  const p = r(0.92, 1.08);
  mix(out, toneLayer(0.18, (t) => (1800 * Math.exp(-t / 0.03) + 240) * p, ex(0.05)), 0, 0.6);
  mix(out, toneLayer(0.25, (t) => 70 + 120 * Math.exp(-t / 0.02), ex(0.08)), 0, 1.0);
  mix(out, bandpass(noiseLayer(0.3, ex(0.06)), 1500, 8000), 0, 0.55);
  return fade(normalize(softclip(out, 1.6), 0.85), 0.0008, 0.12);
}
/** the palm (or the chest) charging: a whine rising in pitch */
function repulsorCharge() {
  const out = len(1.0);
  mix(out, toneLayer(0.95, (t) => 300 + 2600 * t * t, (t) => Math.min(1, t * 3) * 0.6), 0, 0.6);
  mix(out, toneLayer(0.95, (t) => 600 + 5200 * t * t, (t) => Math.min(1, t * 2) * 0.25), 0, 0.3);
  mix(out, bandpass(noiseLayer(0.95, (t) => t), 2000, 7000), 0, 0.2);
  return fade(normalize(out, 0.55), 0.02, 0.05);
}
/** the unibeam: a roaring beam with a high energy whine, 1.5 s */
function unibeam() {
  const out = len(1.7);
  const env = (t: number) => Math.min(1, t / 0.05) * (t > 1.4 ? Math.max(0, 1 - (t - 1.4) / 0.3) : 1);
  mix(out, lowpass(noiseLayer(1.7, env), 1400, 2), 0, 1);
  mix(out, toneLayer(1.7, (t) => 110 + 8 * Math.sin(t * 40), (t) => env(t) * 0.6), 0, 0.7);
  mix(out, toneLayer(1.7, (t) => 2200 + 200 * Math.sin(t * 13), (t) => env(t) * 0.15), 0, 0.3);
  return fade(normalize(softclip(out, 1.4), 0.85), 0.005, 0.1);
}
/** armour meeting the ground (or the Hulk): a heavy metal clank */
function ironClank() {
  const out = len(0.7);
  mix(out, toneLayer(0.3, (t) => 70 + 90 * Math.exp(-t / 0.03), ex(0.09)), 0, 1.2);
  mix(out, ring(0.6, [r(420, 520), r(1100, 1350), r(2300, 2700)], 0.12), 0, 0.35);
  mix(out, lowpass(noiseLayer(0.2, ex(0.04)), 2500, 2), 0, 0.6);
  return fade(normalize(out, 0.9), 0.0005, 0.15);
}
/** an armour servo: a short mechanical whirr */
function servo() {
  const out = len(0.3);
  const f0 = r(500, 800);
  mix(out, toneLayer(0.28, (t) => f0 + 900 * t, (t) => Math.sin(Math.min(1, t / 0.28) * Math.PI) * 0.4), 0, 0.6);
  mix(out, bandpass(noiseLayer(0.28, (t) => Math.sin(Math.min(1, t / 0.28) * Math.PI)), 2500, 6000), 0, 0.15);
  return fade(normalize(out, 0.35), 0.01, 0.05);
}

// ---------------------------------------------------------------- Superman, Batman, the Batmobile
/** heat vision: a searing electric buzz with a sizzle on top (loops) */
function heatBeam() {
  const out = len(1.6);
  mix(out, toneLayer(1.6, (t) => 96 + 6 * Math.sin(t * 31), () => 0.5), 0, 0.8);
  mix(out, toneLayer(1.6, (t) => 192 + 9 * Math.sin(t * 23), () => 0.3), 0, 0.5);
  mix(out, bandpass(noiseLayer(1.6, (t) => 0.6 + 0.4 * Math.sin(t * 90) ** 2), 2500, 9000), 0, 0.4);
  mix(out, lowpass(noiseLayer(1.6, () => 1), 700, 2), 0, 0.5);
  return normalize(softclip(out, 1.8), 0.75);
}
/** freeze breath: a rushing, icy hiss (loops) */
function frostBreath() {
  const out = len(1.8);
  mix(out, bandpass(noiseLayer(1.8, (t) => 0.75 + 0.25 * Math.sin(t * 5.3)), 1800, 9500), 0, 1);
  mix(out, lowpass(noiseLayer(1.8, () => 1), 500, 2), 0, 0.5);
  for (let i = 0; i < 40; i++) mix(out, ring(0.05, [r(5000, 9000)], 0.01), r(0, 1.75), r(0.03, 0.09));
  return normalize(out, 0.7);
}
/** a sonic boom: a hard double crack and a long rolling thunder */
function sonicBoom() {
  const out = len(2.6);
  mix(out, toneLayer(0.5, (t) => 40 + 160 * Math.exp(-t / 0.03), ex(0.12)), 0, 2.2);
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 800), 0, 1.6);
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 800), 0.09, 1.3);
  mix(out, lowpass(noiseLayer(2.5, attackDecay(0.02, 0.8)), 260, 2), 0.02, 2.0);
  mix(out, bandpass(noiseLayer(1.2, ex(0.3)), 400, 2600), 0.01, 0.5);
  return fade(normalize(softclip(out, 2.4), 0.98), 0.0005, 0.6);
}
/** ice forming fast: crackles and a glassy creak */
function iceFreeze() {
  const out = len(0.9);
  for (let i = 0; i < 34; i++) mix(out, highpass(noiseLayer(0.015, ex(0.003)), 2500), r(0, 0.7) ** 1.2, r(0.1, 0.4));
  mix(out, toneLayer(0.7, (t) => 900 + 700 * t + Math.sin(t * 60) * 40, (t) => Math.sin(Math.min(1, t / 0.7) * Math.PI) * 0.3), 0.05, 0.4);
  mix(out, bandpass(noiseLayer(0.6, ex(0.25)), 3000, 9000), 0, 0.4);
  return fade(normalize(out, 0.75), 0.001, 0.1);
}
/** ice shattering: a crack, a burst of shards, the pieces falling */
function iceShatter() {
  const out = len(1.3);
  mix(out, toneLayer(0.2, (t) => 70 + 120 * Math.exp(-t / 0.02), ex(0.05)), 0, 1.0);
  mix(out, highpass(noiseLayer(0.03, ex(0.006)), 1500), 0, 1.4);
  mix(out, bandpass(noiseLayer(0.4, ex(0.1)), 2000, 8000), 0.003, 1.0);
  for (let i = 0; i < 30; i++) mix(out, ring(0.1, [r(2500, 5000), r(5500, 8500)], r(0.01, 0.04)), r(0.03, 1.1) ** 1.3, r(0.06, 0.25));
  return fade(normalize(softclip(out, 1.5), 0.9), 0.0005, 0.15);
}
/** a superhuman punch: a huge low thump, a crack, air torn */
function superPunch() {
  const out = len(1.2);
  mix(out, toneLayer(0.6, (t) => 34 + 180 * Math.exp(-t / 0.025), ex(0.15)), 0, 2.4);
  mix(out, lowpass(noiseLayer(0.4, ex(0.06)), 1800, 2), 0, 1.6);
  mix(out, highpass(noiseLayer(0.025, ex(0.005)), 1200), 0, 1.2);
  mix(out, bandpass(noiseLayer(1.0, ex(0.25)), 200, 1400), 0.02, 0.6);
  return fade(normalize(softclip(out, 2.6), 0.98), 0.0005, 0.3);
}
/** the Batmobile's engine: a deep turbine rumble with a growl (loops) */
function carEngine() {
  const out = len(2);
  mix(out, toneLayer(2, () => 46, (t) => 0.6 + 0.2 * Math.sin(t * 2 * Math.PI * 11)), 0, 1);
  mix(out, toneLayer(2, () => 92, (t) => 0.35 + 0.15 * Math.sin(t * 2 * Math.PI * 23)), 0, 0.6);
  mix(out, lowpass(noiseLayer(2, () => 1), 420, 2), 0, 0.9);
  mix(out, bandpass(noiseLayer(2, () => 0.5), 1800, 6000), 0, 0.12);
  return normalize(softclip(out, 1.8), 0.8);
}
/** tyres screaming in a power-slide */
function carSkid() {
  const out = len(1.6);
  const env = (t: number) => Math.min(1, t / 0.08) * Math.max(0, 1 - t / 1.6);
  mix(out, toneLayer(1.6, (t) => 820 + 120 * Math.sin(t * 17) - t * 140, env), 0, 0.5);
  mix(out, toneLayer(1.6, (t) => 1650 + 200 * Math.sin(t * 11), env), 0, 0.2);
  mix(out, bandpass(noiseLayer(1.6, env), 900, 4500), 0, 0.7);
  return fade(normalize(softclip(out, 1.4), 0.75), 0.01, 0.2);
}
/** a batarang: a fast spinning whirr past you */
function batarang() {
  const out = len(0.6);
  mix(out, bandpass(noiseLayer(0.6, (t) => Math.sin(Math.min(1, t / 0.6) * Math.PI) * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 38))), 1200, 5000), 0, 1);
  return fade(normalize(out, 0.55), 0.01, 0.08);
}
/** a smoke pellet: a pop and a long hiss */
function smokePop() {
  const out = len(1.4);
  mix(out, toneLayer(0.15, (t) => 140 * Math.exp(-t / 0.02) + 60, ex(0.04)), 0, 1.2);
  mix(out, bandpass(noiseLayer(1.4, attackDecay(0.02, 0.6)), 600, 4000), 0, 0.8);
  return fade(normalize(out, 0.7), 0.001, 0.3);
}

export async function buildSoundBank(sampleRate: number, onProgress?: (p: number) => void) {
  SR = sampleRate;
  const out: Record<string, Buf[]> = {};
  const names = Object.keys(RECIPES);
  for (let i = 0; i < names.length; i++) {
    const [fn, count] = RECIPES[names[i]];
    out[names[i]] = Array.from({ length: count }, fn);
    if (i % 4 === 3) {
      onProgress?.(i / names.length);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  return out;
}
