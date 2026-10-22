import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

/**
 * Web strands, built like the real thing on screen: a fibrous core with two thinner fibres twisting
 * round it, soft-edged and streaked (a painted texture: bright centre, threads along it, ragged
 * edges), sagging when slack, wobbling for a moment when fired, and turned to face the camera
 * segment by segment. A fixed pool: nothing is created during play.
 */
const POOL = 30;
/** segments along each strand, and the ribbons in it (core + two twisted fibres) */
const SEG = 18;
const RIBBONS = 3;

interface Strand {
  m: Mesh;
  pos: Float32Array;
  uv: Float32Array;
  a: Vector3;
  b: Vector3;
  width: number;
  /** seconds left (−1: held until released) */
  life: number;
  fade: number;
  on: boolean;
  /** how slack it hangs (0 taut … 1 loose), its wobble after firing, the twist's phase */
  sag: number;
  wob: number;
  phase: number;
}

/** the strand texture: threads running along it, a bright core, soft ragged edges */
function webTexture(scene: Scene) {
  const W = 64, H = 256;
  const t = new DynamicTexture("webTex", { width: W, height: H }, scene, true);
  const g = t.getContext() as CanvasRenderingContext2D;
  g.clearRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // a few threads, each a line across the width that wanders slowly along the length
  const threads = Array.from({ length: 7 }, () => ({ x: 0.2 + r() * 0.6, w: 0.03 + r() * 0.06, a: 0.5 + r() * 0.5, f: 1 + r() * 3, ph: r() * 6.28 }));
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = y / H;
      // the soft body of the strand
      const edge = Math.max(0, 1 - Math.abs(u - 0.5) * 2);
      let a = Math.pow(edge, 1.6) * 0.55;
      for (const th of threads) {
        const cx = th.x + Math.sin(v * 6.28 * th.f + th.ph) * 0.06;
        const d = Math.abs(u - cx) / th.w;
        if (d < 1) a += (1 - d * d) * th.a * 0.6;
      }
      // little knots and gaps along it
      a *= 0.85 + 0.15 * Math.sin(v * 6.28 * 9 + u * 3);
      const k = (y * W + x) * 4;
      const bright = 225 + 30 * Math.min(1, a);
      img.data[k] = bright;
      img.data[k + 1] = bright;
      img.data[k + 2] = Math.min(255, bright + 8);
      img.data[k + 3] = Math.min(255, a * 255);
    }
  g.putImageData(img, 0, 0);
  t.update();
  t.hasAlpha = true;
  t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

export class WebFx {
  private strands: Strand[] = [];
  /** the web-shot blobs (a sphere each) */
  private blobs: { m: Mesh; on: boolean }[] = [];
  private tmp = new Vector3();
  private side = new Vector3();
  private dir = new Vector3();
  private time = 0;

  constructor(private scene: Scene) {
    const tex = webTexture(scene);
    const mat = new StandardMaterial("webMat", scene);
    mat.disableLighting = true;
    mat.emissiveTexture = tex;
    mat.opacityTexture = tex;
    mat.emissiveColor = new Color3(1, 1, 1);
    mat.backFaceCulling = false;
    mat.alphaMode = 2; // ALPHA_COMBINE
    const nv = RIBBONS * (SEG + 1) * 2;
    const indices: number[] = [];
    for (let r = 0; r < RIBBONS; r++)
      for (let i = 0; i < SEG; i++) {
        const k = (r * (SEG + 1) + i) * 2;
        indices.push(k, k + 1, k + 3, k, k + 3, k + 2);
      }
    for (let i = 0; i < POOL; i++) {
      const m = new Mesh("webStrand", scene);
      const pos = new Float32Array(nv * 3);
      const uv = new Float32Array(nv * 2);
      const vd = new VertexData();
      vd.positions = pos;
      vd.uvs = uv;
      vd.indices = indices;
      vd.applyToMesh(m, true);
      m.material = mat;
      m.isPickable = false;
      m.alwaysSelectAsActiveMesh = true;
      m.setEnabled(false);
      this.strands.push({ m, pos, uv, a: new Vector3(), b: new Vector3(), width: 0.02, life: 0, fade: 0, on: false, sag: 0, wob: 0, phase: 0 });
    }
    const blobMat = new StandardMaterial("webBlobMat", scene);
    blobMat.disableLighting = true;
    blobMat.emissiveColor = new Color3(0.94, 0.95, 0.98);
    for (let i = 0; i < 3; i++) {
      const m = MeshBuilder.CreateSphere("webBlob", { diameter: 0.15, segments: 6 }, scene);
      m.material = blobMat;
      m.isPickable = false;
      m.setEnabled(false);
      this.blobs.push({ m, on: false });
    }
  }

  /**
   * A strand from a to b; returns its id (to move or release it), or −1 if the pool is used up.
   * `sag` 0 taut … 1 slack; a fresh line wobbles for a moment.
   */
  line(a: Vector3, b: Vector3, width = 0.026, life = -1, sag = 0) {
    const s = this.strands.find((x) => !x.on);
    if (!s) return -1;
    s.on = true;
    s.a.copyFrom(a);
    s.b.copyFrom(b);
    s.width = width;
    s.life = life;
    s.fade = life > 0 ? life : 0;
    s.sag = sag;
    s.wob = 1;
    s.phase = Math.random() * 6.28;
    s.m.setEnabled(true);
    s.m.visibility = 1;
    return this.strands.indexOf(s);
  }
  move(id: number, a: Vector3, b: Vector3) {
    const s = this.strands[id];
    if (!s?.on) return;
    s.a.copyFrom(a);
    s.b.copyFrom(b);
  }
  /** how slack a strand hangs (a swing line goes taut as his weight comes on it) */
  setSag(id: number, sag: number) {
    const s = this.strands[id];
    if (s?.on) s.sag = sag;
  }
  /** let a strand go: it goes slack and fades out (the web snapping loose) */
  release(id: number, fade = 0.3) {
    const s = this.strands[id];
    if (!s?.on) return;
    s.life = fade;
    s.fade = fade;
    s.sag = Math.max(s.sag, 0.6);
  }

  blob(at: Vector3) {
    const b = this.blobs.find((x) => !x.on);
    if (!b) return null;
    b.on = true;
    b.m.position.copyFrom(at);
    b.m.setEnabled(true);
    return b;
  }
  freeBlob(b: { m: Mesh; on: boolean } | null) {
    if (!b) return;
    b.on = false;
    b.m.setEnabled(false);
  }

  /** a splat of web where it sticks: short strands thrown out round the point, flat to the surface */
  splat(at: Vector3, normal: Vector3, n = 6, size = 0.35, life = 1.2) {
    const nn = normal.normalizeToNew();
    const t1 = Vector3.Cross(nn, Math.abs(nn.y) < 0.9 ? Vector3.Up() : Vector3.Right()).normalize();
    const t2 = Vector3.Cross(nn, t1);
    const c = at.add(nn.scale(0.03));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + Math.random() * 0.5;
      const r = size * (0.6 + Math.random() * 0.6);
      const end = c.add(t1.scale(Math.cos(a) * r)).addInPlace(t2.scale(Math.sin(a) * r));
      const id = this.line(c, end, 0.014, life, 0.15);
      if (id >= 0) this.strands[id].wob = 0;
    }
  }

  update(dt: number) {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    this.time += dt;
    const eye = cam.globalPosition;
    const P = new Vector3(), Q = new Vector3(), U = new Vector3(), T = new Vector3();
    for (const s of this.strands) {
      if (!s.on) continue;
      if (s.life >= 0) {
        s.life -= dt;
        if (s.life <= 0) {
          s.on = false;
          s.m.setEnabled(false);
          continue;
        }
        s.m.visibility = Math.min(1, s.life / Math.max(0.05, s.fade * 0.6));
      }
      s.wob = Math.max(0, s.wob - dt * 3.5);
      s.b.subtractToRef(s.a, this.dir);
      const L = this.dir.length();
      if (L < 1e-4) continue;
      this.dir.scaleInPlace(1 / L);
      // a frame across the line for the twist and the wobble
      Vector3.CrossToRef(this.dir, Math.abs(this.dir.y) < 0.95 ? Vector3.UpReadOnly : Vector3.RightReadOnly, U);
      U.normalize();
      Vector3.CrossToRef(this.dir, U, T);
      const twists = Math.max(1, L * 1.6);
      const p = s.pos, uv = s.uv;
      for (let r = 0; r < RIBBONS; r++) {
        const w = r === 0 ? s.width : s.width * 0.38;
        const rad = r === 0 ? 0 : s.width * 0.75;
        const ph = s.phase + (r * Math.PI * 2) / 2;
        for (let i = 0; i <= SEG; i++) {
          const f = i / SEG;
          // along the line, sagging under its own weight (a parabola), wobbling while fresh
          P.copyFrom(s.a).addInPlace(this.dir.scale(L * f));
          const bow = 4 * f * (1 - f);
          P.y -= bow * s.sag * L * 0.12;
          const wob = Math.sin(f * Math.PI * 5 + this.time * 40) * bow * s.wob * 0.12 * Math.min(1, L / 4);
          P.addInPlaceFromFloats(U.x * wob, U.y * wob, U.z * wob);
          // fibres twist round the core
          if (rad > 0) {
            const a = ph + f * twists * Math.PI * 2;
            P.addInPlace(U.scale(Math.cos(a) * rad)).addInPlace(T.scale(Math.sin(a) * rad));
          }
          // the ribbon turned to face the eye at this point; thinner toward the ends
          P.subtractToRef(eye, Q);
          Vector3.CrossToRef(this.dir, Q, this.side);
          const l = this.side.length() || 1;
          const taper = 0.55 + 0.45 * Math.sin(Math.min(1, f * 6, (1 - f) * 6) * Math.PI * 0.5);
          this.side.scaleInPlace((w * taper) / 2 / l);
          const k = (r * (SEG + 1) + i) * 2;
          p[k * 3] = P.x - this.side.x; p[k * 3 + 1] = P.y - this.side.y; p[k * 3 + 2] = P.z - this.side.z;
          p[k * 3 + 3] = P.x + this.side.x; p[k * 3 + 4] = P.y + this.side.y; p[k * 3 + 5] = P.z + this.side.z;
          const v = f * L * 2.2 + r * 0.37;
          uv[k * 2] = 0; uv[k * 2 + 1] = v;
          uv[k * 2 + 2] = 1; uv[k * 2 + 3] = v;
        }
      }
      s.m.updateVerticesData(VertexBuffer.PositionKind, p, false, false);
      s.m.updateVerticesData(VertexBuffer.UVKind, uv, false, false);
      s.m.refreshBoundingInfo();
    }
    void this.tmp;
  }

  reset() {
    for (const s of this.strands) {
      s.on = false;
      s.m.setEnabled(false);
    }
    for (const b of this.blobs) this.freeBlob(b);
  }

  /** strands in use (tests: nothing should leak) */
  get active() {
    return this.strands.filter((s) => s.on).length + this.blobs.filter((b) => b.on).length;
  }
}
