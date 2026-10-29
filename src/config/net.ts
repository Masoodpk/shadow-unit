/**
 * Where the online deathmatch server is (server/, deployed on Render's free plan by render.yaml).
 *
 *   - a build with VITE_MP_URL set (Vercel → Settings → Environment Variables): that;
 *   - the game opened from this computer or the home network (npm run dev): port 8787 on that machine;
 *   - otherwise (the public site): the Render service.
 */
export const MP_PUBLIC_SERVER = "wss://shadow-unit-mp.onrender.com";

const isLocal = (host: string) =>
  host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local") || /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);

export function mpServerUrl(): string {
  const env = import.meta.env.VITE_MP_URL as string | undefined;
  if (env) return env;
  if (isLocal(location.hostname)) return `ws://${location.hostname}:8787`;
  return MP_PUBLIC_SERVER;
}

/** the same server's health check, over http(s) (the MULTIPLAYER screen polls it: it also wakes a sleeping host) */
export const mpHealthUrl = (ws: string) => ws.replace(/^ws/, "http").replace(/\/$/, "") + "/health";
