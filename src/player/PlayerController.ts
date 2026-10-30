import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { HitKind, PLAYER } from "../config/game";
import { Input } from "../core/Input";
import { DEG, Spring, clamp, damp, lerp } from "../core/math";
import { AudioEngine } from "../audio/AudioEngine";
import { difficulty } from "../config/difficulty";

export interface PlayerModifiers {
  speedScale: number;
  canSprint: boolean;
  adsT: number;
  adsFovScale: number;
  adsSensitivity: number;
}

/**
 * Kinematic FPS controller on Babylon's built-in ellipsoid collision
 * (sliding, slopes/ramps), with ray-based ground snapping for clean stair
 * descents. No rigid-body physics is needed for the player, which keeps
 * input-to-motion latency at zero and avoids a physics step dependency.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  readonly collider: Mesh;
  health: number = PLAYER.maxHealth;
  alive = true;

  yaw = 0;
  /** Camera pitch (Babylon convention: + looks down). */
  pitch = 0;
  readonly velocity = new Vector3();
  grounded = false;
  crouched = false;
  /** lying down (crawl). Exclusive with crouched. */
  prone = false;
  sprinting = false;
  /** -1 = full lean left, +1 = full lean right */
  lean = 0;
  /** sideways head offset actually applied this frame (m, after the wall clamp) */
  leanOffset = 0;
  /** 0..1 horizontal speed relative to walk speed (for spread/bob/crosshair). */
  moveAmount = 0;
  airTime = 0;

  userSensitivity = 1;

  onDamaged?: (amount: number, fromYawRel: number) => void;
  /** hurt by a hard landing (no direction: the screen flashes red all round) */
  onFallDamage?: (amount: number) => void;
  onDeath?: () => void;

  private halfH = PLAYER.standHalfHeight;
  private eyeH = PLAYER.standEye;
  private vy = 0;
  private lastGrounded = 0;
  private jumpLock = 0;
  /** gait phase: advances π per footstep, driven by distance walked (camera + viewmodel bob share it) */
  gaitPhase = 0;
  private bobAmpY = 0.02;
  /** smoothed 0..~1.5 bob strength (0 when still / airborne / aiming) */
  bobAmt = 0;
  private landSpring = new Spring(160, 16);
  /**
   * Step smoothing (as Source does it): the eye's height lags the body's a little while on the ground.
   * The maps' ramps are voxel staircases (12.5 cm risers), so the body climbs them in small hops several
   * times a second; the eye glides over them instead of shaking. Off the ground the eye follows exactly.
   */
  private viewOfs = 0;
  private viewOfsV = 0;
  private lastFeetY = NaN;
  private punchPitch = new Spring(220, 20);
  private punchRoll = new Spring(180, 16);
  /** explosion shake "trauma" 0..1 (felt as trauma², decays) */
  private trauma = 0;
  private shakeT = 0;
  /** a shove from outside (a giant's punch, a shockwave): m/s, fading out */
  private push = new Vector3();
  /** knocked off your feet: seconds left on the ground (and how long the fall lasts in all) */
  private downT = 0;
  private downDur = 1;
  get knockedDown() {
    return this.downT > 0;
  }
  /** blown off your feet (a shockwave): flung, down on the ground for `seconds`, then back up */
  knockDown(seconds: number) {
    if (!this.alive) return;
    this.downT = this.downDur = Math.max(this.downT, seconds);
  }
  /** thrown: `vel` along the ground (m/s) and `up` off it */
  knock(vel: Vector3, up = 0) {
    if (!this.alive) return;
    this.push.x += vel.x;
    this.push.z += vel.z;
    // (blows land in quick succession: they add up, but only so far)
    const m = Math.hypot(this.push.x, this.push.z);
    const cap = this.downT > 0 ? 22 : 11;
    if (m > cap) this.push.scaleInPlace(cap / m);
    if (up > 0) {
      this.vy = Math.max(this.vy, up);
      this.grounded = false;
      this.jumpLock = 0.15;
    }
  }

  /** Camera shake from a blast; amount 0..1. */
  shake(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }
  private recoilPendingPitch = 0;
  private recoilPendingYaw = 0;
  private recoveryPool = 0;
  private recoveryRate = 8;
  private timeSinceShot = 99;
  private deathT = 0;
  /** vertical field of view (settings) */
  baseFov = PLAYER.baseFovDeg;
  private fovCurrent = PLAYER.baseFovDeg;
  private ray = new Ray(Vector3.Zero(), new Vector3(0, -1, 0), 1);
  private tmp = new Vector3();
  private disp = new Vector3();
  private readonly levelPredicate = (m: { metadata?: { kind?: number }; checkCollisions: boolean; isPickable: boolean }) =>
    m.metadata?.kind === HitKind.Level && m.checkCollisions && m.isPickable;

  constructor(private scene: Scene, private input: Input, private audio: AudioEngine) {
    this.camera = new FreeCamera("playerCam", new Vector3(0, 2, 0), scene);
    this.camera.inputs.clear();
    this.camera.minZ = 0.03;
    this.camera.maxZ = 1600;
    this.camera.fovMode = FreeCamera.FOVMODE_VERTICAL_FIXED;
    this.camera.fov = PLAYER.baseFovDeg * DEG;
    this.camera.rotation.set(0, 0, 0);

    this.collider = new Mesh("playerCollider", scene);
    this.collider.isPickable = false;
    this.collider.checkCollisions = false;
    this.collider.ellipsoid = new Vector3(PLAYER.radius, this.halfH, PLAYER.radius);
  }

  reset(pos: Vector3, yaw: number) {
    this.health = PLAYER.maxHealth;
    this.sinceHurt = 99;
    this.alive = true;
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.setAll(0);
    this.push.setAll(0);
    this.downT = 0;
    this.vy = 0;
    this.crouched = false;
    this.prone = false;
    this.lean = this.leanOffset = 0;
    this.viewOfs = this.viewOfsV = 0;
    this.lastFeetY = NaN;
    this.halfH = PLAYER.standHalfHeight;
    this.eyeH = PLAYER.standEye;
    this.collider.ellipsoid.y = this.halfH;
    this.collider.position.set(pos.x, pos.y + this.halfH + 0.02, pos.z);
    this.safePos.copyFrom(this.collider.position);
    this.grounded = true;
    this.deathT = 0;
    this.recoilPendingPitch = this.recoilPendingYaw = this.recoveryPool = 0;
    this.landSpring.reset();
    this.punchPitch.reset();
    this.punchRoll.reset();
    this.trauma = 0;
    this.camera.rotation.z = 0;
    this.updateCamera(0, { speedScale: 1, canSprint: true, adsT: 0, adsFovScale: 1, adsSensitivity: 1 });
  }

  get feet() {
    return this.tmp.set(this.collider.position.x, this.collider.position.y - this.halfH, this.collider.position.z);
  }
  /** Eye position in world space (the camera has no parent, so position is global and always current). */
  get eye() {
    return this.camera.position;
  }

  /** Called by weapons when a shot is fired (degrees). */
  addRecoil(pitchDeg: number, yawDeg: number, recoveryFraction: number, recoveryDegPerSec: number, punch: number) {
    this.recoilPendingPitch += pitchDeg * DEG;
    this.recoilPendingYaw += yawDeg * DEG;
    this.recoveryPool += pitchDeg * DEG * recoveryFraction;
    this.recoveryRate = recoveryDegPerSec * DEG;
    this.timeSinceShot = 0;
    this.punchPitch.impulse(-punch * 1.6);
    this.punchRoll.impulse((Math.random() - 0.5) * punch * 1.2);
  }

  /** developer mode: ignore all damage */
  invulnerable = false;

  /** below this height the player has left the level (fell through a gap): put back on the last safe floor */
  killY = -Infinity;
  /**
   * Out of the level (below killY) twice in a row: where to put the player back — a floor point (feet)
   * near the last safe spot, from the Game's nav graph. The first fall returns him to the last grounded
   * spot, as always; if that spot drops him straight out again (a ledge over nothing), the loop ends here.
   */
  rescueFloor?: (from: Vector3) => Vector3 | null;
  /** seconds since he was last put back after a fall out of the level */
  private sinceRescue = 99;
  private safePos = new Vector3();
  private safeT = 0;

  /** seconds since the last hit (health regenerates after PLAYER.regenDelay) */
  sinceHurt = 99;

  /**
   * A drop from a height: past about 3 m it hurts, more steeply the higher it was (≈ 6 m costs a
   * third of your health, ≈ 13 m kills). Armour doesn't help your legs: full damage.
   */
  private hardLanding(speed: number) {
    const k = (speed - PLAYER.fallSafeSpeed) / (PLAYER.fallLethalSpeed - PLAYER.fallSafeSpeed);
    const amount = Math.pow(k, 1.25) * PLAYER.maxHealth;
    this.landSpring.impulse(-0.25 - k * 0.4);
    this.punchPitch.impulse(1.2 + k);
    this.punchRoll.impulse((Math.random() - 0.5) * 2);
    if (!this.alive || amount < 1) return;
    this.audio.play("playerHurt", { volume: 0.8 });
    this.audio.play("bodyFall", { volume: 0.6 });
    // the red flash shows even in god mode (developer), only the health stays
    this.onFallDamage?.(this.invulnerable ? 0 : amount);
    if (this.invulnerable) return;
    this.sinceHurt = 0;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.alive = false;
      this.onDeath?.();
    }
  }

  /**
   * Online: damage the server has already decided (no difficulty scaling, and no death here — the
   * server says when you're dead). The flinch, the sound and the red flash as usual.
   */
  netDamage(amount: number, from: Vector3) {
    if (!this.alive || amount <= 0) return;
    this.sinceHurt = 0;
    this.health = Math.max(1, this.health - amount);
    const rel = Math.atan2(from.x - this.collider.position.x, from.z - this.collider.position.z) - this.yaw;
    this.punchPitch.impulse(0.6);
    this.punchRoll.impulse((Math.random() - 0.5) * 1.2);
    this.audio.play("playerHurt", { volume: 0.7 });
    this.onDamaged?.(amount, rel);
  }

  takeDamage(amount: number, from: Vector3) {
    if (!this.alive || this.invulnerable) return;
    amount *= PLAYER.damageTaken * difficulty.k.damageTaken;
    this.sinceHurt = 0;
    this.health = Math.max(0, this.health - amount);
    const dx = from.x - this.collider.position.x;
    const dz = from.z - this.collider.position.z;
    const rel = Math.atan2(dx, dz) - this.yaw;
    this.punchPitch.impulse(0.6);
    this.punchRoll.impulse((Math.random() - 0.5) * 1.2);
    this.audio.play("playerHurt", { volume: 0.7 });
    this.onDamaged?.(amount, rel);
    if (this.health <= 0) {
      this.alive = false;
      this.onDeath?.();
    }
  }

  update(dt: number, mods: PlayerModifiers) {
    if (!this.alive) {
      this.deathT += dt;
      this.updateCamera(dt, mods);
      return;
    }
    this.sinceHurt += dt;
    const rg = difficulty.k.regen;
    if (this.sinceHurt > PLAYER.regenDelay / rg && this.health < PLAYER.maxHealth) this.health = Math.min(PLAYER.maxHealth, this.health + PLAYER.regenRate * rg * dt);
    this.look(mods);
    this.move(dt, mods);
    // remember where we last stood on solid ground; a fall out of the level returns there
    this.safeT += dt;
    if (this.grounded && this.safeT > 0.5) {
      this.safeT = 0;
      this.safePos.copyFrom(this.collider.position);
    }
    this.sinceRescue += dt;
    if (this.collider.position.y < this.killY) {
      const floor = this.sinceRescue < 3 ? this.rescueFloor?.(this.safePos) ?? null : null;
      if (floor) this.safePos.set(floor.x, floor.y + this.halfH + 0.02, floor.z);
      this.sinceRescue = 0;
      this.collider.position.copyFrom(this.safePos);
      this.velocity.setAll(0);
      this.vy = 0;
      this.grounded = true;
    }
    this.updateCamera(dt, mods);
  }

  private look(mods: PlayerModifiers) {
    const fovRatio = this.fovCurrent / this.baseFov;
    const sens = PLAYER.sensitivity * this.userSensitivity * fovRatio * lerp(1, mods.adsSensitivity, mods.adsT);
    const dYaw = this.input.mouseDX * sens;
    const dPitch = this.input.mouseDY * sens;
    this.yaw += dYaw;
    this.pitch += dPitch;
    // pulling down against recoil consumes the auto-recovery pool
    if (dPitch > 0 && this.recoveryPool > 0) this.recoveryPool = Math.max(0, this.recoveryPool - dPitch);
  }

  private move(dt: number, mods: PlayerModifiers) {
    const inp = this.input;
    // ---- recoil application (smoothly over a couple of frames) + recovery
    const k = damp(38, dt);
    const ap = this.recoilPendingPitch * k;
    const ay = this.recoilPendingYaw * k;
    this.recoilPendingPitch -= ap;
    this.recoilPendingYaw -= ay;
    this.pitch -= ap;
    this.yaw += ay;
    this.timeSinceShot += dt;
    if (this.timeSinceShot > 0.09 && this.recoveryPool > 0) {
      const r = Math.min(this.recoveryPool, this.recoveryRate * dt * (1 + this.recoveryPool * 6));
      this.recoveryPool -= r;
      this.pitch += r;
    }
    // ---- stance: crouch (C) and prone (Z) toggle; jump from prone / crouch gets up one step.
    // Prone again = back on your feet (or as high as the space allows: crouch under a low ceiling)
    if (inp.hit("prone")) {
      if (this.prone) {
        if (this.canRise(PLAYER.standHalfHeight)) {
          this.prone = false;
          this.crouched = false;
        } else if (this.canRise(PLAYER.crouchHalfHeight)) {
          this.prone = false;
          this.crouched = true;
        }
      } else if (this.grounded) {
        this.prone = true;
        this.crouched = false;
        this.audio.play("foley", { volume: 0.35 });
      }
    }
    if (inp.hit("crouch")) {
      if (this.prone) {
        if (this.canRise(PLAYER.crouchHalfHeight)) {
          this.prone = false;
          this.crouched = true;
        }
      } else if (this.crouched) {
        if (this.canRise(PLAYER.standHalfHeight)) this.crouched = false;
      } else this.crouched = true;
    }
    // lying down limits how far you can look down (you'd see through the floor) and up
    this.pitch = this.prone ? clamp(this.pitch, -PLAYER.proneLookUp, PLAYER.proneLookDown) : clamp(this.pitch, -PLAYER.pitchLimit, PLAYER.pitchLimit);
    const targetHalf = this.prone ? PLAYER.proneHalfHeight : this.crouched ? PLAYER.crouchHalfHeight : PLAYER.standHalfHeight;
    const stanceRate = this.prone || this.halfH < PLAYER.crouchHalfHeight - 0.02 ? PLAYER.proneLerp : PLAYER.crouchLerp;
    if (Math.abs(targetHalf - this.halfH) > 1e-3) {
      const before = this.halfH;
      this.halfH = lerp(this.halfH, targetHalf, damp(stanceRate, dt));
      if (Math.abs(targetHalf - this.halfH) < 0.005) this.halfH = targetHalf;
      // keep feet planted while the capsule resizes
      if (this.grounded) this.collider.position.y += this.halfH - before;
      this.collider.ellipsoid.y = this.halfH;
    }
    this.eyeH = lerp(this.eyeH, this.prone ? PLAYER.proneEye : this.crouched ? PLAYER.crouchEye : PLAYER.standEye, damp(stanceRate, dt));

    // ---- lean / peek (hold): the head moves sideways, the body stays behind cover
    const leanWant = this.sprinting ? 0 : (inp.held("leanRight") ? 1 : 0) - (inp.held("leanLeft") ? 1 : 0);
    this.lean = lerp(this.lean, leanWant, damp(PLAYER.leanLerp, dt));
    if (Math.abs(this.lean) < 0.002 && leanWant === 0) this.lean = 0;

    // ---- wish direction
    let fx = 0;
    let fz = 0;
    this.downT = Math.max(0, this.downT - dt);
    // (flat on your back: no walking till you're up)
    if (this.downT <= 0) {
      if (inp.held("forward")) fz += 1;
      if (inp.held("back")) fz -= 1;
      if (inp.held("right")) fx += 1;
      if (inp.held("left")) fx -= 1;
      // the touch stick: analog, so a light push walks slowly
      if (fx === 0 && fz === 0) {
        fx = inp.moveX;
        fz = inp.moveY;
      }
    }
    const len = Math.hypot(fx, fz);
    if (len > 1) {
      fx /= len;
      fz /= len;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;

    const wantSprint = inp.held("sprint");
    this.sprinting = wantSprint && fz > 0.5 && mods.canSprint && !this.crouched && !this.prone && this.grounded;
    let speed = this.prone ? PLAYER.proneSpeed : this.crouched ? PLAYER.crouchSpeed : this.sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    speed *= mods.speedScale;

    const accel = this.grounded ? (len > 0 ? PLAYER.groundAccel : PLAYER.groundDecel) : PLAYER.airAccel;
    const a = damp(accel, dt);
    this.velocity.x += (wx * speed - this.velocity.x) * a;
    this.velocity.z += (wz * speed - this.velocity.z) * a;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.moveAmount = clamp(hs / PLAYER.walkSpeed, 0, 1.6);

    // ---- jump
    this.jumpLock -= dt;
    const now = performance.now() / 1000;
    if (this.grounded) this.lastGrounded = now;
    if (inp.hit("jump") && this.downT <= 0 && now - this.lastGrounded < PLAYER.coyoteTime && this.jumpLock <= 0) {
      if (this.prone) {
        if (this.canRise(PLAYER.crouchHalfHeight)) {
          this.prone = false;
          this.crouched = true;
        }
      } else if (this.crouched) {
        if (this.canRise(PLAYER.standHalfHeight)) this.crouched = false;
      } else {
        this.vy = PLAYER.jumpVelocity;
        this.grounded = false;
        this.jumpLock = 0.2;
        this.audio.play("foley", { volume: 0.25 });
      }
    }

    // ---- horizontal move (collision sliding)
    const pos = this.collider.position;
    const prevY = pos.y;
    this.disp.set((this.velocity.x + this.push.x) * dt, 0, (this.velocity.z + this.push.z) * dt);
    // (knocked flat you slide on along the ground before you stop)
    this.push.scaleInPlace(Math.exp(-dt * (this.grounded ? (this.downT > 0 ? 2.2 : 6) : 1.5)));
    if (hs > 0.001 || Math.abs(this.push.x) + Math.abs(this.push.z) > 0.02) {
      const bx = pos.x, bz = pos.z;
      this.collider.moveWithCollisions(this.disp);
      // stairs built from boxes: if a low step stopped us, lift over it (ground snap settles us on top)
      const want = Math.hypot(this.disp.x, this.disp.z);
      if (this.grounded && this.jumpLock <= 0 && Math.hypot(pos.x - bx, pos.z - bz) < want * 0.4) this.stepUp(bx, bz, want);
    }
    // sliding up a ramp can raise us a little — that's desired; dropping is handled by snap

    // ---- vertical
    if (this.grounded && this.vy <= 0 && this.jumpLock <= 0) {
      const g = this.groundDistance(PLAYER.stepDown + 0.1);
      if (g >= this.halfH - 0.45 && g <= this.halfH + PLAYER.stepDown) {
        pos.y += this.halfH + 0.015 - g; // snap to floor (stairs down / ramps)
        this.vy = 0;
      } else {
        this.grounded = false;
        this.airTime = 0;
      }
    } else {
      this.vy = Math.max(this.vy - PLAYER.gravity * dt, -PLAYER.maxFall);
      const want = this.vy * dt;
      const yBefore = pos.y;
      this.disp.set(0, want, 0);
      this.collider.moveWithCollisions(this.disp);
      const moved = pos.y - yBefore;
      this.airTime += dt;
      if (want > 0 && moved < want * 0.5) this.vy = 0; // ceiling
      if (want < 0) {
        const g = this.groundDistance(0.25);
        if (moved > want * 0.5 || (g >= 0 && g <= this.halfH + 0.05)) {
          // landed
          if (this.vy < -4.5) {
            this.landSpring.impulse(this.vy * 0.06);
            this.audio.play("land", { volume: clamp(-this.vy / 10, 0.3, 0.9) });
          }
          if (-this.vy > PLAYER.fallSafeSpeed) this.hardLanding(-this.vy);
          this.vy = 0;
          this.grounded = true;
        }
      }
    }
    void prevY;

    // ---- footsteps: one per half gait cycle, so the sound lands exactly on the bob's low point
    if (this.grounded && hs > 0.3) {
      const stride = PLAYER.footstepStride * (this.sprinting ? 1.22 : this.prone ? 0.55 : this.crouched ? 0.75 : 1);
      const before = Math.floor(this.gaitPhase / Math.PI);
      this.gaitPhase += (hs * dt * Math.PI) / stride;
      if (Math.floor(this.gaitPhase / Math.PI) !== before && hs > 0.8) {
        if (this.prone) this.audio.play("foley", { volume: 0.12, pitchVar: 0.15 });
        else {
          this.audio.play("footstep", { volume: this.crouched ? 0.12 : this.sprinting ? 0.42 : 0.26, pitchVar: 0.08 });
        }
      }
    }
  }

  /** try to climb a step of up to PLAYER.stepDown: rise, move again, keep it only if it got us further */
  private stepUp(bx: number, bz: number, want: number) {
    const pos = this.collider.position;
    const sx = pos.x, sy = pos.y, sz = pos.z;
    const before = Math.hypot(sx - bx, sz - bz);
    // probe: floor just ahead, a step up (not a wall)
    const dx = this.disp.x / want, dz = this.disp.z / want;
    this.ray.origin.set(pos.x + dx * (PLAYER.radius + 0.12), pos.y - this.halfH + PLAYER.stepDown + 0.05, pos.z + dz * (PLAYER.radius + 0.12));
    this.ray.direction.set(0, -1, 0);
    this.ray.length = PLAYER.stepDown + 0.03;
    const hit = this.scene.pickWithRay(this.ray, this.levelPredicate as never, false);
    if (!hit?.hit || !hit.pickedPoint) return;
    const rise = hit.pickedPoint.y - (pos.y - this.halfH);
    if (rise < 0.03 || rise > PLAYER.stepDown) return;
    this.disp.set(0, rise + 0.02, 0);
    this.collider.moveWithCollisions(this.disp);
    if (pos.y - sy < rise * 0.9) {
      pos.set(sx, sy, sz); // ceiling: no room
      return;
    }
    this.disp.set(dx * want, 0, dz * want);
    this.collider.moveWithCollisions(this.disp);
    if (Math.hypot(pos.x - bx, pos.z - bz) <= before + want * 0.3) pos.set(sx, sy, sz);
  }

  /** is there head room to grow the capsule to `targetHalf` (feet stay planted)? */
  private canRise(targetHalf: number) {
    const p = this.collider.position;
    this.ray.origin.set(p.x, p.y, p.z);
    this.ray.direction.set(0, 1, 0);
    this.ray.length = targetHalf * 2 - this.halfH + 0.05;
    const hit = this.scene.pickWithRay(this.ray, this.levelPredicate as never, true);
    return !hit?.hit;
  }

  /** Distance from collider centre to ground below, or -1. */
  private groundDistance(extra: number) {
    const p = this.collider.position;
    this.ray.origin.set(p.x, p.y, p.z);
    this.ray.direction.set(0, -1, 0);
    this.ray.length = this.halfH + extra;
    const hit = this.scene.pickWithRay(this.ray, this.levelPredicate as never, false);
    return hit?.hit ? hit.distance : -1;
  }

  private updateCamera(dt: number, mods: PlayerModifiers) {
    const p = this.collider.position;
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    // Smooth head motion: one gentle dip per footstep (cos 2φ — no |sin| cusps, which read as
    // shaking), a slow side-to-side sway per stride, amplitude eased in/out.
    const bobCfg = this.sprinting ? PLAYER.bobSprint : PLAYER.bobWalk;
    const targetBob = this.grounded && this.alive ? clamp(hs / PLAYER.walkSpeed, 0, 1.3) * (1 - mods.adsT * 0.85) : 0;
    this.bobAmt = lerp(this.bobAmt, targetBob, damp(6, dt));
    this.bobAmpY = lerp(this.bobAmpY, bobCfg.amp, damp(4, dt));
    const ph = this.gaitPhase;
    const bobY = (Math.cos(2 * ph) * 0.5 - 0.5) * this.bobAmpY * this.bobAmt;
    const bobX = Math.sin(ph) * this.bobAmpY * 0.55 * this.bobAmt;
    const land = this.landSpring.update(dt);
    const punchP = this.punchPitch.update(dt);
    const punchR = this.punchRoll.update(dt);

    let eye = this.eyeH;
    let roll = punchR * 0.02;
    if (!this.alive) {
      const t = clamp(this.deathT / 0.9, 0, 1);
      const e = t * t * (3 - 2 * t);
      eye = lerp(this.eyeH, 0.35, e);
      roll += e * 1.1;
    }
    if (this.downT > 0 && this.alive) {
      // knocked down: the view drops to the ground and tips over, and comes back up at the end
      const u = 1 - this.downT / this.downDur;
      const k = u < 0.18 ? u / 0.18 : u > 0.75 ? Math.max(0, (1 - u) / 0.25) : 1;
      const e = k * k * (3 - 2 * k);
      eye = lerp(eye, 0.45, e);
      roll += e * 0.45;
    }
    const bodyY = p.y - this.halfH;
    // (stance changes keep the feet planted, so they don't show here; a teleport / respawn snaps)
    const dy = Number.isNaN(this.lastFeetY) ? 0 : bodyY - this.lastFeetY;
    this.lastFeetY = bodyY;
    if (Math.abs(dy) > 0.6 || !this.alive) this.viewOfs = this.viewOfsV = 0;
    else if (this.grounded) this.viewOfs -= dy;
    // critically damped (ω 18/s), never more than 30 cm off; in the air it settles quickly
    const w = this.grounded ? 18 : 30;
    // (small sub-steps: stable through a long frame)
    for (let t = dt; t > 1e-6; t -= 1 / 120) {
      const h = Math.min(t, 1 / 120);
      this.viewOfsV += (-w * w * this.viewOfs - 2 * w * this.viewOfsV) * h;
      this.viewOfs += this.viewOfsV * h;
    }
    this.viewOfs = clamp(this.viewOfs, -0.3, 0.3);
    const feetY = bodyY + this.viewOfs;
    const cs = Math.cos(this.yaw);
    const sn = Math.sin(this.yaw);
    // lean: offset along the view's right, clamped so the eye (and every shot from it) never enters a wall
    const maxLean = this.prone ? PLAYER.leanProne : this.crouched ? PLAYER.leanCrouch : PLAYER.leanStand;
    let ofs = this.alive ? this.lean * maxLean : 0;
    const headY = feetY + eye + bobY + land - Math.abs(ofs) * 0.12;
    if (Math.abs(ofs) > 0.005) {
      const side = Math.sign(ofs);
      this.ray.origin.set(p.x, headY, p.z);
      this.ray.direction.set(cs * side, 0, -sn * side);
      this.ray.length = Math.abs(ofs) + 0.16;
      const hit = this.scene.pickWithRay(this.ray, this.levelPredicate as never, false);
      if (hit?.hit) ofs = side * Math.max(0, Math.min(Math.abs(ofs), hit.distance - 0.16));
    }
    this.leanOffset = ofs;
    roll -= this.lean * PLAYER.leanRoll * (this.prone ? 0.5 : 1);
    this.camera.position.set(p.x + bobX * cs + ofs * cs, headY, p.z - bobX * sn - ofs * sn);
    // explosion shake: smooth noise (sum of sines), strength = trauma², decays over ~1 s
    this.shakeT += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.1);
    const tr = this.trauma * this.trauma;
    const st = this.shakeT;
    const sx = (Math.sin(st * 37.1) + Math.sin(st * 61.7 + 1.3) * 0.6) * tr * 0.028;
    const sy = (Math.sin(st * 41.3 + 2.1) + Math.sin(st * 53.9) * 0.5) * tr * 0.024;
    const sz = Math.sin(st * 29.3 + 0.7) * tr * 0.035;
    this.camera.rotation.x = this.pitch + punchP * 0.02 + sx;
    this.camera.rotation.y = this.yaw + sy;
    this.camera.rotation.z = roll + Math.sin(this.gaitPhase) * 0.0028 * this.bobAmt + sz;

    const targetFov = this.baseFov * lerp(1, mods.adsFovScale, mods.adsT) + (this.sprinting ? PLAYER.sprintFovBoost : 0);
    this.fovCurrent = lerp(this.fovCurrent, targetFov, damp(this.sprinting ? 8 : 22, dt));
    this.camera.fov = this.fovCurrent * DEG;
  }

  get stance(): "stand" | "crouch" | "prone" {
    return this.prone ? "prone" : this.crouched ? "crouch" : "stand";
  }

  get fovDeg() {
    return this.fovCurrent;
  }
}
