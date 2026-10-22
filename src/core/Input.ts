import { Action, bindings } from "./Bindings";

/**
 * Raw input collection. Events only record state; gameplay reads it once per
 * frame, so every system sees the same consistent snapshot.
 *
 * Keyboard keys and mouse buttons share one code space (`KeyW`, `Mouse0`…), and
 * gameplay asks for *actions* (`held("forward")`, `hit("reload")`) through the
 * user's bindings. Raw `isDown` / `wasPressed` remain for fixed developer keys.
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  fireHeld = false;
  firePressed = false;
  /** performance.now() of last fire press, for input buffering */
  firePressTime = -1;
  adsHeld = false;
  /** an aim input is physically held (grenade underhand lob) */
  rmbDown = false;
  /** aim mode: true = click / key toggles aim (laptop & trackpad friendly), false = hold */
  aimToggle = true;
  wheel = 0;
  locked = false;
  enabled = false;
  /** macOS ctrl+click acts as a right click — remember it so the release matches */
  private ctrlClick = false;

  onLockChange?: (locked: boolean) => void;
  onLockError?: () => void;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearAll);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("wheel", this.onWheel, { passive: true });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockchange", this.onLockChangeEvt);
    document.addEventListener("pointerlockerror", () => this.onLockError?.());
  }

  async requestLock() {
    const c = this.canvas as HTMLCanvasElement & {
      requestPointerLock(opts?: { unadjustedMovement?: boolean }): Promise<void> | void;
    };
    try {
      // Raw mouse input where supported (Chrome/Edge); falls back automatically.
      await c.requestPointerLock({ unadjustedMovement: true });
    } catch {
      try {
        await c.requestPointerLock();
      } catch {
        this.onLockError?.();
      }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** raw code held (developer keys) */
  isDown(code: string) {
    return this.down.has(code);
  }
  /** raw code pressed this frame (developer keys) */
  wasPressed(code: string) {
    return this.pressed.has(code);
  }
  /** a bound action is held */
  held(a: Action) {
    for (const c of bindings.codes(a)) if (this.down.has(c)) return true;
    return false;
  }
  /** a bound action was pressed this frame */
  hit(a: Action) {
    for (const c of bindings.codes(a)) if (this.pressed.has(c)) return true;
    return false;
  }

  /** Call at the end of each frame. */
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.firePressed = false;
    this.wheel = 0;
  }

  clearAll = () => {
    this.down.clear();
    this.pressed.clear();
    this.fireHeld = false;
    this.adsHeld = false;
    this.rmbDown = false;
    this.ctrlClick = false;
    this.firePressed = false;
    this.mouseDX = this.mouseDY = 0;
  };

  private codeDown(code: string) {
    this.pressed.add(code);
    this.down.add(code);
    if (!this.locked) return;
    for (const a of bindings.actionsFor(code)) {
      if (a === "fire") this.pressFire();
      else if (a === "aim") {
        this.rmbDown = true;
        this.pressAim();
      }
    }
  }
  private codeUp(code: string) {
    this.down.delete(code);
    for (const a of bindings.actionsFor(code)) {
      if (a === "fire") this.fireHeld = this.held("fire");
      else if (a === "aim") {
        this.rmbDown = this.held("aim");
        if (!this.rmbDown) this.releaseAim();
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.code === "F3") e.preventDefault();
    if (this.locked && (e.code === "Space" || e.code.startsWith("Arrow") || e.code === "Tab" || e.ctrlKey)) e.preventDefault();
    if (e.repeat) {
      this.down.add(e.code);
      return;
    }
    this.codeDown(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.codeUp(e.code);
  };
  private pressFire() {
    this.fireHeld = true;
    this.firePressed = true;
    this.firePressTime = performance.now();
  }
  private pressAim() {
    this.adsHeld = this.aimToggle ? !this.adsHeld : true;
  }
  private releaseAim() {
    if (!this.aimToggle) this.adsHeld = false;
  }
  /** drop a latched aim (sprint, weapon switch, death) */
  cancelAim() {
    if (this.aimToggle) this.adsHeld = false;
  }
  private onMouseMove = (e: MouseEvent) => {
    if (!this.locked || !this.enabled) return;
    // Some browsers occasionally emit huge spikes on pointer lock — discard them.
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    this.mouseDX += e.movementX;
    this.mouseDY += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    if (e.button === 1) e.preventDefault();
    // macOS: ctrl+click is a secondary click
    if (e.button === 0 && e.ctrlKey) {
      this.ctrlClick = true;
      this.codeDown("Mouse2");
      return;
    }
    this.codeDown("Mouse" + e.button);
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0 && this.ctrlClick) {
      this.ctrlClick = false;
      this.codeUp("Mouse2");
      return;
    }
    this.codeUp("Mouse" + e.button);
  };
  private onWheel = (e: WheelEvent) => {
    if (this.locked) this.wheel += Math.sign(e.deltaY);
  };
  private onLockChangeEvt = () => {
    this.locked = document.pointerLockElement === this.canvas;
    if (!this.locked) this.clearAll();
    this.onLockChange?.(this.locked);
  };
}
