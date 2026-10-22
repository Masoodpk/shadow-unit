import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";

interface Print {
  m: InstancedMesh;
  age: number;
  life: number;
  depth: number;
}

/**
 * Boot prints in snow. Every footstep (the player's and the soldiers') presses a print into the
 * snow under that foot — left and right alternate either side of the line of travel, pointing the
 * way the walker was going. Running prints are deeper, longer and scuffed at the toe, and kick up a
 * little spray of snow. Prints fill back in over a few seconds (fresh snow / drift) and vanish.
 *
 * Only on snow: the game tells us where that is (outdoors on the snow stage, under open sky).
 */
export class Footprints {
  private prints: Print[] = [];
  private next = 0;
  private kick: ParticleSystem;

  constructor(scene: Scene, particle: Texture, count = 180) {
    const tex = new DynamicTexture("bootPrint", { width: 128, height: 256 }, scene, true);
    paintBoot(tex.getContext() as unknown as CanvasRenderingContext2D, 128, 256);
    tex.update();
    tex.hasAlpha = true;
    tex.wrapU = tex.wrapV = Texture.CLAMP_ADDRESSMODE;
    const mat = new StandardMaterial("bootPrintMat", scene);
    mat.diffuseTexture = tex;
    mat.useAlphaFromDiffuseTexture = true;
    // the map's snow is baked (unlit), so a lit print would glow in the shade: instead the print is
    // unlit and simply darkens whatever snow it lies on (bright sun or blue shadow alike)
    mat.disableLighting = true;
    mat.diffuseColor = new Color3(1, 1, 1);
    mat.specularColor = Color3.Black();
    mat.zOffset = -1;
    mat.backFaceCulling = false;
    const src = MeshBuilder.CreatePlane("bootPrintSrc", { width: 0.14, height: 0.32 }, scene);
    src.rotation.x = Math.PI / 2;
    src.bakeCurrentTransformIntoVertices();
    src.material = mat;
    src.isPickable = false;
    src.isVisible = false;
    // per-print opacity (fading as the snow fills them in)
    src.registerInstancedBuffer("color", 4);
    src.instancedBuffers.color = new Color4(1, 1, 1, 1);
    src.hasVertexAlpha = true;
    for (let i = 0; i < count; i++) {
      const m = src.createInstance("bootPrint");
      m.isPickable = false;
      m.instancedBuffers.color = new Color4(1, 1, 1, 0);
      m.setEnabled(false);
      this.prints.push({ m, age: 0, life: 0, depth: 0 });
    }

    // snow kicked up by a running boot
    const ps = new ParticleSystem("snowKick", 160, scene);
    ps.particleTexture = particle;
    ps.emitter = new Vector3(0, -200, 0);
    ps.emitRate = 0;
    ps.color1 = new Color4(0.95, 0.97, 1, 0.9);
    ps.color2 = new Color4(0.85, 0.9, 0.96, 0.7);
    ps.colorDead = new Color4(0.9, 0.93, 1, 0);
    ps.minSize = 0.015;
    ps.maxSize = 0.045;
    ps.minLifeTime = 0.3;
    ps.maxLifeTime = 0.7;
    ps.gravity = new Vector3(0, -6, 0);
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 1 / 60;
    ps.minEmitBox = new Vector3(-0.05, 0, -0.05);
    ps.maxEmitBox = new Vector3(0.05, 0.02, 0.05);
    ps.start();
    this.kick = ps;
  }

  /**
   * A boot came down at (x, y = snow surface, z), walking towards `yaw` (0 = +Z). side −1 left /
   * +1 right; `run` 0..1 (sprint = deeper, longer, scuffed, sprays snow).
   */
  step(x: number, y: number, z: number, yaw: number, side: number, run: number) {
    const p = this.prints[this.next];
    this.next = (this.next + 1) % this.prints.length;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const off = 0.11 * side;
    p.m.position.set(x + rx * off, y + 0.012, z + rz * off);
    // feet toe out a little (no mirrored left sole: a negative scale flips the lighting dark)
    p.m.rotation.set(0, yaw + side * 0.08 + (Math.random() - 0.5) * 0.06, 0);
    const len = 1 + run * 0.15;
    p.m.scaling.set(1, 1, len);
    p.depth = 0.75 + run * 0.25;
    p.age = 0;
    p.life = 16 + Math.random() * 4;
    (p.m.instancedBuffers.color as Color4).a = p.depth;
    p.m.setEnabled(true);
    if (run > 0.5) {
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      (this.kick.emitter as Vector3).set(x + rx * off + fx * 0.12, y + 0.03, z + rz * off + fz * 0.12);
      this.kick.direction1.set(fx * 0.4 - 0.3, 0.8, fz * 0.4 - 0.3);
      this.kick.direction2.set(fx * 1.2 + 0.3, 1.6, fz * 1.2 + 0.3);
      this.kick.minEmitPower = 0.6;
      this.kick.maxEmitPower = 1.6;
      this.kick.manualEmitCount = 10 + ((Math.random() * 8) | 0);
    }
  }

  update(dt: number) {
    for (const p of this.prints) {
      if (p.life <= 0) continue;
      p.age += dt;
      // crisp for most of their life, then the snow fills them in over the last few seconds
      const fadeStart = p.life - 6;
      const k = p.age < fadeStart ? 1 : Math.max(0, 1 - (p.age - fadeStart) / 6);
      (p.m.instancedBuffers.color as Color4).a = p.depth * k;
      if (p.age >= p.life) {
        p.life = 0;
        p.m.setEnabled(false);
      }
    }
  }

  warmup(at: Vector3) {
    this.step(at.x, at.y, at.z, 0, 1, 1);
  }

  reset() {
    for (const p of this.prints) {
      p.life = 0;
      p.m.setEnabled(false);
    }
    this.kick.reset();
  }
}

/**
 * A boot sole pressed into snow: the dark hollow of the print (lug pattern on the sole, a deeper
 * heel), a thin bright rim of snow pushed up round the edge, soft and grainy. Toe at the top (+v).
 */
function paintBoot(g: CanvasRenderingContext2D, w: number, h: number) {
  const sole = (path: CanvasRenderingContext2D) => {
    path.beginPath();
    // forefoot
    path.ellipse(w * 0.5, h * 0.3, w * 0.36, h * 0.24, 0, 0, Math.PI * 2);
    // arch
    path.rect(w * 0.22, h * 0.36, w * 0.5, h * 0.3);
    // heel
    path.ellipse(w * 0.48, h * 0.76, w * 0.3, h * 0.16, 0, 0, Math.PI * 2);
  };
  // pushed-up rim (lighter, slightly larger)
  g.save();
  g.filter = "blur(5px)";
  g.fillStyle = "rgba(255, 255, 255, 0.2)";
  g.translate(w * 0.5, h * 0.5);
  g.scale(1.12, 1.06);
  g.translate(-w * 0.5, -h * 0.5);
  sole(g);
  g.fill();
  g.restore();
  // the hollow: shadowed, compressed snow
  g.save();
  g.filter = "blur(2px)";
  g.fillStyle = "rgba(14, 20, 36, 0.42)";
  sole(g);
  g.fill();
  g.restore();
  // lug pattern: rows of deeper chevrons on the forefoot and heel
  g.save();
  sole(g);
  g.clip();
  g.strokeStyle = "rgba(10, 14, 28, 0.32)";
  g.lineWidth = 5;
  for (let y = h * 0.1; y < h * 0.92; y += 18) {
    if (y > h * 0.5 && y < h * 0.62) continue; // the arch barely touches
    g.beginPath();
    g.moveTo(w * 0.15, y + 6);
    g.lineTo(w * 0.5, y);
    g.lineTo(w * 0.85, y + 6);
    g.stroke();
  }
  // grain
  for (let i = 0; i < 260; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.08)" : "rgba(10,14,28,0.12)";
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.restore();
}
