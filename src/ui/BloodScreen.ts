/**
 * Screen blood: when the player is hit, blood splats land near the screen edge on the side the
 * shot came from, run a little, and fade over a couple of seconds. The lower the health, the
 * heavier the splats and the longer they stay. Splat images are painted once at start-up on
 * canvases (drops, spatter, streaks), so nothing is downloaded and every hit looks different.
 */
function paintSplat(seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const blob = (x: number, y: number, rad: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, `rgba(120, 6, 4, ${a})`);
    grad.addColorStop(0.6, `rgba(95, 4, 3, ${a * 0.9})`);
    grad.addColorStop(1, "rgba(70, 2, 2, 0)");
    g.fillStyle = grad;
    g.beginPath();
    // lumpy outline
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = rad * (0.75 + r() * 0.35);
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.fill();
  };
  blob(128, 128, 54 + r() * 20, 0.92);
  // spatter thrown out from the centre
  for (let i = 0; i < 46; i++) {
    const ang = r() * Math.PI * 2;
    const d = 40 + r() * 80;
    blob(128 + Math.cos(ang) * d, 128 + Math.sin(ang) * d, 3 + r() * 9 * (1 - d / 140), 0.85);
  }
  // runs dripping down
  for (let i = 0; i < 4; i++) {
    const x = 100 + r() * 56;
    const len = 30 + r() * 80;
    const w = 3 + r() * 5;
    const grad = g.createLinearGradient(0, 128, 0, 128 + len);
    grad.addColorStop(0, "rgba(105, 5, 3, 0.85)");
    grad.addColorStop(1, "rgba(80, 3, 2, 0)");
    g.fillStyle = grad;
    g.fillRect(x - w / 2, 128, w, len);
    blob(x, 128 + len * 0.9, w * 0.8, 0.6);
  }
  return c.toDataURL();
}

/** fine droplet spray: a fan of tiny drops and a few streaks flung across the lens */
function paintSpray(seed: number) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const base = r() * Math.PI * 2;
  for (let i = 0; i < 140; i++) {
    const ang = base + (r() - 0.5) * 1.6;
    const d = Math.pow(r(), 0.6) * 120;
    const x = 128 + Math.cos(ang) * d, y = 128 + Math.sin(ang) * d;
    const rad = 0.8 + r() * 3.6 * (1 - d / 140);
    g.fillStyle = `rgba(${105 + r() * 30}, ${4 + r() * 4}, 3, ${0.7 + r() * 0.25})`;
    g.beginPath();
    if (r() < 0.25) g.ellipse(x, y, rad * 2.6, rad, ang, 0, Math.PI * 2);
    else g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL();
}

export class BloodScreen {
  private root: HTMLElement;
  private images: string[] = [];
  private sprays: string[] = [];
  private pool: HTMLDivElement[] = [];
  private next = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "blood-screen";
    parent.appendChild(this.root);
    for (let i = 0; i < 8; i++) this.images.push(paintSplat(1234 + i * 7919));
    for (let i = 0; i < 6; i++) this.sprays.push(paintSpray(4321 + i * 6271));
    for (let i = 0; i < 14; i++) {
      const d = document.createElement("div");
      d.className = "splat";
      this.root.appendChild(d);
      this.pool.push(d);
    }
  }

  /** a hit: `relYaw` is where it came from relative to the view (0 = ahead), hpFrac the health left */
  hit(amount: number, relYaw: number, hpFrac: number) {
    const heavy = 1 - hpFrac;
    const count = amount > 12 || heavy > 0.6 ? 2 : 1;
    this.spray(amount, relYaw, heavy);
    for (let k = 0; k < count; k++) {
      const d = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      // place on the side of the screen the shot came from, near the edges
      const side = Math.sin(relYaw);
      const x = 50 + Math.max(-1, Math.min(1, side * 1.4 + (Math.random() - 0.5) * 0.9)) * 38;
      const y = 22 + Math.random() * 60;
      const size = 18 + Math.random() * 14 + heavy * 16 + Math.min(10, amount);
      d.style.left = `${x}%`;
      d.style.top = `${y}%`;
      d.style.width = d.style.height = `${size}vmin`;
      d.style.backgroundImage = `url(${this.images[(Math.random() * this.images.length) | 0]})`;
      d.style.setProperty("--rot", `${(Math.random() * 360) | 0}deg`);
      d.getAnimations().forEach((a) => a.cancel());
      const hold = 600 + heavy * 1600;
      d.animate(
        [
          { opacity: 0, transform: "translate(-50%, -50%) rotate(var(--rot)) scale(0.6)" },
          { opacity: Math.min(0.95, 0.55 + heavy * 0.4), transform: "translate(-50%, -50%) rotate(var(--rot)) scale(1)", offset: 0.06 },
          { opacity: Math.min(0.9, 0.5 + heavy * 0.4), transform: "translate(-50%, -46%) rotate(var(--rot)) scale(1.02)", offset: hold / (hold + 1400) },
          { opacity: 0, transform: "translate(-50%, -40%) rotate(var(--rot)) scale(1.04)" },
        ],
        { duration: hold + 1400, easing: "ease-out", fill: "forwards" },
      );
    }
  }

  /** a quick fan of fine droplets across the view from the side the hit came from (gone in a second) */
  private spray(amount: number, relYaw: number, heavy: number) {
    const d = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    const side = Math.sin(relYaw);
    const x = 50 + Math.max(-1, Math.min(1, side * 1.1 + (Math.random() - 0.5) * 0.6)) * 30;
    const y = 30 + Math.random() * 40;
    const size = 26 + Math.random() * 16 + Math.min(14, amount);
    d.style.left = `${x}%`;
    d.style.top = `${y}%`;
    d.style.width = d.style.height = `${size}vmin`;
    d.style.backgroundImage = `url(${this.sprays[(Math.random() * this.sprays.length) | 0]})`;
    d.style.setProperty("--rot", `${(Math.random() * 360) | 0}deg`);
    d.getAnimations().forEach((a) => a.cancel());
    const peak = Math.min(0.85, 0.45 + heavy * 0.3 + amount / 60);
    d.animate(
      [
        { opacity: 0, transform: "translate(-50%, -50%) rotate(var(--rot)) scale(0.85)" },
        { opacity: peak, transform: "translate(-50%, -50%) rotate(var(--rot)) scale(1)", offset: 0.04 },
        { opacity: peak * 0.7, transform: "translate(-50%, -48%) rotate(var(--rot)) scale(1)", offset: 0.45 },
        { opacity: 0, transform: "translate(-50%, -44%) rotate(var(--rot)) scale(1.01)" },
      ],
      { duration: 900 + heavy * 700, easing: "ease-out", fill: "forwards" },
    );
  }

  clear() {
    for (const d of this.pool) {
      d.getAnimations().forEach((a) => a.cancel());
      d.style.opacity = "0";
    }
  }
}
