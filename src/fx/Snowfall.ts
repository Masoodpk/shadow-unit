import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { SpriteStream } from "./SuperFx";

/**
 * Light snow falling round you (Whiteout): flakes born in a box about the camera, drifting down and
 * sideways on the wind, a little flutter each — enough to read as weather, few enough to see through.
 */
export class Snowfall {
  private flakes: SpriteStream;
  private acc = 0;
  private wind = new Vector3(1.2, 0, 0.5);
  private t = 0;
  constructor(private scene: Scene) {
    this.flakes = new SpriteStream(scene, "snowfall", 900, false);
  }
  update(dt: number) {
    const cam = this.scene.activeCamera;
    if (!cam) return;
    this.t += dt;
    this.wind.set(1.2 + Math.sin(this.t * 0.21) * 0.9, 0, 0.5 + Math.cos(this.t * 0.17) * 0.7);
    this.acc += dt * 260;
    const c = cam.globalPosition;
    const white = new Color3(1, 1, 1), soft = new Color3(0.92, 0.95, 1);
    while (this.acc >= 1) {
      this.acc -= 1;
      const p = new Vector3(c.x + (Math.random() - 0.5) * 36, c.y + 4 + Math.random() * 10, c.z + (Math.random() - 0.5) * 36);
      const v = this.wind.add(new Vector3((Math.random() - 0.5) * 0.6, -(1.1 + Math.random() * 0.9), (Math.random() - 0.5) * 0.6));
      this.flakes.emit(p, v, 7 + Math.random() * 3, 0.025 + Math.random() * 0.03, 0.3, white, soft, 0.85, 0, 0);
    }
    this.flakes.update(dt);
  }
  reset() {
    this.flakes.reset();
  }
}
