// Local-only measurement aid: a pass-through proxy in front of a LOCAL
// Supabase API (for example `supabase start` on :54321) that adds LATENCY_MS
// to every call, to model the Vercel → Supabase round trip, and records each
// call (GET /__stats returns and clears the log). Point the app's
// NEXT_PUBLIC_SUPABASE_URL at this proxy for a measurement build.
//   LATENCY_MS=110 UPSTREAM=http://127.0.0.1:54321 PORT=54331 node scripts/perf/latency-gateway.mjs
import http from "node:http";

const LATENCY = Number(process.env.LATENCY_MS ?? 0);
const UPSTREAM = new URL(process.env.UPSTREAM ?? "http://127.0.0.1:54321");
const PORT = Number(process.env.PORT ?? 54331);
if (!["127.0.0.1", "localhost"].includes(UPSTREAM.hostname)) throw new Error("The latency gateway only fronts a local Supabase stack.");

const log = [];
http
  .createServer((req, res) => {
    if (req.url === "/__stats") {
      res.end(JSON.stringify({ count: log.length, log: log.splice(0) }));
      return;
    }
    const t0 = Date.now();
    setTimeout(() => {
      const up = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port, path: req.url, method: req.method, headers: { ...req.headers, host: UPSTREAM.host } }, (u) => {
        res.writeHead(u.statusCode ?? 502, u.headers);
        u.pipe(res);
        u.on("end", () => log.push({ m: req.method, p: (req.url ?? "").split("?")[0], t0, t1: Date.now() }));
      });
      up.on("error", (e) => {
        res.writeHead(502);
        res.end(String(e));
      });
      req.pipe(up);
    }, LATENCY);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`latency gateway :${PORT} → ${UPSTREAM.origin} (+${LATENCY} ms per call)`));
