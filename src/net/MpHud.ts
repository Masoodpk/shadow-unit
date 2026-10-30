import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";

export interface ScoreRow {
  id: number;
  name: string;
  k: number;
  d: number;
}

const css = `
#mp-hud{position:fixed;inset:0;pointer-events:none;z-index:40;font-family:inherit;color:#e8edf2;text-transform:uppercase;letter-spacing:.12em}
#mp-hud .mp-clock{position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:22px;font-weight:700;letter-spacing:.08em;text-shadow:0 1px 3px #000}
#mp-hud .mp-room{position:absolute;top:44px;left:50%;transform:translateX(-50%);font-size:10px;opacity:.75}
#mp-hud .mp-room b{color:#ff6a2b}
#mp-hud .mp-status{position:absolute;top:40%;left:50%;transform:translate(-50%,-50%);font-size:14px;background:#000a;padding:10px 16px;display:none}
#mp-hud .mp-feed{position:absolute;top:120px;right:18px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:11px}
#mp-hud .mp-feed div{background:#000a;padding:4px 8px;border-left:2px solid #888}
#mp-hud .mp-feed .mine{border-color:#ff6a2b}
#mp-hud .mp-feed .me{border-color:#e33}
#mp-hud .mp-board{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:min(440px,92vw);background:linear-gradient(180deg,#121a20f2,#0a0f13f2);border:1px solid #ffffff1f;border-top:3px solid #ff6a2b;border-radius:6px;box-shadow:0 12px 40px #000a;padding:14px 16px 12px;display:none;letter-spacing:.08em}
#mp-hud .mp-board.dead,#mp-hud .mp-board.lobby{top:auto;bottom:6vh;transform:translateX(-50%)}
#mp-hud .mp-board .note{margin-top:10px;padding:8px 10px;border-radius:4px;background:#ff6a2b22;color:#ffd2bd;font-size:11px;line-height:1.6;text-align:center}
#mp-hud .mp-count{position:absolute;top:30%;left:50%;transform:translate(-50%,-50%);text-align:center;display:none;text-shadow:0 2px 8px #000}
#mp-hud .mp-count .big{font-size:84px;font-weight:700;color:#ff6a2b;line-height:1}
#mp-hud .mp-count .small{font-size:14px;margin-top:8px}
#mp-hud .mp-board.paused{left:auto;right:5vw;transform:translateY(-50%);width:min(400px,44vw)}
#mp-hud .mp-board .hd{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px}
#mp-hud .mp-board h3{margin:0;white-space:nowrap;font-size:14px;color:#ff6a2b;letter-spacing:.14em}
#mp-hud .mp-board .meta{font-size:10px;opacity:.7;white-space:nowrap}
#mp-hud .mp-board .row{display:grid;grid-template-columns:26px 1fr 46px 46px;align-items:center;gap:6px;padding:7px 8px;border-radius:4px;font-size:13px}
#mp-hud .mp-board .row+.row{margin-top:3px}
#mp-hud .mp-board .row.head{font-size:9px;opacity:.55;padding:0 8px 2px}
#mp-hud .mp-board .row.p{background:#ffffff0a}
#mp-hud .mp-board .row.me{background:#ff6a2b2e;outline:1px solid #ff6a2b88}
#mp-hud .mp-board .rk{font-weight:700;opacity:.8}
#mp-hud .mp-board .row.lead .rk{color:#ffc43d;opacity:1}
#mp-hud .mp-board .nm{display:flex;align-items:center;gap:8px;min-width:0;text-transform:none}
#mp-hud .mp-board .nm span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:uppercase}
#mp-hud .mp-board .dot{flex:none;width:10px;height:10px;border-radius:50%}
#mp-hud .mp-board .you{flex:none;font-size:9px;background:#ff6a2b;color:#111;padding:1px 5px;border-radius:3px;font-weight:700}
#mp-hud .mp-board .k,#mp-hud .mp-board .d{text-align:center;font-weight:700}
#mp-hud .mp-board .k{color:#7ee08a}
#mp-hud .mp-board .d{color:#ff7a7a}
#mp-hud .mp-board .row.head .k,#mp-hud .mp-board .row.head .d{color:inherit;font-weight:400}
#mp-hud .mp-board .wait{margin-top:8px;padding:9px 10px;border:1px dashed #ffffff33;border-radius:4px;font-size:10px;line-height:1.6;opacity:.85;text-align:center}
#mp-hud .mp-board .sub{margin-top:10px;font-size:10px;opacity:.7;text-align:center}
#mp-hud .mp-dead{position:absolute;top:20%;left:50%;transform:translateX(-50%);text-align:center;display:none}
#mp-hud .mp-dead .big{font-size:28px;font-weight:700;color:#e33;text-shadow:0 1px 4px #000}
#mp-hud .mp-dead .small{font-size:13px;margin-top:6px;text-shadow:0 1px 3px #000}
#mp-hud .mp-tag{position:absolute;transform:translate(-50%,-100%);font-size:10px;color:#ff8a8a;text-shadow:0 1px 2px #000;white-space:nowrap}
`;

/** the deathmatch's own HUD: clock, room code, kill feed, scoreboard (Tab), death and results, name tags */
export class MpHud {
  private el: HTMLDivElement;
  private clockEl: HTMLDivElement;
  private roomEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private feedEl: HTMLDivElement;
  private boardEl: HTMLDivElement;
  private deadEl: HTMLDivElement;
  private countEl: HTMLDivElement;
  private tagEls: HTMLDivElement[] = [];
  /** the last match's scores while the results are up (they stay until the next start) */
  private final: ScoreRow[] | null = null;
  private boardHtml = "";
  /** match time left (ms) */
  private left = 0;
  room = "";
  /** players in the room, you included */
  count = 0;
  tabHeld = false;

  constructor() {
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    this.el = document.createElement("div");
    this.el.id = "mp-hud";
    this.el.innerHTML = `<div class="mp-clock"></div><div class="mp-room"></div><div class="mp-status"></div><div class="mp-feed"></div><div class="mp-board"></div><div class="mp-dead"><div class="big"></div><div class="small"></div></div><div class="mp-count"><div class="big"></div><div class="small"></div></div>`;
    document.body.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLDivElement;
    this.clockEl = q(".mp-clock");
    this.roomEl = q(".mp-room");
    this.statusEl = q(".mp-status");
    this.feedEl = q(".mp-feed");
    this.boardEl = q(".mp-board");
    this.deadEl = q(".mp-dead");
    this.countEl = q(".mp-count");
    // (Tab can't be a bound action — browsers move focus with it — so the scoreboard listens for it itself)
    addEventListener("keydown", (e) => {
      if (e.code === "Tab") {
        e.preventDefault();
        this.tabHeld = true;
      }
    });
    addEventListener("keyup", (e) => {
      if (e.code === "Tab") this.tabHeld = false;
    });
  }

  status(text: string) {
    this.statusEl.textContent = text;
    this.statusEl.style.display = text ? "block" : "none";
  }

  /** the top line: the match clock, or what the room is doing ("WAITING ROOM", "MATCH OVER") */
  clock(ms: number, text = "") {
    this.left = ms;
    const s = Math.ceil(ms / 1000);
    this.clockEl.textContent = text || `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    this.clockEl.style.color = !text && s <= 30 ? "#ff6a2b" : "";
    this.clockEl.style.fontSize = text ? "16px" : "";
    this.roomEl.innerHTML = this.room
      ? `ROOM <b>${this.room}</b> · ${this.count <= 1 ? "<b>ONLY YOU HERE</b> — ESC → COPY INVITE LINK" : `${this.count} PLAYERS`} · HOLD TAB FOR SCORES`
      : "";
  }

  feed(text: string, cls = "") {
    const d = document.createElement("div");
    d.textContent = text;
    if (cls) d.className = cls;
    this.feedEl.appendChild(d);
    setTimeout(() => d.remove(), 6000);
    while (this.feedEl.children.length > 6) this.feedEl.firstChild?.remove();
  }

  /** the big countdown before a match ("3"), or nothing */
  countdown(s: number) {
    this.countEl.style.display = s > 0 ? "block" : "none";
    if (s > 0) {
      (this.countEl.querySelector(".big") as HTMLDivElement).textContent = String(s);
      (this.countEl.querySelector(".small") as HTMLDivElement).textContent = "GET READY — THE MATCH IS STARTING";
    }
  }

  /**
   * the scoreboard. "tab": centre; "dead": under the death message; "paused": beside the pause menu;
   * "lobby": along the bottom while the room waits. `note`: what happens next (who starts, which key)
   */
  board(scores: ScoreRow[], me: number, mode: "off" | "tab" | "dead" | "paused" | "lobby", note = "", meta = "") {
    const final = !!this.final;
    const rows = final ? this.final! : scores;
    if (mode === "off" && !final) {
      this.boardEl.style.display = "none";
      return;
    }
    const sorted = [...rows].sort((a, b) => b.k - a.k || a.d - b.d);
    // (level on kills and deaths at the top: nobody won)
    const draw = sorted.length > 1 && sorted[0].k === sorted[1].k && sorted[0].d === sorted[1].d;
    const title = final ? (sorted[0] && !draw ? `MATCH OVER — ${sorted[0].id === me ? "YOU WIN!" : esc(sorted[0].name) + " WINS"}` : draw ? "MATCH OVER — IT'S A DRAW" : "MATCH OVER") : mode === "lobby" ? "WAITING ROOM" : "PLAYERS IN THIS ROOM";
    const head = `ROOM ${esc(this.room)} · ${rows.length}/8${meta ? " · " + esc(meta) : final ? "" : ` · ${fmt(this.left)} LEFT`}`;
    const lead = sorted[0]?.k ?? 0;
    const html =
      `<div class="hd"><h3>${title}</h3><div class="meta">${head}</div></div>` +
      `<div class="row head"><div>#</div><div>PLAYER</div><div class="k">KILLS</div><div class="d">DEATHS</div></div>` +
      sorted
        .map(
          (r, i) =>
            `<div class="row p${r.id === me ? " me" : ""}${i === 0 && lead > 0 ? " lead" : ""}"><div class="rk">${i === 0 && lead > 0 ? "★" : i + 1}</div>` +
            `<div class="nm"><i class="dot" style="background:${color(r.id)}"></i><span>${esc(r.name)}</span>${r.id === me ? '<b class="you">YOU</b>' : ""}</div>` +
            `<div class="k">${r.k}</div><div class="d">${r.d}</div></div>`,
        )
        .join("") +
      (rows.length <= 1 && !final ? `<div class="wait">WAITING FOR FRIENDS…<br>PRESS ESC → <b>COPY INVITE LINK</b> AND SEND IT, OR TELL THEM ROOM CODE <b>${esc(this.room)}</b></div>` : "") +
      (note ? `<div class="note">${esc(note)}</div>` : "") +
      (mode === "tab" ? `<div class="sub">RELEASE TAB TO CLOSE</div>` : "");
    // (only touched when it changed: this runs every frame)
    if (html !== this.boardHtml) this.boardEl.innerHTML = this.boardHtml = html;
    this.boardEl.className = `mp-board${final && mode !== "paused" ? "" : mode === "dead" ? " dead" : mode === "paused" ? " paused" : mode === "lobby" ? " lobby" : ""}`;
    this.boardEl.style.display = "block";
  }

  /** the results up (the last match's scores), or down (a new match) */
  results(scores: ScoreRow[] | null) {
    this.final = scores;
  }

  dead(by: string | null) {
    this.deadEl.style.display = by ? "block" : "none";
    if (by) (this.deadEl.querySelector(".big") as HTMLDivElement).textContent = by === "THE FALL" ? "YOU DIED" : `KILLED BY ${by}`;
  }

  deadCountdown(s: number) {
    (this.deadEl.querySelector(".small") as HTMLDivElement).textContent = s > 0 ? `BACK IN ${s.toFixed(1)} S` : "RESPAWNING…";
  }

  /** a name over each player you can see */
  tags(list: { name: string; at: Vector3 }[], scene: Scene, engine: Engine) {
    const cam = scene.activeCamera;
    while (this.tagEls.length < list.length) {
      const d = document.createElement("div");
      d.className = "mp-tag";
      this.el.appendChild(d);
      this.tagEls.push(d);
    }
    const w = engine.getRenderWidth(), h = engine.getRenderHeight();
    const cw = engine.getRenderingCanvas()?.clientWidth ?? w, chh = engine.getRenderingCanvas()?.clientHeight ?? h;
    this.tagEls.forEach((d, i) => {
      const t = list[i];
      if (!t || !cam) return (d.style.display = "none");
      const fwd = cam.getDirection(Vector3.Forward());
      const rel = t.at.subtract(cam.globalPosition);
      const dist = rel.length();
      if (Vector3.Dot(rel, fwd) <= 0 || dist > 45) return (d.style.display = "none");
      const p = Vector3.Project(t.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      d.style.display = "block";
      d.style.left = `${(p.x / w) * cw}px`;
      d.style.top = `${(p.y / h) * chh}px`;
      d.textContent = t.name;
    });
  }
}

const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
/** each player's own colour (the same on every screen: from his id) */
const PALETTE = ["#4fc3f7", "#ffb74d", "#81c784", "#ba68c8", "#f06292", "#fff176", "#4db6ac", "#e57373"];
const color = (id: number) => PALETTE[id % PALETTE.length];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
