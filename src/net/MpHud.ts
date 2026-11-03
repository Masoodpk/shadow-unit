import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core/Engines/engine";

export interface ScoreRow {
  id: number;
  name: string;
  k: number;
  d: number;
  /** team deathmatch: 0 or 1 (-1 / missing in free-for-all) */
  team?: number;
  /** reward points (kills and medals) */
  pts?: number;
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
#mp-hud .mp-tag{position:absolute;transform:translate(-50%,-100%);font-size:10px;color:#ff8a8a;text-shadow:0 1px 2px #000;white-space:nowrap;text-align:center}
#mp-hud .mp-tag.mate{color:#8fc8ff;font-weight:700}
#mp-hud .mp-tag.mate::after{content:"";display:block;margin:2px auto 0;width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid #4fa8ff;filter:drop-shadow(0 1px 1px #000)}
#mp-hud .mp-feed .mate{border-color:#4fa8ff}
#mp-hud .mp-feed .foe{border-color:#ff4a3d}
#mp-hud .mp-feed .kf{display:flex;gap:7px;align-items:center}
#mp-hud .mp-feed .kf .w{opacity:.7;font-size:10px}
#mp-hud .mp-feed .kf .s-mate{color:#8fc8ff}
#mp-hud .mp-feed .kf .s-foe{color:#ff8a80}
#mp-hud .mp-teams{position:absolute;top:10px;left:50%;transform:translateX(-50%);width:min(380px,92vw);display:none;justify-content:space-between;align-items:flex-start;pointer-events:none}
#mp-hud .mp-teams .tm{width:120px;display:grid;gap:4px}
#mp-hud .mp-teams .row1{display:flex;align-items:baseline;gap:8px;text-shadow:0 1px 3px #000}
#mp-hud .mp-teams .foe .row1{justify-content:flex-end}
#mp-hud .mp-teams .n{font-size:10px;letter-spacing:.18em;opacity:.85}
#mp-hud .mp-teams b{font-size:24px;line-height:1;letter-spacing:.02em}
#mp-hud .mp-teams .mine b,#mp-hud .mp-teams .mine .n{color:#6db8ff}
#mp-hud .mp-teams .foe b,#mp-hud .mp-teams .foe .n{color:#ff6a5c}
#mp-hud .mp-teams .bar{height:4px;background:#ffffff1c;border-radius:2px;overflow:hidden}
#mp-hud .mp-teams .bar i{display:block;height:100%;transition:width .4s ease}
#mp-hud .mp-teams .mine .bar i{background:#4fa8ff}
#mp-hud .mp-teams .foe .bar{transform:scaleX(-1)}
#mp-hud .mp-teams .foe .bar i{background:#ff4a3d}
#mp-hud .mp-board .team{display:flex;justify-content:space-between;align-items:baseline;margin:10px 0 4px;padding:6px 8px;border-radius:4px;font-size:11px;letter-spacing:.16em;font-weight:700}
#mp-hud .mp-board .team b{font-size:16px}
#mp-hud .mp-board .team.mine{background:#4fa8ff26;color:#8fc8ff;border-left:3px solid #4fa8ff}
#mp-hud .mp-board .team.foe{background:#ff4a3d22;color:#ff9a90;border-left:3px solid #ff4a3d}
#mp-hud .mp-board .team.side{background:#ffffff12;color:#e8edf2;border-left:3px solid #c9d1d9}
#mp-hud .mp-board .team.none{background:transparent;color:#9aa4ad;border:1px dashed #ffffff33}
#mp-hud .mp-board .empty{padding:6px 8px;font-size:10px;opacity:.5}
#mp-hud .mp-board h3.win{color:#ffc43d}
#mp-hud .mp-board h3.lose{color:#ff6a5c}
#mp-hud .mp-medals{position:absolute;top:58%;left:50%;transform:translateX(-50%);width:min(600px,94vw);display:flex;flex-wrap:wrap;justify-content:center;align-items:flex-end;gap:6px 22px}
#mp-hud .md{display:flex;flex-direction:column;align-items:center;animation:mdIn 2.4s cubic-bezier(.2,.9,.3,1.2) both;--c:#ffc43d}
#mp-hud .md .ic{width:46px;height:52px;display:grid;place-items:center;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);background:linear-gradient(160deg,var(--c),color-mix(in srgb,var(--c) 35%,#000));color:#111;font-weight:800;font-size:15px;letter-spacing:0;box-shadow:inset 0 0 0 2px #fff5}
#mp-hud .md .ic svg{width:26px;height:26px}
#mp-hud .md .nm{margin-top:5px;font-size:15px;white-space:nowrap;font-weight:800;letter-spacing:.16em;color:var(--c);background:linear-gradient(100deg,var(--c) 40%,#fff 50%,var(--c) 60%) 200% 0/250% 100%;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;animation:mdShine 1.1s .25s ease-out both;filter:drop-shadow(0 2px 3px #000c)}
#mp-hud .md.small .ic{display:none}
#mp-hud .md.small .nm{font-size:12px}
#mp-hud .md.red{--c:#ff5040}
#mp-hud .md.gold{--c:#ffc43d}
#mp-hud .md.cyan{--c:#5ad8ff}
#mp-hud .md.orange{--c:#ff7a2b}
#mp-hud .md.grey{--c:#d8dee4}
#mp-hud .mp-pts{flex-basis:100%;text-align:center;font-size:14px;font-weight:800;color:#fff;text-shadow:0 1px 3px #000;animation:mdIn 2.4s ease both;letter-spacing:.1em}
#mp-hud .mp-banner{position:absolute;top:24%;left:50%;transform:translateX(-50%);text-align:center;display:none;text-shadow:0 2px 10px #000}
#mp-hud .mp-banner .big{font-size:44px;font-weight:800;letter-spacing:.22em;color:#6db8ff}
#mp-hud .mp-banner.ffa .big{color:#ff6a2b}
#mp-hud .mp-banner .small{font-size:13px;margin-top:6px;letter-spacing:.2em}
#mp-hud .mp-banner.go{display:block;animation:bnIn 2.8s ease both}
@keyframes mdIn{0%{opacity:0;transform:scale(2.3);filter:blur(4px)}10%{opacity:1;transform:scale(.92);filter:none}18%{transform:scale(1)}82%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-18px) scale(.96)}}
@keyframes mdShine{from{background-position:200% 0}to{background-position:-50% 0}}
@keyframes bnIn{0%{opacity:0;transform:translateX(-50%) scale(1.4)}12%{opacity:1;transform:translateX(-50%) scale(1)}80%{opacity:1}100%{opacity:0}}
@media (prefers-reduced-motion:reduce){#mp-hud .md,#mp-hud .mp-pts,#mp-hud .mp-banner.go{animation-duration:2.4s;animation-name:mdFade}#mp-hud .md .nm{animation:none;background-position:0 0}}
@keyframes mdFade{0%,85%{opacity:1}100%{opacity:0}}
`;

/** each medal's look: colour tier and the badge's emblem */
const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/></svg>`;
const SCOPE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>`;
const BLOW = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M4 20 16 8M14 4l6 6M3 14l7 7"/></svg>`;
const MEDAL: Record<string, { tier: string; ic: string }> = {
  HEADSHOT: { tier: "red", ic: CROSS },
  "FIRST BLOOD": { tier: "orange", ic: "1ST" },
  "DOUBLE KILL": { tier: "gold", ic: "×2" },
  "TRIPLE KILL": { tier: "gold", ic: "×3" },
  "QUAD KILL": { tier: "gold", ic: "×4" },
  "MEGA KILL": { tier: "gold", ic: "×5" },
  "KILLING SPREE": { tier: "gold", ic: "3" },
  RAMPAGE: { tier: "gold", ic: "5" },
  DOMINATING: { tier: "gold", ic: "7" },
  UNSTOPPABLE: { tier: "gold", ic: "10" },
  GODLIKE: { tier: "gold", ic: "15" },
  REVENGE: { tier: "orange", ic: "↺" },
  SHUTDOWN: { tier: "orange", ic: "✕" },
  LONGSHOT: { tier: "cyan", ic: SCOPE },
  "POINT BLANK": { tier: "cyan", ic: "•" },
  "MELEE KILL": { tier: "orange", ic: BLOW },
  ASSIST: { tier: "grey", ic: "+" },
};
/** the plain medals (a small line of text); the rest get a badge */
const SMALL = new Set(["POINT BLANK", "ASSIST"]);

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
  private teamsEl: HTMLDivElement;
  private medalsEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private teamsHtml = "";
  /** your side at the results (team deathmatch), -1 in free-for-all */
  private finalTeam = -1;
  /** the room plays teams, and their names (the host's) */
  tdm = false;
  teamNames = ["ALPHA", "BRAVO"];
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
    this.el.innerHTML = `<div class="mp-clock"></div><div class="mp-room"></div><div class="mp-status"></div><div class="mp-feed"></div><div class="mp-board"></div><div class="mp-dead"><div class="big"></div><div class="small"></div></div><div class="mp-count"><div class="big"></div><div class="small"></div></div><div class="mp-medals"></div><div class="mp-banner"><div class="big"></div><div class="small"></div></div>`;
    // (the team scores go before the clock: the clock moves for them in CSS)
    this.teamsEl = document.createElement("div");
    this.teamsEl.className = "mp-teams";
    this.el.insertBefore(this.teamsEl, this.el.firstChild);
    document.body.appendChild(this.el);
    const q = (s: string) => this.el.querySelector(s) as HTMLDivElement;
    this.clockEl = q(".mp-clock");
    this.roomEl = q(".mp-room");
    this.statusEl = q(".mp-status");
    this.feedEl = q(".mp-feed");
    this.boardEl = q(".mp-board");
    this.deadEl = q(".mp-dead");
    this.countEl = q(".mp-count");
    this.medalsEl = q(".mp-medals");
    this.bannerEl = q(".mp-banner");
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

  /** a kill in the feed: killer, weapon, victim — names in their side's colour (team deathmatch) */
  killFeed(by: string, bySide: string, w: string, to: string, toSide: string, cls = "") {
    const d = document.createElement("div");
    d.className = `kf ${cls}`;
    d.innerHTML = `<span class="s-${bySide}">${esc(by)}</span><span class="w">[${esc(w)}]</span><span class="s-${toSide}">${esc(to)}</span>`;
    this.feedEl.appendChild(d);
    setTimeout(() => d.remove(), 6000);
    while (this.feedEl.children.length > 6) this.feedEl.firstChild?.remove();
  }

  /** the rewards for your kill: one animated badge per medal (one after another), then the points */
  medals(list: string[], pts: number) {
    const items = list.length ? list : ["ENEMY KILLED"];
    items.forEach((name, i) => {
      setTimeout(() => {
        const m = MEDAL[name];
        const d = document.createElement("div");
        d.className = `md ${m?.tier ?? "grey"}${!m || SMALL.has(name) ? " small" : ""}`;
        d.innerHTML = `<div class="ic">${m?.ic ?? ""}</div><div class="nm">${esc(name)}</div>`;
        this.medalsEl.appendChild(d);
        setTimeout(() => d.remove(), 2400);
        // (a burst of them: the oldest go first)
        while (this.medalsEl.querySelectorAll(".md").length > 3) this.medalsEl.querySelector(".md")?.remove();
      }, i * 260);
    });
    setTimeout(() => {
      const d = document.createElement("div");
      d.className = "mp-pts";
      d.textContent = `+${pts}`;
      this.medalsEl.appendChild(d);
      setTimeout(() => d.remove(), 2400);
      while (this.medalsEl.querySelectorAll(".mp-pts").length > 1) this.medalsEl.querySelector(".mp-pts")?.remove();
    }, items.length * 260);
  }

  /** a big line across the screen at the start of a match ("TEAM ALPHA") */
  banner(big: string, small: string) {
    this.bannerEl.className = `mp-banner${big.startsWith("TEAM") ? "" : " ffa"}`;
    (this.bannerEl.querySelector(".big") as HTMLDivElement).textContent = big;
    (this.bannerEl.querySelector(".small") as HTMLDivElement).textContent = small;
    // (restart the animation)
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add("go");
  }

  /** team deathmatch: the two sides' kills either side of the clock (yours on the left, blue), or none */
  teamBar(t: { mine: number; theirs: number; name: string; other: string } | null) {
    const html = t
      ? (() => {
          const top = Math.max(1, t.mine, t.theirs);
          return (
            `<div class="tm mine"><div class="row1"><b>${t.mine}</b><span class="n">${esc(t.name)}</span></div><div class="bar"><i style="width:${(t.mine / top) * 100}%"></i></div></div>` +
            `<div class="tm foe"><div class="row1"><span class="n">${esc(t.other)}</span><b>${t.theirs}</b></div><div class="bar"><i style="width:${(t.theirs / top) * 100}%"></i></div></div>`
          );
        })()
      : "";
    if (html === this.teamsHtml) return;
    this.teamsHtml = html;
    this.teamsEl.innerHTML = html;
    this.teamsEl.style.display = t ? "flex" : "none";
    this.teamsEl.classList.toggle("on", !!t);
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
  board(scores: ScoreRow[], me: number, mode: "off" | "tab" | "dead" | "paused" | "lobby", note = "", meta = "", myTeam = -1) {
    const final = !!this.final;
    // (the results keep the side you were on when the match ended)
    const team = final ? this.finalTeam : myTeam;
    const rows = final ? this.final! : scores;
    if (mode === "off" && !final) {
      this.boardEl.style.display = "none";
      return;
    }
    const sorted = [...rows].sort((a, b) => b.k - a.k || a.d - b.d);
    // (level on kills and deaths at the top: nobody won)
    const draw = sorted.length > 1 && sorted[0].k === sorted[1].k && sorted[0].d === sorted[1].d;
    // team deathmatch: the sides' kills, yours first
    const tk = [0, 1].map((t) => rows.filter((r) => r.team === t).reduce((a, r) => a + r.k, 0));
    let title = final ? (sorted[0] && !draw ? `MATCH OVER — ${sorted[0].id === me ? "YOU WIN!" : esc(sorted[0].name) + " WINS"}` : draw ? "MATCH OVER — IT'S A DRAW" : "MATCH OVER") : mode === "lobby" ? "WAITING ROOM" : "PLAYERS IN THIS ROOM";
    let titleCls = "";
    if (final && team >= 0) {
      const mine = tk[team], theirs = tk[1 - team];
      title = mine > theirs ? "VICTORY" : mine < theirs ? "DEFEAT" : "DRAW";
      titleCls = mine > theirs ? "win" : mine < theirs ? "lose" : "";
      title += ` — ${mine} : ${theirs}`;
    }
    const head = `ROOM ${esc(this.room)} · ${rows.length}/8${meta ? " · " + esc(meta) : final ? "" : ` · ${fmt(this.left)} LEFT`}`;
    const rowsOf = (list: ScoreRow[], dot: (r: ScoreRow) => string) => {
      const lead = list[0]?.k ?? 0;
      return list
        .map(
          (r, i) =>
            `<div class="row p${r.id === me ? " me" : ""}${i === 0 && lead > 0 ? " lead" : ""}"><div class="rk">${i === 0 && lead > 0 ? "★" : i + 1}</div>` +
            `<div class="nm"><i class="dot" style="background:${dot(r)}"></i><span>${esc(r.name)}</span>${r.id === me ? '<b class="you">YOU</b>' : ""}</div>` +
            `<div class="k">${r.k}</div><div class="d">${r.d}</div></div>`,
        )
        .join("");
    };
    const colHead = `<div class="row head"><div>#</div><div>PLAYER</div><div class="k">KILLS</div><div class="d">DEATHS</div></div>`;
    // team deathmatch: the two sides (yours first, blue; theirs red — or both plain while you're on
    // neither), then whoever the host hasn't put on a side yet
    const tdm = this.tdm || (final && team >= 0);
    const body = tdm
      ? (team >= 0 ? [team, 1 - team] : [0, 1])
          .map((t) => {
            const side = team < 0 ? "side" : t === team ? "mine" : "foe";
            const label = team < 0 ? esc(this.teamNames[t]) : `${t === team ? "YOUR TEAM" : "ENEMY"} · ${esc(this.teamNames[t])}`;
            const list = sorted.filter((r) => r.team === t);
            return `<div class="team ${side}"><span>${label}</span><b>${tk[t]}</b></div>` + (list.length ? rowsOf(list, () => (side === "mine" ? "#4fa8ff" : side === "foe" ? "#ff4a3d" : "#c9d1d9")) : `<div class="empty">NOBODY YET</div>`);
          })
          .join("") +
        (() => {
          const loose = sorted.filter((r) => r.team !== 0 && r.team !== 1);
          return loose.length ? `<div class="team none"><span>NO TEAM YET</span><b>${loose.length}</b></div>` + rowsOf(loose, () => "#6b7580") : "";
        })()
      : colHead + rowsOf(sorted, (r) => color(r.id));
    const html =
      `<div class="hd"><h3 class="${titleCls}">${title}</h3><div class="meta">${head}</div></div>` +
      (tdm ? colHead : "") +
      body +
      (rows.length <= 1 && !final ? `<div class="wait">WAITING FOR FRIENDS…<br>PRESS ESC → <b>COPY INVITE LINK</b> AND SEND IT, OR TELL THEM ROOM CODE <b>${esc(this.room)}</b></div>` : "") +
      (note ? `<div class="note">${esc(note)}</div>` : "") +
      (mode === "tab" ? `<div class="sub">RELEASE TAB TO CLOSE</div>` : "");
    // (only touched when it changed: this runs every frame)
    if (html !== this.boardHtml) this.boardEl.innerHTML = this.boardHtml = html;
    this.boardEl.className = `mp-board${final && mode !== "paused" ? "" : mode === "dead" ? " dead" : mode === "paused" ? " paused" : mode === "lobby" ? " lobby" : ""}`;
    this.boardEl.style.display = "block";
  }

  /** the results up (the last match's scores), or down (a new match) */
  results(scores: ScoreRow[] | null, team = -1) {
    this.final = scores;
    this.finalTeam = team;
  }

  dead(by: string | null) {
    this.deadEl.style.display = by ? "block" : "none";
    if (by) (this.deadEl.querySelector(".big") as HTMLDivElement).textContent = by === "THE FALL" ? "YOU DIED" : `KILLED BY ${by}`;
  }

  deadCountdown(s: number) {
    (this.deadEl.querySelector(".small") as HTMLDivElement).textContent = s > 0 ? `BACK IN ${s.toFixed(1)} S` : "RESPAWNING…";
  }

  /** a name over each player shown (teammates: blue with a chevron, at any range) */
  tags(list: { name: string; at: Vector3; mate?: boolean }[], scene: Scene, engine: Engine) {
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
      if (Vector3.Dot(rel, fwd) <= 0 || (!t.mate && dist > 45)) return (d.style.display = "none");
      const p = Vector3.Project(t.at, Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
      d.style.display = "block";
      d.style.left = `${(p.x / w) * cw}px`;
      d.style.top = `${(p.y / h) * chh}px`;
      d.className = t.mate ? "mp-tag mate" : "mp-tag";
      d.textContent = t.mate ? `${t.name} · ${Math.round(dist)} M` : t.name;
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
