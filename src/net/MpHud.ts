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
#mp-hud .mp-board{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:360px;background:#0b0f14e6;border:1px solid #ffffff22;padding:16px 20px;display:none}
#mp-hud .mp-board h3{margin:0 0 10px;font-size:13px;color:#ff6a2b}
#mp-hud .mp-board table{width:100%;border-collapse:collapse;font-size:12px}
#mp-hud .mp-board td{padding:5px 6px;border-top:1px solid #ffffff14}
#mp-hud .mp-board td.n{text-align:right;width:52px}
#mp-hud .mp-board tr.me td{color:#ff6a2b}
#mp-hud .mp-board .sub{margin-top:10px;font-size:10px;opacity:.7}
#mp-hud .mp-dead{position:absolute;top:58%;left:50%;transform:translateX(-50%);text-align:center;display:none}
#mp-hud .mp-dead .big{font-size:26px;font-weight:700;color:#e33;text-shadow:0 1px 4px #000}
#mp-hud .mp-dead .small{font-size:12px;margin-top:6px}
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
  private tagEls: HTMLDivElement[] = [];
  private resultsUntil = 0;
  private final: ScoreRow[] | null = null;
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
    this.el.innerHTML = `<div class="mp-clock"></div><div class="mp-room"></div><div class="mp-status"></div><div class="mp-feed"></div><div class="mp-board"></div><div class="mp-dead"><div class="big"></div><div class="small"></div></div>`;
    document.body.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLDivElement;
    this.clockEl = q(".mp-clock");
    this.roomEl = q(".mp-room");
    this.statusEl = q(".mp-status");
    this.feedEl = q(".mp-feed");
    this.boardEl = q(".mp-board");
    this.deadEl = q(".mp-dead");
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

  clock(ms: number) {
    const s = Math.ceil(ms / 1000);
    this.clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    this.clockEl.style.color = s <= 30 ? "#ff6a2b" : "";
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

  board(scores: ScoreRow[], me: number, show: boolean) {
    const final = this.final && performance.now() < this.resultsUntil;
    const rows = final ? this.final! : scores;
    if (!show && !final) {
      this.boardEl.style.display = "none";
      return;
    }
    const sorted = [...rows].sort((a, b) => b.k - a.k || a.d - b.d);
    const title = final ? (sorted[0] ? `MATCH OVER — ${sorted[0].id === me ? "YOU WIN" : sorted[0].name + " WINS"}` : "MATCH OVER") : "SCOREBOARD";
    const sub = final ? `NEXT MATCH IN ${Math.max(0, Math.ceil((this.resultsUntil - performance.now()) / 1000))} S` : "";
    this.boardEl.innerHTML =
      `<h3>${title}</h3><table><tr><td>#</td><td>PLAYER</td><td class="n">KILLS</td><td class="n">DEATHS</td></tr>` +
      sorted.map((r, i) => `<tr class="${r.id === me ? "me" : ""}"><td>${i + 1}</td><td>${esc(r.name)}${r.id === me ? " (YOU)" : ""}</td><td class="n">${r.k}</td><td class="n">${r.d}</td></tr>`).join("") +
      `</table>${sub ? `<div class="sub">${sub}</div>` : ""}`;
    this.boardEl.style.display = "block";
  }

  results(scores: ScoreRow[] | null, _me: number, nextMs: number) {
    this.final = scores;
    this.resultsUntil = scores ? performance.now() + nextMs : 0;
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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
