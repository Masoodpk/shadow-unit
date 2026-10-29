import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export interface MinimapEnemy {
  position: Vector3;
  heading: number;
  alive: boolean;
  /** not in play yet (a mission's later soldiers, held off the map until their part of it): not shown */
  dormant?: boolean;
  /** recently fired (shown brighter, like a UAV ping) */
  firing?: boolean;
  blinded?: boolean;
}

/**
 * Rotating radar in the top-left corner (Call of Duty style): the level
 * footprint is rasterised once from the collision boxes, then each frame the
 * map is drawn rotated so the player always faces up. Enemies are red dots
 * arrows like the player's, thrown grenades blink in their type's colour.
 */
export class Minimap {
  private canvas = document.getElementById("minimap") as HTMLCanvasElement;
  private ctx = this.canvas.getContext("2d")!;
  private map: HTMLCanvasElement;
  private readonly S = 5; // map pixels per metre
  private minX: number;
  private maxZ: number;
  /** metres from the player to the edge of the radar */
  range = 34;
  private acc = 1;
  private t = 0;
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  private size = 0;
  private full = document.getElementById("fullmap-canvas") as HTMLCanvasElement | null;
  private fullOn = false;
  /** supplies to mark on the full map (guns yellow, ammo / crates green) */
  supplies?: () => { pos: Vector3; kind: string; taken: boolean }[];
  /** a mission's objective: an orange diamond, pinned to the radar's rim when far */
  objective?: () => { pos: Vector3; label: string } | null;
  /** the heroes and the big foes (and aircraft): an arrow in their colour with a letter on it */
  marks?: () => { pos: Vector3; heading: number; color: string; label: string; big?: boolean }[];
  private mark(c: CanvasRenderingContext2D, x: number, y: number, heading: number, color: string, label: string, big: boolean, alpha: number, rot: number) {
    const s = big ? 1.35 : 1.05;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.save();
    c.rotate(heading);
    c.fillStyle = color;
    c.strokeStyle = "rgba(0,0,0,0.7)";
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(0, -7 * s);
    c.lineTo(5 * s, 5 * s);
    c.lineTo(0, 2.5 * s);
    c.lineTo(-5 * s, 5 * s);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // (the letter stays upright on the rotating radar)
    c.rotate(rot);
    c.font = `700 ${big ? 10 : 9}px 'JetBrains Mono', monospace`;
    c.textAlign = "center";
    c.lineWidth = 3;
    c.strokeStyle = "rgba(0,0,0,0.85)";
    c.strokeText(label, 0, -9 * s);
    c.fillStyle = color;
    c.fillText(label, 0, -9 * s);
    c.restore();
  }
  /** places the mission has found out about (the hostage's yard): marked and named on the full map */
  known?: () => { pos: Vector3; label: string }[];
  private diamond(c: CanvasRenderingContext2D, x: number, y: number, s: number, alpha = 1) {
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(Math.PI / 4);
    c.fillStyle = "rgba(255, 106, 43, 0.35)";
    c.strokeStyle = "#ff6a2b";
    c.lineWidth = 2;
    c.fillRect(-s, -s, s * 2, s * 2);
    c.strokeRect(-s, -s, s * 2, s * 2);
    c.restore();
  }

  /**
   * `boxes` (min/max per box) replaces the collider meshes for voxel-built stages; `floorY` is the
   * playable floor height there, so only what stands on it is drawn.
   */
  constructor(colliders: Mesh[], bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, boxSet?: { boxes: Float32Array; floorMin: number; floorMax: number }) {
    const pad = 6;
    this.minX = bounds.minX - pad;
    this.maxZ = bounds.maxZ + pad;
    const w = Math.ceil((bounds.maxX - bounds.minX + pad * 2) * this.S);
    const h = Math.ceil((bounds.maxZ - bounds.minZ + pad * 2) * this.S);
    this.map = document.createElement("canvas");
    this.map.width = w;
    this.map.height = h;
    const g = this.map.getContext("2d")!;
    g.fillStyle = "rgba(14, 22, 24, 0.0)";
    g.fillRect(0, 0, w, h);

    // footprint: floor-level slabs (lighter), cover (mid), walls / tall blocks (bright)
    type Box = { x0: number; z0: number; x1: number; z1: number; top: number; height: number };
    const boxes: Box[] = [];
    if (boxSet) {
      const B = boxSet.boxes;
      for (let i = 0; i < B.length; i += 6) {
        const bottom = B[i + 1], top = B[i + 4];
        // walls and furniture standing on one of the playable floors (not ceilings, not the floors themselves)
        if (top - bottom < 0.7 || bottom > boxSet.floorMax + 1.5 || top < boxSet.floorMin + 0.6) continue;
        boxes.push({ x0: B[i], z0: B[i + 2], x1: B[i + 3], z1: B[i + 5], top, height: top - bottom });
      }
    }
    for (const m of boxSet ? [] : colliders) {
      m.computeWorldMatrix(true);
      const bb = m.getBoundingInfo().boundingBox;
      const mn = bb.minimumWorld;
      const mx = bb.maximumWorld;
      const fx = mx.x - mn.x;
      const fz = mx.z - mn.z;
      if (fx > 60 || fz > 60) continue; // the ground pad
      if (mx.y < 0.25) continue; // flush with the ground
      boxes.push({ x0: mn.x, z0: mn.z, x1: mx.x, z1: mx.z, top: mx.y, height: mx.y - mn.y });
    }
    const px = (x: number) => (x - this.minX) * this.S;
    const pz = (z: number) => (this.maxZ - z) * this.S;
    // raised floors first (mezzanines, roofs, platforms): thin + wide
    boxes.sort((a, b) => a.top - b.top);
    for (const b of boxes) {
      const flat = b.height < 0.6 && (b.x1 - b.x0) * (b.z1 - b.z0) > 6;
      const tall = b.height > 1.6;
      g.fillStyle = flat ? "rgba(120, 150, 150, 0.16)" : tall ? "rgba(214, 226, 218, 0.62)" : "rgba(170, 190, 182, 0.36)";
      g.fillRect(px(b.x0), pz(b.z1), Math.max(1, (b.x1 - b.x0) * this.S), Math.max(1, (b.z1 - b.z0) * this.S));
    }
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  /**
   * The whole stage, north up, fitted to the screen: the same footprint as the radar, the player
   * with a view cone, and the hostiles and grenades the radar shows.
   */
  private drawFull(player: Vector3, yaw: number, enemies: MinimapEnemy[], grenades: { pos: Vector3; type: string }[]) {
    const cv = this.full;
    if (!cv) return;
    const css = cv.clientWidth || 600;
    const dpr = this.dpr;
    if (cv.width !== Math.round(css * dpr)) {
      cv.width = Math.round(css * dpr);
      cv.height = Math.round(css * dpr);
    }
    const c = cv.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, css, css);
    const mw = this.map.width, mh = this.map.height;
    const fit = (css - 40) / Math.max(mw, mh);
    const ox = (css - mw * fit) / 2, oy = (css - mh * fit) / 2;
    c.fillStyle = "rgba(8, 14, 16, 0.85)";
    c.fillRect(ox - 8, oy - 8, mw * fit + 16, mh * fit + 16);
    c.strokeStyle = "rgba(232, 226, 214, 0.3)";
    c.lineWidth = 1;
    c.strokeRect(ox - 8, oy - 8, mw * fit + 16, mh * fit + 16);
    // 10 m grid
    c.strokeStyle = "rgba(160, 220, 200, 0.06)";
    const step = 10 * this.S * fit;
    for (let x = ox; x <= ox + mw * fit; x += step) {
      c.beginPath();
      c.moveTo(x, oy);
      c.lineTo(x, oy + mh * fit);
      c.stroke();
    }
    for (let y = oy; y <= oy + mh * fit; y += step) {
      c.beginPath();
      c.moveTo(ox, y);
      c.lineTo(ox + mw * fit, y);
      c.stroke();
    }
    c.drawImage(this.map, ox, oy, mw * fit, mh * fit);
    const X = (x: number) => ox + (x - this.minX) * this.S * fit;
    const Y = (z: number) => oy + (this.maxZ - z) * this.S * fit;
    const arrow = (x: number, y: number, rot: number, s: number, fill: string) => {
      c.save();
      c.translate(x, y);
      c.rotate(rot);
      c.fillStyle = fill;
      c.strokeStyle = "rgba(0,0,0,0.6)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -7 * s);
      c.lineTo(5 * s, 5 * s);
      c.lineTo(0, 2.5 * s);
      c.lineTo(-5 * s, 5 * s);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    };
    const blink = Math.sin(this.t * 18) > 0;
    for (const s of this.supplies?.() ?? []) {
      if (s.taken) continue;
      const x = X(s.pos.x), y = Y(s.pos.z);
      c.strokeStyle = "rgba(0,0,0,0.6)";
      c.fillStyle = s.kind === "weapon" ? "#f2c94c" : s.kind === "rockets" ? "#ff8a4c" : "#7fd98a";
      c.fillRect(x - 3.5, y - 3.5, 7, 7);
      c.strokeRect(x - 3.5, y - 3.5, 7, 7);
    }
    const NADE: Record<string, string> = { frag: "#ffb347", flame: "#ff6a2a", plasma: "#62e6ff", flash: "#ffffff" };
    for (const g of grenades) {
      c.fillStyle = blink ? NADE[g.type] ?? "#fff" : "rgba(255,255,255,0.3)";
      c.beginPath();
      c.arc(X(g.pos.x), Y(g.pos.z), 4, 0, Math.PI * 2);
      c.fill();
    }
    for (const e of enemies) if (e.alive && !e.dormant) arrow(X(e.position.x), Y(e.position.z), e.heading, 1, e.blinded ? "#f0d060" : "#ff3b2f");
    for (const m of this.marks?.() ?? []) this.mark(c, X(m.pos.x), Y(m.pos.z), m.heading, m.color, m.label, !!m.big, 1, 0);
    for (const k of this.known?.() ?? []) {
      c.save();
      c.strokeStyle = "#ff6a2b";
      c.setLineDash([4, 3]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(X(k.pos.x), Y(k.pos.z), 13, 0, Math.PI * 2);
      c.stroke();
      c.restore();
      c.fillStyle = "#ffb08a";
      c.font = "600 11px 'JetBrains Mono', monospace";
      c.textAlign = "center";
      c.fillText(k.label, X(k.pos.x), Y(k.pos.z) + 26);
    }
    const obj = this.objective?.();
    if (obj) {
      const s = 6 + (blink ? 1.5 : 0);
      this.diamond(c, X(obj.pos.x), Y(obj.pos.z), s);
      c.fillStyle = "#ff6a2b";
      c.font = "600 11px 'JetBrains Mono', monospace";
      c.textAlign = "center";
      c.fillText(obj.label, X(obj.pos.x), Y(obj.pos.z) - 14);
    }
    // player: view cone + arrow (yaw 0 = +Z = north = up)
    const px = X(player.x), py = Y(player.z);
    const cone = c.createRadialGradient(px, py, 0, px, py, 70);
    cone.addColorStop(0, "rgba(120, 230, 210, 0.3)");
    cone.addColorStop(1, "rgba(120, 230, 210, 0)");
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(px, py);
    c.arc(px, py, 70, yaw - Math.PI / 2 - 0.55, yaw - Math.PI / 2 + 0.55);
    c.closePath();
    c.fill();
    arrow(px, py, yaw, 1.4, "#e8f6f0");
    c.fillStyle = "rgba(255, 140, 40, 0.95)";
    c.font = "600 12px 'JetBrains Mono', monospace";
    c.textAlign = "center";
    c.fillText("N", ox + (mw * fit) / 2, oy - 14);
  }

  private resize() {
    const css = this.canvas.clientWidth || 190;
    this.size = css;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(css * this.dpr);
    this.canvas.height = Math.round(css * this.dpr);
  }

  /** full-screen map on / off */
  setFull(on: boolean) {
    this.fullOn = on;
    document.getElementById("fullmap")?.classList.toggle("hidden", !on);
  }
  get fullOpen() {
    return this.fullOn;
  }

  update(dt: number, player: Vector3, yaw: number, enemies: MinimapEnemy[], grenades: { pos: Vector3; type: string }[]) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    if (this.fullOn) this.drawFull(player, yaw, enemies, grenades);
    const c = this.ctx;
    const size = this.size;
    const r = size / 2;
    const k = r / this.range; // css px per metre
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, size, size);

    c.save();
    c.beginPath();
    c.arc(r, r, r - 1, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = "rgba(8, 14, 16, 0.72)";
    c.fillRect(0, 0, size, size);

    // world → radar: translate to player, rotate so the view direction is up
    c.translate(r, r);
    c.rotate(-yaw);
    // range rings
    c.strokeStyle = "rgba(160, 220, 200, 0.08)";
    c.lineWidth = 1;
    for (const rr of [10, 20, 30]) {
      c.beginPath();
      c.arc(0, 0, rr * k, 0, Math.PI * 2);
      c.stroke();
    }
    const mx = (player.x - this.minX) * this.S;
    const mz = (this.maxZ - player.z) * this.S;
    const sc = k / this.S;
    c.drawImage(this.map, -mx * sc, -mz * sc, this.map.width * sc, this.map.height * sc);

    const toR = (p: Vector3, out: { x: number; y: number }) => {
      out.x = (p.x - player.x) * k;
      out.y = -(p.z - player.z) * k;
      return out;
    };
    const pt = { x: 0, y: 0 };

    // grenades
    const blink = Math.sin(this.t * 18) > 0;
    const NADE: Record<string, string> = { frag: "#ffb347", flame: "#ff6a2a", plasma: "#62e6ff", flash: "#ffffff" };
    for (const g of grenades) {
      toR(g.pos, pt);
      c.fillStyle = blink ? NADE[g.type] ?? "#fff" : "rgba(255,255,255,0.3)";
      c.beginPath();
      c.arc(pt.x, pt.y, 3.4, 0, Math.PI * 2);
      c.fill();
    }

    // the objective (always shown: on the rim when it's out of range)
    const obj = this.objective?.();
    if (obj) {
      toR(obj.pos, pt);
      const d = Math.hypot(pt.x, pt.y), rim = r - 8;
      const far = d > rim;
      if (far) {
        pt.x *= rim / d;
        pt.y *= rim / d;
      }
      this.diamond(c, pt.x, pt.y, far ? 4 : 5, far ? 0.8 : 1);
    }

    // the heroes and the big foes (letters upright: undo the radar's turn)
    for (const m of this.marks?.() ?? []) {
      toR(m.pos, pt);
      const d = Math.hypot(pt.x, pt.y), rim = r - 8;
      const edge = d > rim;
      if (edge) {
        pt.x *= rim / d;
        pt.y *= rim / d;
      }
      this.mark(c, pt.x, pt.y, m.heading, m.color, m.label, !!m.big, edge ? 0.6 : 1, yaw);
    }

    // enemies
    for (const e of enemies) {
      if (!e.alive || e.dormant) continue;
      toR(e.position, pt);
      const d = Math.hypot(pt.x, pt.y);
      // clamp to the rim so off-radar hostiles still show their bearing
      const rim = r - 6;
      let edge = false;
      if (d > rim) {
        pt.x *= rim / d;
        pt.y *= rim / d;
        edge = true;
      }
      c.save();
      c.translate(pt.x, pt.y);
      c.rotate(e.heading);
      const col = e.blinded ? "#f0d060" : "#ff3b2f";
      c.globalAlpha = edge ? 0.55 : 1;
      if (e.firing && !edge) {
        c.strokeStyle = "rgba(255, 70, 50, 0.65)";
        c.beginPath();
        c.arc(0, 0, 7 + (this.t * 20) % 4, 0, Math.PI * 2);
        c.stroke();
      }
      // same arrow as the player's, in red, pointing where the enemy faces
      c.fillStyle = col;
      c.strokeStyle = "rgba(0,0,0,0.55)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(0, -6.5);
      c.lineTo(4.6, 4.6);
      c.lineTo(0, 2.3);
      c.lineTo(-4.6, 4.6);
      c.closePath();
      c.fill();
      c.stroke();
      c.restore();
    }
    c.restore();

    // player: view cone + arrow, always pointing up
    c.save();
    c.translate(r, r);
    const cone = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.75);
    cone.addColorStop(0, "rgba(120, 230, 210, 0.22)");
    cone.addColorStop(1, "rgba(120, 230, 210, 0)");
    c.fillStyle = cone;
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, r * 0.75, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    c.closePath();
    c.fill();
    c.fillStyle = "#e8f6f0";
    c.beginPath();
    c.moveTo(0, -7);
    c.lineTo(5, 5);
    c.lineTo(0, 2.5);
    c.lineTo(-5, 5);
    c.closePath();
    c.fill();
    c.restore();

    // rim + north marker
    c.strokeStyle = "rgba(232, 226, 214, 0.35)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(r, r, r - 1, 0, Math.PI * 2);
    c.stroke();
    const na = -yaw - Math.PI / 2; // world +Z on the radar
    const nx = r + Math.cos(na) * (r - 10);
    const ny = r + Math.sin(na) * (r - 10);
    c.fillStyle = "rgba(255, 140, 40, 0.95)";
    c.font = "600 10px 'JetBrains Mono', monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("N", nx, ny);
  }
}
