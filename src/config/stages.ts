/** Playable stages. The menu lists them; the game builds the chosen one at load. */
export type StageId = "kestrel" | "office" | "dust2" | "metro" | "whiteout";

export interface StageInfo {
  id: StageId;
  name: string;
  /** small caps line above titles ("OPERATION // KESTREL POINT") */
  kicker: string;
  location: string;
  description: string;
  objective: string;
  /** stage card tag line */
  tag: string;
  /** background ambience loops — wind is Red Dune's alone ("coast": surf and wind); every other stage is "none" */
  ambience: "coast" | "none" | "mountain";
  /** the level is lit by the scene's lights (decals lit like walls); false = lighting baked in */
  lit: boolean;
  /** snow on the ground (boot prints) */
  snow: boolean;
}

/** in play order (NEXT STAGE follows it); the Heroes Playground always comes last */
export const STAGES: StageInfo[] = [
  {
    id: "kestrel",
    name: "RED DUNE",
    kicker: "OPERATION // RED DUNE",
    location: "Desert coast supply depot, last light",
    description: "Lab block, a sprawling container yard, army trucks and a warehouse on the dunes above the sea. A straight fight against a well-dug-in garrison.",
    objective: "CLEAR RED DUNE",
    tag: "15 HOSTILES · DESERT DEPOT",
    ambience: "coast",
    lit: true,
    snow: false,
  },
  {
    id: "dust2",
    name: "SANDSTORM",
    kicker: "OPERATION // SANDSTORM",
    location: "Walled desert kasbah, noon",
    description: "The UN envoy who brokered the ceasefire is held somewhere inside an old walled kasbah. Fight through its market and tunnels, find the cell's orders and keys, then get him out alive.",
    objective: "RESCUE THE HOSTAGE",
    tag: "MISSION · HOSTAGE RESCUE",
    ambience: "none",
    lit: false,
    snow: false,
  },
  {
    id: "office",
    name: "FROSTLINE",
    kicker: "OPERATION // FROSTLINE",
    location: "Snowbound corporate office block",
    description: "The Ambassador's tape is Betamax, and the only working deck is in the cell's old offices, wired to a Commodore monitor. Fight your way to it, play the tape, then clear the building.",
    objective: "PLAY THE TAPE",
    tag: "MISSION · PLAY THE TAPE",
    ambience: "none",
    lit: false,
    snow: true,
  },
  {
    id: "metro",
    name: "UNDERGROUND",
    kicker: "OPERATION // UNDERGROUND",
    location: "Roscoe Street station, beneath the city",
    description: "The tape named the leak: the Winter Soldier sold our nuclear secrets. He's gone to ground in a closed metro station, its halls, platforms and tunnels held by his men. Go down and kill him.",
    objective: "KILL THE WINTER SOLDIER",
    tag: "MISSION · ELIMINATE THE LEAK",
    ambience: "none",
    lit: true,
    snow: false,
  },
  {
    id: "whiteout",
    name: "HEROES PLAYGROUND",
    kicker: "OPERATION // HEROES PLAYGROUND",
    location: "Frozen high-plateau outpost, mountains all round",
    description: "A frozen plateau ringed by snow peaks, where the heroes fight: the Hulk and his side against Spider-Man, Iron Man, Deadpool and Superman — with gunships and jets overhead.",
    objective: "HOLD THE PLAYGROUND",
    tag: "15 HOSTILES + HULK & CO · SNOW PLATEAU",
    ambience: "none",
    lit: true,
    snow: true,
  },
];

export const stageInfo = (id: StageId) => STAGES.find((s) => s.id === id) ?? STAGES[0];
