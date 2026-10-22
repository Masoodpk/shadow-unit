import type { AbilityDef } from "./abilities";
import { sideOf, type Faction } from "./factions";
import thanosUrl from "../assets/roster/thanos.glb?url";
import darkseidUrl from "../assets/roster/darkseid.glb?url";
import rocketUrl from "../assets/roster/rocket.glb?url";
import jokerUrl from "../assets/roster/joker.glb?url";
import flashUrl from "../assets/roster/flash.glb?url";
import draxUrl from "../assets/roster/drax.glb?url";
import starlordUrl from "../assets/roster/starlord.glb?url";
import ronanUrl from "../assets/roster/ronan.glb?url";
import doomUrl from "../assets/roster/doom.glb?url";
import ultronUrl from "../assets/roster/ultron.glb?url";
import marvelUrl from "../assets/roster/captain_marvel.glb?url";
import capUrl from "../assets/roster/captain_america.glb?url";
import thorUrl from "../assets/roster/thor.glb?url";
import antmanUrl from "../assets/roster/antman.glb?url";
import strangeUrl from "../assets/roster/strange.glb?url";
import ironhideUrl from "../assets/roster/ironhide.glb?url";
import megatronUrl from "../assets/roster/megatron.glb?url";
import toothlessUrl from "../assets/roster/toothless.glb?url";
import godzillaUrl from "../assets/roster/godzilla.glb?url";
import helaUrl from "../assets/roster/hela.glb?url";
import redskullUrl from "../assets/roster/redskull.glb?url";
import surferUrl from "../assets/roster/surfer.glb?url";
import torchUrl from "../assets/roster/torch.glb?url";
import fantasticUrl from "../assets/roster/fantastic.glb?url";
import venomUrl from "../assets/roster/venom.glb?url";

/**
 * THE ROSTER — every super-powered character in one table: who they are, whose side they're on,
 * what they fight with, how tough they are, how they arrive. Balancing is done here, not in the
 * characters' code. `status` is honest about how far each one is:
 *
 *   playable  — in the game now, fighting (its own class, or RosterHero + a kit)
 *   model     — the model loads and rigs (checked by the roster audit); gameplay not built yet
 *   planned   — defined, no gameplay yet
 *
 * Sides: the registry is the authority — the Hulk's faction ("hero") is what puts him on your side
 * in the game (Game reads it); Thanos is the final boss (Phase 4).
 */
export type Role = "heavy" | "melee" | "ranged" | "flyer" | "speedster" | "tactician" | "support" | "trickster" | "boss";
export type Tier = "standard" | "elite" | "boss" | "final-boss";
export type EntranceKind = "sky-landing" | "lightning" | "energy-descent" | "smoke-walk" | "jet-landing" | "container" | "swing" | "speed-trail" | "portal" | "assemble" | "ambush" | "march" | "fortress" | "vehicle" | "perch";

export interface CharacterDef {
  id: string;
  name: string;
  faction: Faction;
  role: Role;
  tier: Tier;
  status: "playable" | "model" | "planned";
  /** the model (roster characters) — the existing heroes load their own */
  model?: string;
  /** standing height in metres (the rig is scaled to it) */
  height: number;
  /** the model's own clips worth using (Darkseid's, the HatchXR rigs') */
  clips?: string[];
  stats: { health: number; speed: number; armor: number; staggerResist: number; reaction: number };
  weapons: string[];
  abilities: AbilityDef[];
  entrance: { kind: EntranceKind; line: string };
  /** boss phase thresholds (fractions of health where the fight changes) */
  phases?: number[];
  notes?: string;
}

const a = (id: string, name: string, kind: AbilityDef["kind"], cooldown: number, range: [number, number], damage: number, stagger: number, extra: Partial<AbilityDef> = {}): AbilityDef => ({ id, name, kind, cooldown, range, damage, stagger, ...extra });

export const ROSTER: CharacterDef[] = [
  // ------------------------------------------------------------------ the heroes
  {
    id: "hulk", name: "HULK", faction: "hero", role: "heavy", tier: "elite", status: "playable", height: 2.75,
    stats: { health: 3400, speed: 6, armor: 0.4, staggerResist: 0.9, reaction: 0.35 },
    weapons: ["fists"], abilities: [a("smash", "Ground slam", "aoe", 8, [0, 6], 60, 1.5, { radius: 6.5 }), a("leap", "Leap attack", "movement", 7, [9, 28], 50, 1.5), a("throw", "Rock throw", "projectile", 6, [10, 40], 40, 1)],
    entrance: { kind: "sky-landing", line: "" }, notes: "enemies/Hulk.ts with the ally side (HulkHost.ally): fights for you, never hits you or the heroes, gets back up when knocked out.",
  },
  {
    id: "spiderman", name: "SPIDER-MAN", faction: "hero", role: "melee", tier: "elite", status: "playable", height: 1.78,
    stats: { health: 420, speed: 6.6, armor: 0.55, staggerResist: 0.2, reaction: 0.12 },
    weapons: ["web-shooters"], abilities: [a("web", "Web restraint", "ranged", 9, [5, 22], 0, 1), a("dive", "Dive kick", "movement", 7, [6, 20], 30, 1), a("combo", "Combo", "melee", 1, [0, 2.9], 15, 0.4)],
    entrance: { kind: "perch", line: "Okay, big guy. Let's dance." },
  },
  {
    id: "ironman", name: "IRON MAN", faction: "hero", role: "flyer", tier: "elite", status: "playable", height: 1.95,
    stats: { health: 520, speed: 16, armor: 0.5, staggerResist: 0.4, reaction: 0.2 },
    weapons: ["repulsors", "unibeam"], abilities: [a("repulsor", "Repulsor", "projectile", 1, [4, 30], 8, 0.2), a("unibeam", "Unibeam", "beam", 22, [8, 26], 40, 1), a("dive", "Power dive", "movement", 7, [0, 26], 34, 1.5)],
    entrance: { kind: "sky-landing", line: "" },
  },
  {
    id: "deadpool", name: "DEADPOOL", faction: "hero", role: "melee", tier: "elite", status: "playable", height: 1.86,
    stats: { health: 420, speed: 7.2, armor: 0.5, staggerResist: 0.3, reaction: 0.12 },
    weapons: ["twin blasters", "katanas (on his back)"], abilities: [a("kata", "Gun-kata strafe", "ranged", 4.5, [6, 22], 7, 0), a("charge", "Twin blast", "projectile", 11, [4, 20], 32, 2), a("combo", "Combo", "melee", 1.5, [0, 2.9], 13, 0.4)],
    entrance: { kind: "container", line: "Okay, who's the idiot that locked the coolest guy in a box?" },
  },
  {
    id: "superman", name: "SUPERMAN", faction: "hero", role: "flyer", tier: "elite", status: "playable", height: 1.9,
    stats: { health: 2400, speed: 38, armor: 0.85, staggerResist: 0.95, reaction: 0.15 },
    weapons: [], abilities: [a("punch", "Power punch", "melee", 4.5, [0, 40], 60, 2), a("heat", "Heat vision", "beam", 7, [0, 30], 70, 0.3), a("freeze", "Freeze breath", "aoe", 13, [0, 14], 0, 2), a("carry", "Grab and slam", "grab", 17, [0, 40], 160, 2, { maxSize: 0.99 })],
    entrance: { kind: "sky-landing", line: "Looks like you could use a hand." },
    notes: "Not in the design brief's list; already in the game — kept on the heroes' side.",
  },
  {
    id: "thor", name: "THOR", faction: "hero", role: "heavy", tier: "elite", status: "playable", model: thorUrl, height: 1.98,
    stats: { health: 2600, speed: 7, armor: 0.7, staggerResist: 0.8, reaction: 0.2 },
    weapons: ["Mjolnir (in the model, loose — needs attaching to the hand)"], abilities: [a("hammer", "Hammer combo", "melee", 1.4, [0, 3], 30, 0.8), a("lightning", "Lightning strike", "aoe", 6, [4, 35], 55, 1.2, { radius: 4 }), a("throw", "Hammer throw", "projectile", 5, [5, 30], 40, 1.5), a("storm", "God of Thunder", "aoe", 40, [0, 20], 120, 2, { radius: 10, cost: 60 })],
    entrance: { kind: "lightning", line: "" }, notes: "Audit: the model carries Mjolnir as a separate piece standing at its rest spot — it has to be parented to his hand.",
  },
  {
    id: "cap", name: "CAPTAIN AMERICA", faction: "hero", role: "tactician", tier: "elite", status: "playable", model: capUrl, height: 1.88,
    stats: { health: 1400, speed: 7, armor: 0.6, staggerResist: 0.6, reaction: 0.15 },
    weapons: ["shield (in the model — two copies, loose; attach one to the arm, hide the other)"], abilities: [a("shieldThrow", "Shield throw", "projectile", 4, [4, 25], 25, 1), a("block", "Block / counter", "buff", 3, [0, 4], 0, 0), a("bash", "Shield strike", "melee", 1.2, [0, 2.6], 20, 0.8), a("rally", "Rally (team defence)", "buff", 30, [0, 15], 0, 0)],
    entrance: { kind: "smoke-walk", line: "" },
  },
  {
    id: "marvel", name: "CAPTAIN MARVEL", faction: "hero", role: "flyer", tier: "elite", status: "playable", model: marvelUrl, height: 1.8,
    stats: { health: 2000, speed: 30, armor: 0.75, staggerResist: 0.8, reaction: 0.15 },
    weapons: [], abilities: [a("blast", "Photon blast", "projectile", 1.2, [4, 35], 18, 0.5), a("charged", "Charged blast", "beam", 9, [6, 30], 60, 1.5), a("ram", "High-speed strike", "movement", 8, [6, 40], 50, 2), a("binary", "Binary mode", "buff", 45, [0, 50], 0, 0, { cost: 70 })],
    entrance: { kind: "energy-descent", line: "" },
  },
  {
    id: "starlord", name: "STAR-LORD", faction: "hero", role: "ranged", tier: "standard", status: "playable", model: starlordUrl, height: 1.85,
    stats: { health: 600, speed: 7, armor: 0.3, staggerResist: 0.2, reaction: 0.15 },
    weapons: ["blaster (one in the model, loose — attach to the hand; the second needs a copy)"], abilities: [a("blasters", "Dual blasters", "projectile", 0.8, [5, 30], 9, 0.1), a("jet", "Jet boots dodge", "movement", 4, [0, 30], 0, 0), a("grenade", "Gravity mine", "aoe", 12, [6, 25], 35, 1.2, { radius: 4 })],
    entrance: { kind: "jet-landing", line: "" }, notes: "Model is heavy (131k triangles after simplifying, 1053-bone Rigify rig).",
  },
  {
    id: "drax", name: "DRAX", faction: "hero", role: "melee", tier: "standard", status: "playable", model: draxUrl, height: 1.95,
    stats: { health: 1200, speed: 6.5, armor: 0.5, staggerResist: 0.7, reaction: 0.25 },
    weapons: ["twin knives (model has prop sockets)"], abilities: [a("slash", "Blade combo", "melee", 1, [0, 2.6], 18, 0.5), a("charge", "Charge", "movement", 6, [4, 14], 30, 1.5), a("finisher", "Finisher", "melee", 10, [0, 2.6], 60, 2)],
    entrance: { kind: "smoke-walk", line: "" },
  },
  {
    id: "rocket", name: "ROCKET", faction: "hero", role: "ranged", tier: "standard", status: "playable", model: rocketUrl, height: 1.1,
    stats: { health: 500, speed: 7, armor: 0.25, staggerResist: 0.1, reaction: 0.15 },
    weapons: ["big gun (not in the model: Deadpool's sci-fi blaster, scaled up)"], abilities: [a("rifle", "Rapid fire", "projectile", 0.6, [6, 35], 8, 0.1), a("rocket", "Explosive round", "projectile", 6, [8, 35], 45, 1.5, { radius: 4 }), a("bombs", "Bomb toss", "aoe", 11, [5, 22], 30, 1.2, { radius: 3.5 })],
    entrance: { kind: "container", line: "" },
  },
  {
    id: "flash", name: "THE FLASH", faction: "hero", role: "speedster", tier: "elite", status: "playable", model: flashUrl, height: 1.82, clips: ["run", "stand", "punch", "jumpUp", "jumpDown", "strafeLeft", "strafeRight"],
    stats: { health: 700, speed: 40, armor: 0.3, staggerResist: 0.3, reaction: 0.05 },
    weapons: [], abilities: [a("dash", "Dash strike", "movement", 2, [3, 40], 15, 0.6), a("flurry", "Speed flurry", "melee", 4, [0, 2.5], 6, 0.3), a("bolt", "Lightning throw", "projectile", 7, [6, 30], 35, 1.5)],
    entrance: { kind: "speed-trail", line: "" },
  },
  // ------------------------------------------------------------------ the villains
  {
    id: "thanos", name: "THANOS", faction: "villain", role: "boss", tier: "final-boss", status: "playable", model: thanosUrl, height: 2.6, phases: [0.66, 0.33],
    stats: { health: 9000, speed: 5.5, armor: 0.6, staggerResist: 0.95, reaction: 0.3 },
    weapons: ["Infinity Gauntlet (part of the mesh)"], abilities: [a("combo", "Heavy combo", "melee", 2, [0, 3.5], 45, 1.5), a("grab", "Grab", "grab", 9, [0, 2.5], 60, 2), a("shockwave", "Shockwave", "aoe", 10, [0, 7], 55, 1.5, { radius: 9 }), a("block", "Block", "buff", 9, [0, 4], 0, 0),
      // the stones (from phase 2: Power and Space; phase 3: the moon-fall)
      a("power", "Power Stone beam", "beam", 11, [2.5, 30], 70, 1.5), a("portal", "Space Stone portal", "movement", 9, [3, 40], 50, 2), a("meteor", "Moon-fall", "aoe", 16, [0, 40], 45, 2, { radius: 4 })],
    entrance: { kind: "march", line: "" },
  },
  {
    id: "ultron", name: "ULTRON", faction: "villain", role: "boss", tier: "boss", status: "playable", model: ultronUrl, height: 2.2, phases: [0.5],
    stats: { health: 5000, speed: 12, armor: 0.6, staggerResist: 0.8, reaction: 0.2 },
    weapons: [], abilities: [a("bolt", "Energy bolt", "projectile", 1.2, [6, 40], 14, 0.4), a("beam", "Energy beam", "beam", 10, [6, 30], 50, 1), a("shield", "Armour shield", "buff", 18, [0, 50], 0, 0), a("drones", "Call drones", "summon", 30, [0, 60], 0, 0)],
    entrance: { kind: "assemble", line: "" }, notes: "Model carries Infinity-stone sockets (SpaceStone_, PowerStone_ …).",
  },
  {
    id: "ronan", name: "RONAN", faction: "villain", role: "boss", tier: "boss", status: "playable", model: ronanUrl, height: 2.3, phases: [0.5],
    stats: { health: 4500, speed: 4.5, armor: 0.7, staggerResist: 0.9, reaction: 0.35 },
    weapons: ["Universal Weapon (in the model on the Biped root: re-hung in his right fist)"], abilities: [a("swing", "Hammer swing", "melee", 2.4, [0, 4], 55, 1.5), a("quake", "Ground strike", "aoe", 9, [0, 6], 50, 1.5, { radius: 8 }), a("blast", "Hammer blast", "beam", 12, [6, 25], 40, 1)],
    entrance: { kind: "march", line: "" },
  },
  {
    id: "joker", name: "JOKER", faction: "villain", role: "trickster", tier: "elite", status: "playable", model: jokerUrl, height: 1.85,
    stats: { health: 1400, speed: 6, armor: 0.1, staggerResist: 0.1, reaction: 0.2 },
    weapons: ["pistol (shots, no model)", "laughing-gas canisters", "joy buzzer"], abilities: [a("trap", "Laughing gas", "aoe", 8, [3, 30], 30, 1, { radius: 3 }), a("decoy", "Joy buzzer", "melee", 5, [0, 2.2], 30, 1), a("smoke", "Smoke escape", "movement", 9, [0, 5], 0, 0), a("gun", "Pistol", "projectile", 1.5, [4, 25], 8, 0.1)],
    entrance: { kind: "ambush", line: "" },
  },
  {
    id: "darkseid", name: "DARKSEID", faction: "villain", role: "boss", tier: "boss", status: "playable", model: darkseidUrl, height: 2.6, phases: [0.6, 0.3],
    clips: ["APPROACH001_1", "ATTACK001", "ATTACK002", "ATTACK003", "AVOID001", "DAMAGE001", "DETECT001", "CUTSCENE"],
    stats: { health: 8000, speed: 3.8, armor: 0.75, staggerResist: 0.95, reaction: 0.4 },
    weapons: [], abilities: [a("omega", "Omega beams", "beam", 12, [6, 40], 65, 1.5), a("strike", "Heavy strike", "melee", 2.5, [0, 3.2], 50, 1.5), a("quake", "Cosmic slam", "aoe", 14, [0, 7], 60, 2, { radius: 10 })],
    entrance: { kind: "portal", line: "" }, notes: "The only roster model that brings its own fight clips (approach, three attacks, avoid, damage, detect, a cutscene).",
  },
  {
    id: "doom", name: "DOCTOR DOOM", faction: "independent", role: "boss", tier: "boss", status: "playable", model: doomUrl, height: 1.95, phases: [0.5],
    stats: { health: 5000, speed: 5, armor: 0.65, staggerResist: 0.8, reaction: 0.2 },
    weapons: [], abilities: [a("blast", "Energy blast", "projectile", 1.5, [5, 35], 16, 0.4), a("barrier", "Force field", "buff", 16, [0, 50], 0, 0), a("bolts", "Mystic bolts", "beam", 10, [6, 30], 45, 1), a("seal", "Mystic seal", "aoe", 12, [4, 25], 45, 1.5, { radius: 4 })],
    entrance: { kind: "fortress", line: "" }, notes: "Independent: hostile to the heroes, neutral to the villains until a story mission says otherwise.",
  },
  // ------------------------------------------------------------------ the second wave (round 10)
  {
    id: "strange", name: "DOCTOR STRANGE", faction: "hero", role: "support", tier: "elite", status: "playable", model: strangeUrl, height: 1.86,
    stats: { health: 1500, speed: 6, armor: 0.45, staggerResist: 0.4, reaction: 0.15 },
    weapons: ["Eldritch magic", "the Cloak of Levitation"], abilities: [a("bolts", "Eldritch bolts", "projectile", 1.4, [4, 30], 14, 0.3), a("shield", "Shield of Seraphim", "buff", 14, [0, 40], 0, 0), a("bind", "Crimson Bands", "ranged", 11, [4, 22], 10, 1), a("portal", "Sling ring portal", "movement", 9, [6, 40], 0, 0), a("mandala", "Mandala blast", "aoe", 20, [0, 12], 55, 1.5, { radius: 8 })],
    entrance: { kind: "portal", line: "The battle's already decided. I've seen how it ends." },
  },
  {
    id: "antman", name: "ANT-MAN", faction: "hero", role: "trickster", tier: "standard", status: "playable", model: antmanUrl, height: 1.8,
    stats: { health: 1200, speed: 7, armor: 0.4, staggerResist: 0.3, reaction: 0.12 },
    weapons: ["Pym Particles"], abilities: [a("combo", "Combo", "melee", 1.4, [0, 2.4], 14, 0.5), a("shrink", "Shrink strike", "movement", 6, [4, 18], 30, 1.2), a("giant", "Giant-Man", "buff", 40, [0, 30], 0, 0), a("stomp", "Giant stomp", "aoe", 5, [0, 7], 50, 1.8, { radius: 5 })],
    entrance: { kind: "assemble", line: "Hey! Down here! …okay, up here." }, notes: "The model ships without a skeleton (four static meshes): one is made at load time from his proportions (characters/autoSkin.ts).",
  },
  {
    id: "ironhide", name: "IRONHIDE", faction: "hero", role: "heavy", tier: "elite", status: "playable", model: ironhideUrl, height: 4.4,
    stats: { health: 3600, speed: 4.6, armor: 0.75, staggerResist: 0.9, reaction: 0.3 },
    weapons: ["arm cannons"], abilities: [a("cannons", "Arm cannons", "projectile", 2, [5, 40], 22, 0.8, { radius: 3 }), a("barrage", "Cannon barrage", "aoe", 12, [8, 35], 30, 1.2, { radius: 4 }), a("smash", "Steel fist", "melee", 2, [0, 3.6], 40, 1.5)],
    entrance: { kind: "march", line: "You feeling lucky, punk?" }, notes: "The model's vehicle-mode parts are hidden: no transformation animation comes with it.",
  },
  {
    id: "toothless", name: "TOOTHLESS", faction: "hero", role: "flyer", tier: "elite", status: "playable", model: toothlessUrl, height: 1.4,
    stats: { health: 1800, speed: 9, armor: 0.5, staggerResist: 0.6, reaction: 0.15 },
    weapons: ["plasma blast"], abilities: [a("plasma", "Plasma blast", "projectile", 2.5, [6, 45], 35, 1, { radius: 3.5 }), a("dive", "Dive bomb", "aoe", 12, [10, 50], 50, 1.5, { radius: 5 }), a("bite", "Tail swipe", "melee", 2, [0, 3.2], 18, 1)],
    entrance: { kind: "sky-landing", line: "" }, notes: "A dragon: his bones mapped onto the pose skeleton (front legs as arms); wings, legs, tail, head and jaw turned procedurally every frame.",
  },
  {
    id: "surfer", name: "SILVER SURFER", faction: "hero", role: "flyer", tier: "elite", status: "playable", model: surferUrl, height: 1.9,
    stats: { health: 2000, speed: 20, armor: 0.6, staggerResist: 0.6, reaction: 0.12 },
    weapons: ["the board", "the Power Cosmic"], abilities: [a("cosmic", "Cosmic bolts", "projectile", 1.2, [5, 40], 14, 0.3), a("beam", "Power Cosmic", "beam", 14, [8, 35], 60, 1.2), a("ram", "Board ram", "movement", 8, [6, 40], 40, 1.8), a("nova", "Cosmic nova", "aoe", 24, [0, 10], 60, 1.6, { radius: 9 })],
    entrance: { kind: "energy-descent", line: "Your world is not lost. Not yet." },
  },
  {
    id: "torch", name: "HUMAN TORCH", faction: "hero", role: "flyer", tier: "standard", status: "playable", model: torchUrl, height: 1.84,
    stats: { health: 1300, speed: 16, armor: 0.4, staggerResist: 0.3, reaction: 0.12 },
    weapons: ["fire"], abilities: [a("fireball", "Fireballs", "projectile", 1, [5, 35], 12, 0.3, { radius: 2 }), a("stream", "Flame stream", "beam", 9, [3, 14], 40, 0.6), a("ring", "Ring of fire", "aoe", 14, [0, 8], 30, 1, { radius: 7 }), a("nova", "Supernova", "buff", 35, [0, 30], 0, 0)],
    entrance: { kind: "energy-descent", line: "Flame on!" },
  },
  {
    id: "fantastic", name: "MISTER FANTASTIC", faction: "hero", role: "tactician", tier: "standard", status: "playable", model: fantasticUrl, height: 1.88,
    stats: { health: 1500, speed: 6.5, armor: 0.55, staggerResist: 0.5, reaction: 0.12 },
    weapons: ["elastic body"], abilities: [a("reach", "Long punch", "melee", 1.6, [0, 7], 16, 0.8), a("grab", "Stretch grab", "grab", 9, [3, 9], 20, 1.5), a("whip", "Whip sweep", "aoe", 8, [0, 6], 22, 1.2, { radius: 6 })],
    entrance: { kind: "swing", line: "Fascinating. Let's see what they're made of." }, notes: "His stretch: the forearm scaled along its own length, the hand scaled back (the rig untouched).",
  },
  {
    id: "hela", name: "HELA", faction: "villain", role: "boss", tier: "boss", status: "playable", model: helaUrl, height: 1.86, phases: [0.5],
    stats: { health: 4200, speed: 7, armor: 0.55, staggerResist: 0.6, reaction: 0.15 },
    weapons: ["Necroswords"], abilities: [a("combo", "Necrosword combo", "melee", 1.4, [0, 2.6], 22, 0.6), a("blades", "Thrown Necroswords", "projectile", 5, [5, 30], 24, 0.8), a("spikes", "Blade eruption", "aoe", 12, [0, 14], 40, 1.6, { radius: 3 }), a("counter", "Counter", "buff", 9, [0, 3], 0, 0)],
    entrance: { kind: "portal", line: "Kneel. Before your queen." },
  },
  {
    id: "redskull", name: "RED SKULL", faction: "villain", role: "tactician", tier: "boss", status: "playable", model: redskullUrl, height: 1.85, phases: [0.5],
    stats: { health: 2600, speed: 5.6, armor: 0.45, staggerResist: 0.5, reaction: 0.15 },
    weapons: ["Tesseract pistol", "grenades"], abilities: [a("pistol", "Tesseract pistol", "projectile", 1.5, [6, 35], 12, 0.3), a("grenade", "Grenade", "aoe", 8, [7, 25], 35, 1.2, { radius: 4 }), a("orders", "Call the guard", "summon", 25, [0, 60], 0, 0), a("combo", "Combo", "melee", 2, [0, 2.2], 12, 0.4)],
    entrance: { kind: "march", line: "Cut off one head, and two more shall take its place." },
  },
  {
    id: "megatron", name: "MEGATRON", faction: "villain", role: "boss", tier: "boss", status: "playable", model: megatronUrl, height: 5.2, phases: [0.5],
    stats: { health: 7000, speed: 4.8, armor: 0.75, staggerResist: 0.95, reaction: 0.3 },
    weapons: ["fusion cannon", "flail"], abilities: [a("cannon", "Fusion cannon", "projectile", 3, [6, 45], 30, 1, { radius: 3.5 }), a("flail", "Flail combo", "melee", 2.5, [0, 4.6], 45, 1.6), a("slam", "Ground slam", "aoe", 11, [0, 7], 50, 1.8, { radius: 8 })],
    entrance: { kind: "march", line: "Megatron has arrived." }, notes: "The model holds his mace (its own chain bones); no transformation animation comes with it.",
  },
  {
    id: "venom", name: "VENOM", faction: "independent", role: "melee", tier: "boss", status: "playable", model: venomUrl, height: 2.3, phases: [0.5],
    stats: { health: 3800, speed: 8, armor: 0.5, staggerResist: 0.7, reaction: 0.12 },
    weapons: ["symbiote"], abilities: [a("combo", "Combo", "melee", 1.2, [0, 2.8], 20, 0.6), a("tendrils", "Tendril lash", "ranged", 6, [3, 12], 24, 1.2), a("leap", "Pounce", "movement", 7, [6, 20], 30, 1.5), a("feed", "Symbiote regrowth", "buff", 20, [0, 30], 0, 0)],
    entrance: { kind: "ambush", line: "We are… Venom." }, notes: "His side is set by factions.sideOf('venom'): an enemy by default, an ally when a mission turns him.",
  },
  {
    id: "godzilla", name: "GODZILLA", faction: "monster", role: "boss", tier: "boss", status: "playable", model: godzillaUrl, height: 16, phases: [0.5],
    clips: ["All Animations"],
    stats: { health: 9000, speed: 4, armor: 0.85, staggerResist: 1, reaction: 0.5 },
    weapons: [], abilities: [a("stomp", "Stomp", "aoe", 6, [0, 10], 45, 1.8, { radius: 7 }), a("tail", "Tail sweep", "aoe", 9, [0, 16], 50, 2, { radius: 12 }), a("breath", "Atomic breath", "beam", 14, [0, 70], 90, 1.5)],
    entrance: { kind: "march", line: "" }, notes: "A giant: his own collision (a set of spheres), his own pace and turning, everyone is hostile to him and he to them.",
  },
  // (already in the game, on the villains' side)
  {
    id: "wolverine", name: "WOLVERINE", faction: "villain", role: "melee", tier: "elite", status: "playable", height: 1.74,
    stats: { health: 2300, speed: 9.4, armor: 0.5, staggerResist: 0.5, reaction: 0.1 },
    weapons: ["adamantium claws"], abilities: [a("flurry", "Claw flurry", "melee", 1.5, [0, 2.3], 6, 0.4), a("pounce", "Pounce", "movement", 6, [5, 13], 13, 1.5), a("lunge", "Lunge", "movement", 5, [3.5, 8], 9, 0.8), a("spin", "Spin slash", "aoe", 7, [0, 2.8], 7, 1, { radius: 2.7 })],
    entrance: { kind: "perch", line: "You picked the wrong fight, bub." }, notes: "Not in the brief; already in the game as a foe.",
  },
  {
    id: "batman", name: "BATMAN", faction: "villain", role: "tactician", tier: "elite", status: "playable", height: 1.9,
    stats: { health: 2500, speed: 8.8, armor: 0.66, staggerResist: 0.6, reaction: 0.12 },
    weapons: ["batarangs", "pistol", "smoke pellets", "the Batmobile"], abilities: [a("combo", "Combo", "melee", 1.5, [0, 2.2], 12, 0.5), a("batarang", "Batarangs", "projectile", 5, [7, 28], 12, 0.6), a("smoke", "Smoke takedown", "movement", 16, [3, 18], 22, 1.5), a("gun", "Pistol", "projectile", 10, [9, 35], 7, 0.1)],
    entrance: { kind: "vehicle", line: "You should have stayed out of this." }, notes: "Not in the brief; already in the game as a foe.",
  },
];

export const byId = (id: string) => ROSTER.find((c) => c.id === id);
/** who's built on your side and who against you (factions.sideOf: Venom's side is the story's call) */
export const heroes = () => ROSTER.filter((c) => sideOf(c.id, c.faction) === "hero");
export const villains = () => ROSTER.filter((c) => sideOf(c.id, c.faction) === "foe");
