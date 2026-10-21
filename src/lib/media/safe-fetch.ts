import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

/**
 * Server-side fetching of administrator-supplied URLs (podcast feeds), safe
 * against SSRF:
 *   - http/https only, default ports only, no credentials in the URL;
 *   - every DNS answer is checked at connect time and private, loopback,
 *     link-local, carrier-grade NAT, multicast, reserved, documentation, and
 *     IPv4-mapped/translated internal addresses are refused, so a hostname
 *     that re-resolves to an internal address (DNS rebinding) still fails;
 *   - the request always uses its own agent, so an ambient proxy (for example
 *     NODE_USE_ENV_PROXY with HTTP_PROXY, or a replaced http.globalAgent)
 *     can't route around the lookup, and the connected peer address is
 *     checked again before any response is read;
 *   - redirects are followed manually (at most 3), each one rechecked;
 *   - total time and response size are capped, and compressed bodies are
 *     refused unless decoded within the same cap.
 */
export class SafeFetchError extends Error {
  constructor(
    readonly code: "invalid_url" | "blocked_address" | "dns" | "timeout" | "too_large" | "redirects" | "http" | "network",
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

// ---------------------------------------------------------------------------
// Address checks
// ---------------------------------------------------------------------------
function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];

export function isBlockedIPv4(ip: string): boolean {
  if (isIP(ip) !== 4) return true;
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (v4ToInt(base) & mask);
  });
}

/** Expands an IPv6 address to eight 16-bit groups. */
function v6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase().split("%")[0];
  // Trailing dotted IPv4 (e.g. ::ffff:10.0.0.1)
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    if (isIP(v4[1]) !== 4) return null;
    const n = v4ToInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  if (addr.split("::").length > 2) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = t === null ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  if (groups.length !== 8) return null;
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some((n) => Number.isNaN(n)) ? null : nums;
}

export function isBlockedIPv6(ip: string): boolean {
  const g = v6Groups(ip);
  if (!g) return true;
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (g.every((x) => x === 0)) return true; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): check the IPv4 address.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedIPv4(embeddedV4(g[6], g[7]));
  // NAT64 well-known prefix 64:ff9b::/96 and local-use 64:ff9b:1::/48.
  if (g[0] === 0x64 && g[1] === 0xff9b) return g[2] === 1 || isBlockedIPv4(embeddedV4(g[6], g[7]));
  // 6to4 (2002::/16) carries an IPv4 address in groups 1–2.
  if (g[0] === 0x2002) return isBlockedIPv4(embeddedV4(g[1], g[2]));
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only 100::/64
  if (g[0] === 0x2001 && g[1] < 0x200) return true; // 2001::/23 IETF protocol assignments (Teredo, ORCHID…)
  return false;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return !isBlockedIPv4(ip);
  if (family === 6) return !isBlockedIPv6(ip);
  return false;
}

// ---------------------------------------------------------------------------
// URL checks
// ---------------------------------------------------------------------------
export function checkFetchUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError("invalid_url", "That isn't a valid web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError("invalid_url", "Only http and https addresses are allowed.");
  if (url.username || url.password) throw new SafeFetchError("invalid_url", "Addresses with a user name or password aren't allowed.");
  const defaultPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== defaultPort) throw new SafeFetchError("invalid_url", "Only standard web ports are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new SafeFetchError("blocked_address", "That address points to a private network.");
  }
  if (isIP(host) && !isPublicAddress(host)) throw new SafeFetchError("blocked_address", "That address points to a private network.");
  if (!isIP(host) && !host.includes(".")) throw new SafeFetchError("invalid_url", "Use a full public web address.");
  return url;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------
export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  /** Tests only: decides which resolved addresses may be contacted. */
  isAllowedAddress?: (ip: string) => boolean;
  /** Tests only: replaces DNS resolution. */
  resolve?: (host: string) => Promise<LookupAddress[]>;
};

export type SafeFetchResult = { status: number; url: string; headers: http.IncomingHttpHeaders; body: Buffer };

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 5 * 1024 * 1024, maxRedirects: 3 };

function resolveAll(host: string): Promise<LookupAddress[]> {
  return new Promise((resolve, reject) =>
    dnsLookup(host, { all: true, verbatim: true }, (err, addresses) => (err ? reject(err) : resolve(addresses))),
  );
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const opts = { ...DEFAULTS, ...options };
  const allowed = opts.isAllowedAddress ?? isPublicAddress;
  const resolver = opts.resolve ?? resolveAll;
  const deadline = Date.now() + opts.timeoutMs;
  let current = checkFetchUrl(input);

  for (let hop = 0; hop <= opts.maxRedirects; hop++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new SafeFetchError("timeout", "The address took too long to respond.");
    const result = await requestOnce(current, { ...opts, timeoutMs: remaining }, allowed, resolver);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.location;
      if (!location) throw new SafeFetchError("http", "The address redirected without a destination.", result.status);
      if (hop === opts.maxRedirects) throw new SafeFetchError("redirects", "The address redirected too many times.");
      current = checkFetchUrl(new URL(location, current).toString());
      continue;
    }
    return result;
  }
  throw new SafeFetchError("redirects", "The address redirected too many times.");
}

function requestOnce(
  url: URL,
  opts: Required<Pick<SafeFetchOptions, "timeoutMs" | "maxBytes">> & SafeFetchOptions,
  allowed: (ip: string) => boolean,
  resolver: (host: string) => Promise<LookupAddress[]>,
): Promise<SafeFetchResult> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    let settled = false;
    const fail = (err: SafeFetchError) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    // Resolution and the address check happen inside the socket's own lookup,
    // so the address that is checked is the address that is connected to.
    const lookup = (hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void) => {
      const literal = isIP(hostname);
      const done = (addresses: LookupAddress[]) => {
        const ok = addresses.filter((a) => allowed(a.address));
        if (!addresses.length) return callback(Object.assign(new Error("No address"), { code: "ENOTFOUND" }), "", 4);
        // Every answer must be public: a mixed answer is an attack signal.
        if (ok.length !== addresses.length) {
          return callback(Object.assign(new Error("Blocked address"), { code: "EBLOCKED" }), "", 4);
        }
        const wantAll = (_options as { all?: boolean } | undefined)?.all;
        if (wantAll) return callback(null, ok);
        return callback(null, ok[0].address, ok[0].family);
      };
      if (literal) return done([{ address: hostname, family: literal }]);
      resolver(hostname).then(done, (err: NodeJS.ErrnoException) => callback(err, "", 4));
    };
    // A dedicated, non-proxying agent: the global agent may be configured to
    // send requests through a proxy, which resolves the host itself and would
    // skip the lookup above entirely.
    const agent = url.protocol === "https:" ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
    const req = lib.request(
      url,
      {
        method: "GET",
        agent,
        lookup: lookup as unknown as typeof dnsLookup,
        headers: {
          "user-agent": "TheGatheringFeedReader/1.0 (+https://www.gathering.church)",
          accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1",
          "accept-encoding": "identity",
          ...opts.headers,
        },
        timeout: opts.timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          settled = true;
          return resolve({ status, url: url.toString(), headers: res.headers, body: Buffer.alloc(0) });
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > opts.maxBytes) {
          res.destroy();
          return fail(new SafeFetchError("too_large", "The response is too large."));
        }
        const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
        if (encoding !== "identity" && encoding !== "") {
          res.destroy();
          return fail(new SafeFetchError("http", "The response used an unsupported encoding."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > opts.maxBytes) {
            res.destroy();
            fail(new SafeFetchError("too_large", "The response is too large."));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          if (settled) return;
          settled = true;
          resolve({ status, url: url.toString(), headers: res.headers, body: Buffer.concat(chunks) });
        });
        res.on("error", () => fail(new SafeFetchError("network", "The connection was interrupted.")));
      },
    );
    // Defense in depth: whatever connected the socket, the peer must be an
    // allowed address (a proxy or patched agent on a private address fails).
    req.on("socket", (socket) => {
      const verifyPeer = () => {
        const peer = socket.remoteAddress;
        if (!peer || !allowed(peer)) {
          fail(new SafeFetchError("blocked_address", "That address points to a private network."));
          req.destroy();
        }
      };
      if (socket.remoteAddress) verifyPeer();
      else socket.once("connect", verifyPeer);
    });
    const timer = setTimeout(() => {
      req.destroy();
      fail(new SafeFetchError("timeout", "The address took too long to respond."));
    }, opts.timeoutMs);
    req.on("timeout", () => {
      req.destroy();
      fail(new SafeFetchError("timeout", "The address took too long to respond."));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EBLOCKED") fail(new SafeFetchError("blocked_address", "That address points to a private network."));
      else if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") fail(new SafeFetchError("dns", "That address couldn't be found."));
      else fail(new SafeFetchError("network", "The address couldn't be reached."));
    });
    req.on("close", () => {
      clearTimeout(timer);
      agent.destroy();
    });
    req.end();
  });
}
