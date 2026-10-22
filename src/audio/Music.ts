/**
 * Procedural combat score for Frostline: a dark, driving military-thriller loop
 * (92 BPM, D minor, 16 bars ≈ 42 s, seamless) — braams, taiko, a snare backbeat,
 * a distorted pulsing bass and staccato strings.
 *
 *   sub drone   chord roots an octave down, slow swell
 *   pad         detuned saw strings, filter opening per chord (Dm Dm B♭ B♭ Gm Gm A A)
 *   ostinato    pulsing eighth-note bass with a plucked filter envelope
 *   taiko       low hits on 1 and the "and" of 3, a roll into every fourth bar
 *   clock       quiet ticking sixteenths (tension)
 *   strings     staccato sixteenth figure in the second half
 *   brass       a rising low swell over the last two bars back into the top
 *
 * Rendered once (a few hundred ms) when the stage loads, stereo, then looped.
 */

const BPM = 92;
const BARS = 16;
const BEAT = 60 / BPM;

// chord per 2 bars: [root (Hz, octave 1), pad notes (Hz)]
const CHORDS: [number, number[]][] = [
  [36.71, [146.83, 174.61, 220.0]], // Dm
  [36.71, [146.83, 174.61, 220.0]],
  [29.14, [116.54, 146.83, 174.61]], // B♭
  [29.14, [116.54, 146.83, 174.61]],
  [24.5, [98.0, 116.54, 146.83]], // Gm
  [24.5, [98.0, 116.54, 146.83]],
  [27.5, [110.0, 138.59, 164.81]], // A
  [27.5, [110.0, 138.59, 164.81]],
];
// bass ostinato: scale steps above the root (semitones) per eighth note
const OSTINATO = [0, 0, 12, 0, 0, 3, 0, 7];
// staccato strings: chord-tone index per sixteenth
const FIGURE = [2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 0, 1, 2];

export function composeOfficeTheme(sr: number): [Float32Array, Float32Array] {
  const loopLen = BARS * 4 * BEAT;
  const N = Math.floor(loopLen * sr);
  const tail = Math.floor(2.5 * sr);
  const L = new Float32Array(N + tail);
  const R = new Float32Array(N + tail);
  const barLen = 4 * BEAT;
  const chordAt = (t: number) => CHORDS[Math.min(CHORDS.length - 1, Math.floor(t / (barLen * 2)))];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  const lpA = (fc: number) => 1 - Math.exp((-2 * Math.PI * fc) / sr);

  // ---------------------------------------------------------------- pad + drone (continuous, chord crossfades)
  {
    const det = [-0.006, 0, 0.0055];
    const phases = new Float64Array(3 * 3);
    let yl = 0, yr = 0, yl2 = 0, yr2 = 0;
    let droneP = 0;
    for (let i = 0; i < N + tail; i++) {
      const t = (i % N) / sr;
      const seg = t / (barLen * 2);
      const ci = Math.floor(seg) % CHORDS.length;
      const local = (seg - Math.floor(seg)) * barLen * 2;
      const [root, notes] = CHORDS[ci];
      const [, prevNotes] = CHORDS[(ci + CHORDS.length - 1) % CHORDS.length];
      // smooth 0.9 s glide between chords
      const k = Math.min(1, local / 0.9);
      const env = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, local / (barLen * 2)));
      let sl = 0, sr2 = 0;
      for (let n = 0; n < 3; n++) {
        const f = prevNotes[n] + (notes[n] - prevNotes[n]) * k;
        for (let v = 0; v < 3; v++) {
          const idx = n * 3 + v;
          phases[idx] += (f * (1 + det[v])) / sr;
          const s = 2 * (phases[idx] - Math.floor(phases[idx])) - 1;
          if (v === 0) sl += s;
          else if (v === 2) sr2 += s;
          else {
            sl += s * 0.5;
            sr2 += s * 0.5;
          }
        }
      }
      // filter opens through each chord
      const fc = 420 + 900 * Math.min(1, local / (barLen * 1.4));
      const a = lpA(fc);
      yl += a * (sl - yl);
      yr += a * (sr2 - yr);
      yl2 += a * (yl - yl2);
      yr2 += a * (yr - yr2);
      // sub drone on the root (sine + a touch of octave)
      droneP += (root * 2) / sr;
      const dr = Math.sin(2 * Math.PI * droneP) * 0.8 + Math.sin(4 * Math.PI * droneP) * 0.2;
      L[i] += yl2 * 0.055 * env + dr * 0.16;
      R[i] += yr2 * 0.055 * env + dr * 0.16;
    }
  }

  // ---------------------------------------------------------------- notes / hits (one-shots)
  const addNote = (start: number, dur: number, gen: (t: number) => number, gl: number, gr: number) => {
    const s0 = Math.floor(start * sr);
    const n = Math.floor(dur * sr);
    for (let j = 0; j < n; j++) {
      const v = gen(j / sr);
      const i = s0 + j;
      if (i >= L.length) break;
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };

  const eighth = BEAT / 2;
  const sixteenth = BEAT / 4;
  for (let bar = 0; bar < BARS; bar++) {
    const b0 = bar * barLen;
    const [root, notes] = chordAt(b0 + 0.01);
    // ostinato bass: plucked saw, filter envelope, slight swing of accents
    for (let e = 0; e < 8; e++) {
      const st = b0 + e * eighth;
      const f = root * 2 * Math.pow(2, OSTINATO[e] / 12);
      const accent = e % 4 === 0 ? 1 : 0.7;
      let ph = 0, y = 0, y2 = 0;
      addNote(st, 0.34, (t) => {
        ph += f / sr;
        const s = 2 * (ph - Math.floor(ph)) - 1;
        const a = lpA(140 + 1700 * Math.exp(-t / 0.06));
        y += a * (s - y);
        y2 += a * (y - y2);
        return Math.tanh(y2 * 2.2) * Math.exp(-t / 0.16) * 0.26 * accent;
      }, 1, 1);
    }
    // taiko: 1 and the "and" of 3; a short roll before every fourth bar
    const hits = [0, 2.5 * BEAT];
    if (bar % 4 === 3) hits.push(3.25 * BEAT, 3.5 * BEAT, 3.75 * BEAT);
    for (const h of hits) {
      const big = h === 0;
      let ph = 0;
      let nz = 0;
      addNote(b0 + h, 0.9, (t) => {
        const f = 42 + 70 * Math.exp(-t / 0.05);
        ph += f / sr;
        nz += lpA(900) * (rnd() - nz);
        return (Math.sin(2 * Math.PI * ph) * Math.exp(-t / (big ? 0.32 : 0.18)) + nz * Math.exp(-t / 0.03) * 0.6) * (big ? 0.5 : 0.32);
      }, 1, 1);
    }
    // snare backbeat (2 and 4): noise crack + body
    for (const beat of [1, 3]) {
      let lp = 0, ph = 0;
      addNote(b0 + beat * BEAT, 0.35, (t) => {
        lp += lpA(4500) * (rnd() - lp);
        ph += 190 / sr;
        return (lp * Math.exp(-t / 0.07) * 0.5 + Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.04) * 0.35) * (bar >= 4 ? 0.32 : 0.16);
      }, 0.9, 1);
    }
    // braam: a huge low brass blast at the top of every 4 bars
    if (bar % 4 === 0) {
      const fs = [root * 2, root * 3, root * 4, root * 4.02];
      const ph = [0, 0, 0, 0];
      let y = 0, y2 = 0;
      addNote(b0, 2.8, (t) => {
        let x = 0;
        for (let k = 0; k < fs.length; k++) {
          ph[k] += fs[k] / sr;
          x += 2 * (ph[k] - Math.floor(ph[k])) - 1;
        }
        const a = lpA(180 + 1300 * Math.exp(-t / 0.5));
        y += a * (Math.tanh(x * 1.6) - y);
        y2 += a * (y - y2);
        return y2 * Math.min(1, t / 0.04) * Math.exp(-t / 1.4) * 0.22;
      }, 1, 1);
    }
    // clock: ticking sixteenths, accented on the beat
    for (let s = 0; s < 16; s++) {
      let hp = 0, last = 0;
      const acc = s % 4 === 0 ? 1 : 0.45;
      addNote(b0 + s * sixteenth, 0.03, (t) => {
        const x = rnd();
        hp = 0.9 * (hp + x - last);
        last = x;
        return hp * Math.exp(-t / 0.006) * 0.035 * acc;
      }, s % 2 ? 0.6 : 1, s % 2 ? 1 : 0.6);
    }
    // second half: staccato strings
    if (bar >= 8) {
      for (let s = 0; s < 16; s++) {
        const f = notes[FIGURE[s]] * 2;
        let ph = 0, ph2 = 0, y = 0;
        addNote(b0 + s * sixteenth, 0.16, (t) => {
          ph += f / sr;
          ph2 += (f * 1.004) / sr;
          const x = 2 * (ph - Math.floor(ph)) - 1 + 2 * (ph2 - Math.floor(ph2)) - 1;
          y += lpA(2200) * (x - y);
          return y * Math.min(1, t / 0.008) * Math.exp(-t / 0.06) * 0.05;
        }, s % 2 ? 0.7 : 1, s % 2 ? 1 : 0.7);
      }
    }
  }
  // brass swell over the last two bars: low A fifth, filter rising, back into the loop
  {
    const st = (BARS - 2) * barLen;
    const dur = 2 * barLen + 0.6;
    const fs = [55, 82.41, 110];
    const ph = [0, 0, 0];
    let y = 0, y2 = 0;
    addNote(st, dur, (t) => {
      let x = 0;
      for (let k = 0; k < 3; k++) {
        ph[k] += fs[k] / sr;
        x += 2 * (ph[k] - Math.floor(ph[k])) - 1;
      }
      const prog = t / dur;
      const a = lpA(200 + 1400 * prog * prog);
      y += a * (x - y);
      y2 += a * (y - y2);
      return y2 * Math.min(1, t / 1.5) * (prog < 0.95 ? 1 : (1 - prog) / 0.05) * 0.09;
    }, 1, 1);
  }

  // ---------------------------------------------------------------- fold the tail into the start (seamless loop), master
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    outL[i] = L[i] + (i < tail ? L[N + i] : 0);
    outR[i] = R[i] + (i < tail ? R[N + i] : 0);
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const g = 0.9 / Math.max(1e-6, peak);
  for (let i = 0; i < N; i++) {
    outL[i] = Math.tanh(outL[i] * g * 1.2) * 0.85;
    outR[i] = Math.tanh(outR[i] * g * 1.2) * 0.85;
  }
  return [outL, outR];
}


/**
 * Main-menu theme: slow, cinematic, a little heroic (66 BPM, A minor, 16 bars ≈ 58 s, seamless):
 * a warm string pad over Am–F–C–G, a soft piano arpeggio, a deep pulse, timpani on the big
 * changes and a swell back into the top. A stereo echo gives it space.
 */
export function composeMenuTheme(sr: number): [Float32Array, Float32Array] {
  const bpm = 66;
  const beat = 60 / bpm;
  const bars = 16;
  const barLen = beat * 4;
  const N = Math.floor(bars * barLen * sr);
  const tail = Math.floor(3 * sr);
  const L = new Float32Array(N + tail);
  const R = new Float32Array(N + tail);
  // Am F C G (each 2 bars) twice; root (octave 1) + triad (octave 3)
  const chords: [number, number[]][] = [
    [55.0, [220.0, 261.63, 329.63]],
    [43.65, [174.61, 220.0, 261.63]],
    [65.41, [196.0, 261.63, 329.63]],
    [49.0, [196.0, 246.94, 293.66]],
  ];
  const chordAt = (t: number) => chords[Math.floor(t / (barLen * 2)) % chords.length];

  // pad + sub (continuous). Pure tones only: each chord note a sine with two soft overtones, gliding
  // into the next chord, a gentle swell per chord. (It was nine detuned saw waves through a filter
  // sweeping open and shut every two bars — no noise in it, but that beating, breathing whoosh is
  // the sound of wind, and over the title screen that's what everyone heard.)
  {
    const ph = new Float64Array(6);
    let sub = 0;
    for (let i = 0; i < N + tail; i++) {
      const t = (i % N) / sr;
      const seg = t / (barLen * 2);
      const local = (seg - Math.floor(seg)) * barLen * 2;
      const [root, notes] = chordAt(t);
      const [, prev] = chords[(Math.floor(seg) + chords.length - 1) % chords.length];
      const k = Math.min(1, local / 1.6);
      let sl = 0, sr2 = 0;
      for (let n = 0; n < 3; n++) {
        const f = prev[n] + (notes[n] - prev[n]) * k;
        // two voices a hair apart (0.1%: a slow shimmer, not a whoosh), one a side
        for (let v = 0; v < 2; v++) {
          const idx = n * 2 + v;
          ph[idx] += (f * (v ? 1.001 : 0.999)) / sr;
          const w = 2 * Math.PI * ph[idx];
          const x = Math.sin(w) + 0.22 * Math.sin(2 * w) + 0.08 * Math.sin(3 * w);
          if (v === 0) sl += x;
          else sr2 += x;
        }
      }
      sub += (root * 2) / sr;
      const s0 = Math.sin(2 * Math.PI * sub);
      const swell = 0.75 + 0.25 * Math.sin((Math.PI * local) / (barLen * 2));
      L[i] += sl * 0.07 * swell + s0 * 0.12;
      R[i] += sr2 * 0.07 * swell + s0 * 0.12;
    }
  }
  const add = (start: number, dur: number, gen: (t: number) => number, gl: number, gr: number) => {
    const s0 = Math.floor(start * sr);
    const n = Math.floor(dur * sr);
    for (let j = 0; j < n; j++) {
      const i = s0 + j;
      if (i >= L.length) break;
      const v = gen(j / sr);
      L[i] += v * gl;
      R[i] += v * gr;
    }
  };
  const ARP = [0, 1, 2, 1, 0, 2, 1, 2];
  for (let bar = 0; bar < bars; bar++) {
    const b0 = bar * barLen;
    const [root, notes] = chordAt(b0 + 0.01);
    // piano-ish arpeggio from bar 2 (sine + soft partials, struck envelope)
    if (bar >= 2) {
      for (let e = 0; e < 8; e++) {
        const f = notes[ARP[e]] * 2;
        const pan = e % 2 ? 0.75 : 1;
        add(b0 + e * (beat / 2), 1.6, (t) => {
          const w = 2 * Math.PI * f * t;
          return (Math.sin(w) + 0.35 * Math.sin(2 * w) * Math.exp(-t / 0.3) + 0.12 * Math.sin(3 * w) * Math.exp(-t / 0.15)) * Math.exp(-t / 0.55) * Math.min(1, t / 0.004) * 0.09;
        }, pan, 1.75 - pan);
      }
    }
    // deep pulse on every beat (felt more than heard)
    for (let q = 0; q < 4; q++) {
      add(b0 + q * beat, 0.5, (t) => Math.sin(2 * Math.PI * root * 2 * t) * Math.exp(-t / 0.18) * 0.12, 1, 1);
    }
    // timpani on the big changes (a tuned drum: no noise in it — over the title screen a noise
    // burst read as a gust of wind)
    if (bar % 4 === 0 || bar === bars - 1) {
      let p = 0;
      add(b0, 2.2, (t) => {
        p += (root * 1.5 + 30 * Math.exp(-t / 0.08)) / sr;
        return (Math.sin(2 * Math.PI * p) + 0.3 * Math.sin(4 * Math.PI * p) * Math.exp(-t / 0.12)) * Math.exp(-t / 0.7) * 0.3;
      }, 1, 1);
    }
  }
  // swell into the loop point: the chord rising in the strings (it was filtered noise — it sounded
  // like wind)
  {
    const st = (bars - 2) * barLen;
    const dur = 2 * barLen + 0.4;
    const [, notes] = chordAt(st + 0.01);
    add(st, dur, (t) => {
      const k = (t / dur) ** 2;
      let v = 0;
      for (const f of notes) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
      return v * k * Math.min(1, (dur - t) / 0.4) * 0.035;
    }, 1, 1);
  }
  // stereo echo (dotted eighth, ping-pong) for space
  const d = Math.floor(beat * 0.75 * sr);
  for (let i = d; i < N + tail; i++) {
    L[i] += R[i - d] * 0.28;
    R[i] += L[i - d] * 0.24;
  }
  const outL = new Float32Array(N);
  const outR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    outL[i] = L[i] + (i < tail ? L[N + i] : 0);
    outR[i] = R[i] + (i < tail ? R[N + i] : 0);
  }
  let peak = 0;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(outL[i]), Math.abs(outR[i]));
  const g = 0.85 / Math.max(1e-6, peak);
  for (let i = 0; i < N; i++) {
    outL[i] = Math.tanh(outL[i] * g) * 0.9;
    outR[i] = Math.tanh(outR[i] * g) * 0.9;
  }
  return [outL, outR];
}
