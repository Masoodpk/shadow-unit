import { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import { AssetContainer } from "@babylonjs/core/assetContainer";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { VideoTexture } from "@babylonjs/core/Materials/Textures/videoTexture";
// (the engine's video upload: a side-effect import, not pulled in by VideoTexture)
import "@babylonjs/core/Engines/Extensions/engine.videoTexture";
import { extFor } from "../weapons/ArmsRig";
import c64Url from "../assets/props/c64.glb?url";
import tapeUrl from "../assets/props/betamax.glb?url";

/**
 * Frostline's playback station: a desk in the middle of an office with an old Commodore set on it
 * ("Commodore 64 || Computer (Full Pack)" by dark_igorek, CC BY 4.0, prepared by prep-props.mjs —
 * no cables or plugs left lying about) — the C64, its 1541 drive, a joystick and the 1702 monitor.
 * The monitor stands on a Betamax deck (built here: a Betamax cassette goes into a Betamax deck, and
 * the 1702's composite input shows its picture). The Ambassador's tape goes into the deck's slot,
 * the door flaps in, the deck's display lights, the monitor comes on, and the tape plays on it.
 *
 * The tape's picture is the video at src/assets/video/tape.* (mp4/webm) when there is one; till then
 * a stand-in (the deck's PLAY readout over tracking noise) runs for a few seconds.
 */

/** the tape's video (none yet: the stand-in plays) */
const VIDEO = Object.values(import.meta.glob("../assets/video/tape.*", { eager: true, query: "?url", import: "default" }))[0] as string | undefined;
/** how long the stand-in runs (seconds) */
const STAND_IN = 7;

const DESK = { w: 1.4, d: 0.75, h: 0.76 };
const DECK = { w: 0.4, h: 0.085, d: 0.3 };
/**
 * the deck's cassette door (deck frame: y up from its base, z out of the front; +x is on your LEFT as
 * you face it — a left-handed scene)
 */
const DOOR = { x: 0.07, y: 0.05, w: 0.165, h: 0.034 };

export class StationModel {
  private constructor(private set: AssetContainer, private tape: AssetContainer) {}
  static async load(scene: Scene) {
    const [set, tape] = await Promise.all([
      LoadAssetContainerAsync(c64Url, scene, { pluginExtension: extFor(c64Url) }),
      LoadAssetContainerAsync(tapeUrl, scene, { pluginExtension: extFor(tapeUrl) }),
    ]);
    for (const c of [set, tape])
      for (const m of c.materials)
        if (m instanceof PBRMaterial) {
          m.maxSimultaneousLights = 4;
          m.environmentIntensity = 0.6;
        }
    return new StationModel(set, tape);
  }
  /** the desk's floor centre, and which way its front faces */
  place(scene: Scene, at: Vector3, yaw: number) {
    return new PlaybackStation(scene, this.set, this.tape, at, yaw);
  }
}

type Screen = "off" | "warm" | "static" | "playing";

export class PlaybackStation {
  /** blocks movement round the desk */
  readonly solid: Mesh;
  /** the desk's floor centre */
  readonly position: Vector3;
  /** the way the set faces (where you stand) */
  readonly front: Vector3;
  readonly right: Vector3;
  /** the tape's done its run (the video ended, or the stand-in) */
  onEnded: (() => void) | null = null;
  private root: TransformNode;
  private meshes: AbstractMesh[] = [];
  private tape: TransformNode;
  private door: TransformNode;
  private led: DynamicTexture;
  private screenMat: StandardMaterial;
  private screenTex: DynamicTexture;
  private video: VideoTexture | null = null;
  private glow: PointLight;
  /** deck frame (root-local): the slot's centre, the screen's centre */
  private slotL = new Vector3();
  private screenL = new Vector3();
  private screenSize = { w: 0.2, h: 0.15 };
  private screen: Screen = "off";
  private screenT = 0;
  /** the insert: seconds played (-1: not started), from where */
  private insT = -1;
  private insFrom = new Vector3();
  private insFromQ = new Quaternion();
  private ledText = "";
  private playT = 0;
  private paused = false;
  private volume = 1;
  private muted = false;

  constructor(private scene: Scene, set: AssetContainer, tapeC: AssetContainer, at: Vector3, private yaw: number) {
    this.position = at.clone();
    this.front = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    this.right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    // built facing +z at the spot, turned once everything's measured
    this.root = new TransformNode("station", scene);
    this.root.position.copyFrom(at);

    this.desk();
    const setRoot = new TransformNode("c64Set", scene);
    setRoot.parent = this.root;
    setRoot.position.set(0, DESK.h, -0.03);
    const inst = set.instantiateModelsToScene((n) => `${n}#c64`, false, { doNotInstantiate: true });
    for (const r of inst.rootNodes) r.parent = setRoot;
    const all = setRoot.getChildMeshes(false);
    for (const m of all) this.own(m);
    const named = (n: string) => setRoot.getDescendants(false).find((d) => d.name === `${n}#c64`) as TransformNode | undefined;

    // the monitor goes up onto the deck; the deck under it, fronts in line
    const monitor = named("monitor")!;
    const box = (n: TransformNode) => {
      const mn = new Vector3(Infinity, Infinity, Infinity), mx = mn.scale(-1);
      for (const m of [...(n instanceof AbstractMesh ? [n] : []), ...n.getChildMeshes(false)]) {
        m.computeWorldMatrix(true);
        m.refreshBoundingInfo({});
        mn.minimizeInPlace(m.getBoundingInfo().boundingBox.minimumWorld);
        mx.maximizeInPlace(m.getBoundingInfo().boundingBox.maximumWorld);
      }
      return { mn: mn.subtract(at), mx: mx.subtract(at) };
    };
    this.root.computeWorldMatrix(true);
    const mon = box(monitor);
    const up = new Matrix();
    (monitor.parent as TransformNode).computeWorldMatrix(true).invertToRef(up);
    // (one world metre up, in the monitor's parent's frame)
    const lift = Vector3.TransformNormal(new Vector3(0, DECK.h, 0), up);
    monitor.position.addInPlace(lift);
    for (const n of [monitor, ...monitor.getDescendants(false)]) (n as TransformNode).computeWorldMatrix?.(true);
    const deckAt = new Vector3((mon.mn.x + mon.mx.x) / 2, DESK.h, mon.mx.z - 0.03 - DECK.d / 2);
    const { door, led } = this.deck(deckAt);
    this.door = door;
    this.led = led;
    this.slotL.set(deckAt.x + DOOR.x, DESK.h + DOOR.y, deckAt.z + DECK.d / 2);

    // the picture: a plane just in front of the monitor's glass (its edges behind the bezel)
    const glass = box(named("screen")!);
    const sw = (glass.mx.x - glass.mn.x) * 0.9, sh = (glass.mx.y - glass.mn.y) * 0.9;
    this.screenSize = { w: sw, h: sh };
    this.screenL.set((glass.mn.x + glass.mx.x) / 2, (glass.mn.y + glass.mx.y) / 2, glass.mx.z + 0.002);
    const plane = MeshBuilder.CreatePlane("tapeScreen", { width: sw, height: sh }, scene);
    plane.parent = this.root;
    plane.position.copyFrom(this.screenL);
    // (a plane faces -z: turned to face out of the screen)
    plane.rotation.y = Math.PI;
    this.screenTex = new DynamicTexture("tapeScreenTex", { width: 512, height: 384 }, scene, false, Texture.BILINEAR_SAMPLINGMODE);
    this.screenMat = new StandardMaterial("tapeScreen", scene);
    this.screenMat.disableLighting = true;
    this.screenMat.diffuseColor = Color3.Black();
    this.screenMat.specularColor = Color3.Black();
    this.screenMat.emissiveTexture = this.screenTex;
    plane.material = this.screenMat;
    this.own(plane);

    // the tape (out of sight till it comes out of your kit)
    const t = tapeC.instantiateModelsToScene((n) => `${n}#deckTape`, false, { doNotInstantiate: true });
    this.tape = new TransformNode("deckTape", scene);
    this.tape.rotationQuaternion = new Quaternion();
    for (const r of t.rootNodes) r.parent = this.tape;
    for (const m of this.tape.getChildMeshes(false)) this.own(m);
    this.tape.setEnabled(false);

    // a lamp over the desk (the office's light is baked into its walls: nothing else lights the set)
    // and the screen's glow once it's on
    const lamp = new PointLight("stationLamp", Vector3.Zero(), scene);
    lamp.parent = this.root;
    lamp.position.set(0.5, 2.1, 0.9);
    lamp.diffuse = new Color3(1, 0.93, 0.82);
    lamp.intensity = 1.1;
    lamp.range = 4;
    this.glow = new PointLight("screenGlow", Vector3.Zero(), scene);
    this.glow.parent = this.root;
    this.glow.position.copyFrom(this.screenL).addInPlaceFromFloats(0, 0, 0.35);
    this.glow.diffuse = new Color3(0.55, 0.7, 1);
    this.glow.intensity = 0;
    this.glow.range = 2.2;
    for (const l of [lamp, this.glow]) l.includedOnlyMeshes = this.meshes;

    this.root.rotation.y = yaw;
    this.root.computeWorldMatrix(true);

    this.solid = MeshBuilder.CreateBox("stationSolid", { width: DESK.w, height: 1.3, depth: DESK.d }, scene);
    this.solid.position.set(at.x, at.y + 0.65, at.z);
    this.solid.rotation.y = yaw;
    this.solid.isVisible = false;
    this.solid.isPickable = false;
    this.solid.checkCollisions = true;

    // the tape's video, loaded now so it's ready when the tape goes in (the deck plays it, not Babylon)
    if (VIDEO) {
      const v = document.createElement("video");
      v.src = VIDEO;
      v.preload = "auto";
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.loop = false;
      // (invertY off: the right way up on this plane — checked with a TOP-LEFT test clip)
      this.video = new VideoTexture("tapeVideo", v, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, { autoPlay: false, loop: false, independentVideoSource: true, autoUpdateTexture: true });
      v.addEventListener("ended", () => this.screen === "playing" && this.ended());
    }
    this.drawScreen();
    this.drawLed("");
    scene.onDisposeObservable.addOnce(() => {
      this.stopVideo();
      if (this.video) {
        const v = this.video.video;
        v.removeAttribute("src");
        v.load();
        this.video.dispose();
        this.video = null;
      }
    });
  }

  private own(m: AbstractMesh) {
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = true;
    this.meshes.push(m);
  }

  // ------------------------------------------------------------------ the desk and the deck
  private desk() {
    const wood = new StandardMaterial("deskWood", this.scene);
    wood.diffuseColor = new Color3(0.16, 0.1, 0.065);
    wood.specularColor = new Color3(0.08, 0.07, 0.06);
    const part = (w: number, h: number, d: number, x: number, y: number, z: number) => {
      const m = MeshBuilder.CreateBox("desk", { width: w, height: h, depth: d }, this.scene);
      m.material = wood;
      m.parent = this.root;
      m.position.set(x, y, z);
      this.own(m);
    };
    const { w, d, h } = DESK;
    part(w, 0.04, d, 0, h - 0.02, 0);
    for (const x of [-(w / 2 - 0.03), w / 2 - 0.03]) part(0.04, h - 0.04, d - 0.04, x, (h - 0.04) / 2, 0);
    // (the back panel: nothing to see behind the set but the desk)
    part(w - 0.1, 0.46, 0.02, 0, h - 0.27, -(d / 2 - 0.04));
  }

  /** the Betamax deck, its base at `at` (root frame); returns its door hinge and its display */
  private deck(at: Vector3) {
    const sc = this.scene;
    const root = new TransformNode("betaDeck", sc);
    root.parent = this.root;
    root.position.copyFrom(at);
    const mat = (name: string, c: Color3, spec = 0.15) => {
      const m = new StandardMaterial(name, sc);
      m.diffuseColor = c;
      m.specularColor = new Color3(spec, spec, spec);
      return m;
    };
    const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: StandardMaterial, parent: TransformNode = root) => {
      const b = MeshBuilder.CreateBox("deck", { width: w, height: h, depth: d }, sc);
      b.material = m;
      b.parent = parent;
      b.position.set(x, y, z);
      this.own(b);
      return b;
    };
    const { w, h, d } = DECK;
    const black = mat("deckBody", new Color3(0.05, 0.05, 0.055), 0.25);
    box(w, h - 0.008, d, 0, h / 2 + 0.004, 0, black);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(0.03, 0.008, 0.03, x * (w / 2 - 0.03), 0.004, z * (d / 2 - 0.03), black);

    // the front: brushed silver, the maker's name, the Betamax mark, the slot behind the door
    const face = new DynamicTexture("deckFace", { width: 1024, height: 220 }, sc, true);
    const g = face.getContext() as CanvasRenderingContext2D;
    const grad = g.createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0, "#c9cbcf");
    grad.addColorStop(1, "#9b9ea4");
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 220);
    g.globalAlpha = 0.07;
    for (let y = 0; y < 220; y += 2) {
      g.fillStyle = y % 4 ? "#000" : "#fff";
      g.fillRect(0, y, 1024, 1);
    }
    g.globalAlpha = 1;
    // (deck x → the picture's left-to-right as you face it: +x is on your left)
    const px = (x: number) => (-x / w + 0.5) * 1024, py = (y: number) => (1 - y / h) * 220;
    // (the slot, black, where the door closes over it)
    g.fillStyle = "#050505";
    g.fillRect(px(DOOR.x + DOOR.w / 2), py(DOOR.y + DOOR.h / 2), (DOOR.w / w) * 1024, (DOOR.h / h) * 220);
    g.fillStyle = "#1b1c1f";
    g.font = "bold 34px Arial, sans-serif";
    g.fillText("SONY", 24, 46);
    g.font = "italic bold 30px Georgia, serif";
    g.fillText("Betamax", px(DOOR.x + DOOR.w / 2), 200);
    g.font = "18px Arial, sans-serif";
    g.fillText("SL-HF900  Hi-Fi STEREO", px(-0.04), 200);
    face.update();
    const panel = new StandardMaterial("deckFace", sc);
    panel.diffuseTexture = face;
    panel.specularColor = new Color3(0.35, 0.35, 0.35);
    panel.specularPower = 48;
    const front = MeshBuilder.CreatePlane("deckFront", { width: w, height: h - 0.008 }, sc);
    front.material = panel;
    front.parent = root;
    front.position.set(0, h / 2 + 0.004, d / 2 + 0.0015);
    front.rotation.y = Math.PI;
    this.own(front);

    // the door: hinged along its top edge, swings in
    const hinge = new TransformNode("deckDoor", sc);
    hinge.parent = root;
    hinge.position.set(DOOR.x, DOOR.y + DOOR.h / 2, d / 2 + 0.004);
    const smoke = mat("deckDoor", new Color3(0.07, 0.07, 0.08), 0.6);
    box(DOOR.w, DOOR.h, 0.004, 0, -DOOR.h / 2, 0, smoke, hinge);

    // the buttons, under the display
    const key = mat("deckKey", new Color3(0.16, 0.16, 0.17), 0.3);
    for (let i = 0; i < 6; i++) box(0.017, 0.009, 0.006, -0.055 - i * 0.024, 0.024, d / 2 + 0.004, key);
    // (eject, under the maker's name)
    box(0.03, 0.012, 0.007, 0.165, 0.024, d / 2 + 0.004, key);

    // the display
    const led = new DynamicTexture("deckLed", { width: 256, height: 64 }, sc, false);
    const lm = new StandardMaterial("deckLed", sc);
    lm.disableLighting = true;
    lm.emissiveTexture = led;
    lm.diffuseColor = Color3.Black();
    const disp = MeshBuilder.CreatePlane("deckLed", { width: 0.1, height: 0.025 }, sc);
    disp.material = lm;
    disp.parent = root;
    disp.position.set(-0.105, 0.056, d / 2 + 0.003);
    disp.rotation.y = Math.PI;
    this.own(disp);
    return { door: hinge, led };
  }

  private drawLed(text: string) {
    if (text === this.ledText && text) return;
    this.ledText = text;
    const g = this.led.getContext() as CanvasRenderingContext2D;
    g.fillStyle = "#06100d";
    g.fillRect(0, 0, 256, 64);
    if (text) {
      g.fillStyle = "#5cf2c2";
      g.shadowColor = "#5cf2c2";
      g.shadowBlur = 10;
      g.font = "bold 36px 'Courier New', monospace";
      g.textBaseline = "middle";
      g.fillText(text, 12, 34);
      g.shadowBlur = 0;
    }
    this.led.update();
  }

  // ------------------------------------------------------------------ where things are (world)
  private world(local: Vector3) {
    return Vector3.TransformCoordinates(local, this.root.getWorldMatrix());
  }
  /** the deck's slot */
  get slot() {
    return this.world(this.slotL);
  }
  /** the middle of the picture */
  get screenCentre() {
    return this.world(this.screenL);
  }
  /** how tall the picture is (m) */
  get screenHeight() {
    return this.screenSize.h;
  }
  /** the middle of the desk's front edge, at desk height */
  get deskFront() {
    return this.position.add(this.front.scale(DESK.d / 2)).addInPlaceFromFloats(0, DESK.h, 0);
  }
  get inserted() {
    return this.insT >= 2;
  }

  // ------------------------------------------------------------------ the tape goes in
  /** out of your kit at `from` (in front of your eyes) and into the slot */
  insert(from: Vector3) {
    this.insT = 0;
    this.insFrom.copyFrom(from);
    // (held flat, turned a little towards you)
    Quaternion.RotationYawPitchRollToRef(this.yaw + 0.5, 0.25, 0, this.insFromQ);
    this.tape.setEnabled(true);
    this.placeTape(0);
  }

  /** the tape at insert time `t`: up to the slot, lined up, then in */
  private placeTape(t: number) {
    const ease = (k: number) => k * k * (3 - 2 * k);
    const flat = Quaternion.RotationYawPitchRoll(this.yaw, 0, 0);
    const slot = this.slot;
    const before = slot.add(this.front.scale(0.13));
    const inside = slot.subtract(this.front.scale(0.12));
    const q = this.tape.rotationQuaternion!;
    if (t < 1.1) {
      const k = ease(t / 1.1);
      Vector3.LerpToRef(this.insFrom, before, k, this.tape.position);
      Quaternion.SlerpToRef(this.insFromQ, flat, k, q);
    } else {
      const k = ease(Math.min(1, (t - 1.1) / 0.75));
      Vector3.LerpToRef(before, inside, k, this.tape.position);
      q.copyFrom(flat);
    }
    // the door: pushed in as the tape reaches it, shut once it's taken in
    const open = t < 1.15 ? 0 : t < 1.3 ? (t - 1.15) / 0.15 : t < 1.85 ? 1 : Math.max(0, 1 - (t - 1.85) / 0.15);
    this.door.rotation.x = open * 1.45;
  }

  // ------------------------------------------------------------------ the monitor
  /** the monitor comes on: a flash across the tube, then snow till the tape plays */
  powerOn() {
    this.screen = "warm";
    this.screenT = 0;
  }

  /** the tape plays: the video (sound and all), or the stand-in */
  play() {
    this.screen = "playing";
    this.screenT = 0;
    this.playT = 0;
    if (!this.video) return;
    const v = this.video.video;
    v.volume = Math.max(0, Math.min(1, this.volume));
    v.muted = this.muted;
    v.currentTime = 0;
    this.screenMat.emissiveTexture = this.video;
    // (sound needs the page to have been clicked: it has — you're playing — but just in case, go muted)
    if (!this.paused) void v.play().catch(() => ((v.muted = true), void v.play().catch(() => undefined)));
  }

  private ended() {
    const f = this.onEnded;
    this.onEnded = null;
    f?.();
  }

  /** the game's paused (or not): so is the tape */
  setPaused(on: boolean) {
    this.paused = on;
    const v = this.video?.video;
    if (!v || v.ended) return;
    if (on) v.pause();
    else if (this.screen === "playing") void v.play().catch(() => undefined);
  }
  setVolume(volume: number, muted: boolean) {
    this.volume = volume;
    this.muted = muted;
    const v = this.video?.video;
    if (v) {
      v.volume = Math.max(0, Math.min(1, volume));
      v.muted = muted;
    }
  }

  /** stopped, rewound, off the screen */
  private stopVideo() {
    if (!this.video) return;
    const v = this.video.video;
    v.pause();
    if (v.readyState > 0) v.currentTime = 0;
    this.screenMat.emissiveTexture = this.screenTex;
  }

  /** the stand-in's picture, and the tube warming up */
  private drawScreen() {
    const g = this.screenTex.getContext() as CanvasRenderingContext2D;
    const W = 512, H = 384, t = this.screenT;
    if (this.screen === "off") {
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
    } else if (this.screen === "warm") {
      // a bright line that opens up into the whole tube
      g.fillStyle = "#000";
      g.fillRect(0, 0, W, H);
      const k = Math.min(1, t / 0.45);
      const hh = Math.max(2, H * k * k);
      g.fillStyle = `rgba(225,235,255,${1 - k * 0.6})`;
      g.fillRect(0, (H - hh) / 2, W, hh);
    } else {
      // snow — and over it, playing, the deck's readout and a band of tracking noise rolling up
      const img = g.createImageData(W / 4, H / 4);
      const d = img.data;
      const lvl = this.screen === "static" ? 1 : 0.35;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255 * lvl;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(g.canvas as CanvasImageSource, 0, 0, W / 4, H / 4, 0, 0, W, H);
      if (this.screen === "playing") {
        const band = H - ((t * 90) % (H + 80));
        g.fillStyle = "rgba(255,255,255,0.18)";
        g.fillRect(0, band, W, 26);
        g.fillStyle = "#e9f1ff";
        g.font = "bold 30px 'Courier New', monospace";
        g.fillText("PLAY ▶", 28, 48);
        const s = Math.floor(this.playT);
        g.fillText(`0:00:${String(s).padStart(2, "0")}`, W - 200, 48);
        g.font = "bold 22px 'Courier New', monospace";
        g.fillText("TRACKING", 28, H - 30);
      }
    }
    this.screenTex.update();
  }

  // ------------------------------------------------------------------ frame
  update(dt: number) {
    if (this.paused) return;
    if (this.insT >= 0 && this.insT < 2.2) {
      const was = this.insT;
      this.insT += dt;
      this.placeTape(Math.min(this.insT, 2));
      if (this.insT >= 1.85) this.tape.setEnabled(false);
      if (was < 2 && this.insT >= 2) this.drawLed("LOAD");
    }
    if (this.screen === "off") return;
    this.screenT += dt;
    if (this.screen === "warm" && this.screenT > 0.5) {
      this.screen = "static";
      this.screenT = 0;
    }
    this.glow.intensity = this.screen === "warm" ? 1.2 : 0.55 + Math.random() * 0.12;
    if (this.screen === "playing") {
      this.playT += dt;
      this.drawLed(`▶ 0:${String(Math.floor(this.playT / 60)).padStart(2, "0")}:${String(Math.floor(this.playT) % 60).padStart(2, "0")}`);
      // (pushed every frame: Babylon only pulls a video's frames while a material shows it, and the
      // screen's material won't show till it has its first frame)
      this.video?.updateTexture(true);
      if (!this.video) {
        this.drawScreen();
        if (this.playT >= STAND_IN) this.ended();
      }
      return;
    }
    this.drawScreen();
  }

  /** it's been played: the deck stops (the tape stays in it), the monitor goes dark */
  stop() {
    this.stopVideo();
    this.onEnded = null;
    this.screen = "off";
    this.screenT = 0;
    this.glow.intensity = 0;
    this.drawScreen();
    this.drawLed("STOP");
  }

  /** back as it was: tape out, door shut, everything off */
  reset() {
    this.stopVideo();
    this.onEnded = null;
    this.insT = -1;
    this.tape.setEnabled(false);
    this.door.rotation.x = 0;
    this.screen = "off";
    this.screenT = 0;
    this.playT = 0;
    this.glow.intensity = 0;
    this.drawLed("");
    this.drawScreen();
  }
}
