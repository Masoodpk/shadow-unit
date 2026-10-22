import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { SceneInstrumentation } from "@babylonjs/core/Instrumentation/sceneInstrumentation";

export interface DebugStats {
  enemiesActive: number;
  enemiesAlive: number;
  aiStates: Record<string, number>;
  particles: number;
  voices: number;
  player: string;
}

/** F3 developer overlay. Compiled in only for dev builds (or VITE_DEBUG_OVERLAY=true). */
export class DebugOverlay {
  private el = document.getElementById("perf")!;
  private inst: SceneInstrumentation | null = null;
  private visible = false;
  private acc = 0;
  private frames = 0;
  private worst = 0;
  private sum = 0;

  constructor(private engine: Engine, private scene: Scene) {}

  toggle() {
    this.visible = !this.visible;
    this.el.classList.toggle("hidden", !this.visible);
    if (this.visible && !this.inst) {
      this.inst = new SceneInstrumentation(this.scene);
      this.inst.captureFrameTime = true;
      this.inst.captureRenderTime = true;
    }
  }

  update(dt: number, s: () => DebugStats) {
    if (!this.visible) return;
    this.frames++;
    this.sum += dt;
    this.worst = Math.max(this.worst, dt);
    this.acc += dt;
    if (this.acc < 0.25) return;
    const st = s();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
    const lights = this.scene.lights.filter((l) => l.isEnabled()).length;
    const avg = (this.sum / this.frames) * 1000;
    const i = this.inst!;
    const ai = Object.entries(st.aiStates)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    this.el.textContent =
      `FPS          ${this.engine.getFps().toFixed(0)}\n` +
      `frame        ${avg.toFixed(2)} ms  (worst ${(this.worst * 1000).toFixed(1)})\n` +
      `cpu frame    ${i.frameTimeCounter.lastSecAverage.toFixed(2)} ms\n` +
      `render       ${i.renderTimeCounter.lastSecAverage.toFixed(2)} ms\n` +
      `draw calls   ${i.drawCallsCounter.current}\n` +
      `active mesh  ${this.scene.getActiveMeshes().length}\n` +
      `particles    ${this.scene.getActiveParticles()} (fx ${st.particles})\n` +
      `lights       ${lights}\n` +
      `enemies      ${st.enemiesAlive} alive / ${st.enemiesActive} active\n` +
      `ai           ${ai}\n` +
      `audio voices ${st.voices}\n` +
      `memory       ${mem ? (mem.usedJSHeapSize / 1048576).toFixed(0) + " / " + (mem.jsHeapSizeLimit / 1048576).toFixed(0) + " MB" : "n/a (non-Chromium)"}\n` +
      `textures     ${this.scene.textures.length}   materials ${this.scene.materials.length}\n` +
      `${st.player}\n` +
      `render scale ${(1 / this.engine.getHardwareScalingLevel()).toFixed(2)}  ${this.engine.getRenderWidth()}×${this.engine.getRenderHeight()}`;
    this.acc = 0;
    this.frames = 0;
    this.sum = 0;
    this.worst = 0;
  }
}
