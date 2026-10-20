import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkFetchUrl, isPublicAddress, safeFetch } from "./safe-fetch";

describe("address checks", () => {
  it("refuses private, loopback, link-local, CGNAT, multicast, reserved, and documentation IPv4", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255",
      "192.0.0.8", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "151.101.1.1"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses internal IPv6, including IPv4-mapped, NAT64, and 6to4 forms of internal addresses", () => {
    for (const ip of [
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1",
      "::ffff:169.254.169.254", "::127.0.0.1", "64:ff9b::10.0.0.1", "64:ff9b:1::1", "2002:0a00:0001::1", "fec0::1", "2001::1", "not-an-ip",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"]) expect(isPublicAddress(ip), ip).toBe(true);
  });

  it("refuses unsafe URLs before any network access", () => {
    for (const url of [
      "file:///etc/passwd", "ftp://example.com/feed", "gopher://example.com", "https://user:pw@example.com/feed",
      "https://example.com:8443/feed", "http://localhost/feed", "http://127.0.0.1/feed", "http://[::1]/feed",
      "http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/", "http://printer.local/", "http://intranet/feed",
    ]) {
      expect(() => checkFetchUrl(url), url).toThrow();
    }
    expect(checkFetchUrl("https://feeds.example.com/podcast.xml").hostname).toBe("feeds.example.com");
  });
});

describe("safeFetch", () => {
  let server: http.Server | null = null;
  beforeAll(async () => {
    const srv = http.createServer((req, res) => {
      if (req.url === "/feed") return void res.end("<rss/>");
      if (req.url === "/big") {
        res.writeHead(200);
        res.write(Buffer.alloc(600_000));
        return void res.end(Buffer.alloc(600_000));
      }
      if (req.url === "/declared-big") {
        res.writeHead(200, { "content-length": "99999999" });
        return void res.end("x");
      }
      if (req.url === "/slow") return void setTimeout(() => res.end("late"), 1500);
      if (req.url === "/redirect-internal") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
        return void res.end();
      }
      if (req.url === "/redirect-rebind") {
        res.writeHead(302, { location: "http://rebind.example/feed" });
        return void res.end();
      }
      if (req.url === "/redirect-ok") {
        res.writeHead(301, { location: "/feed" });
        return void res.end();
      }
      if (req.url === "/redirect-loop") {
        res.writeHead(302, { location: "/redirect-loop" });
        return void res.end();
      }
      if (req.url === "/gzip") {
        res.writeHead(200, { "content-encoding": "gzip" });
        return void res.end("x");
      }
      res.writeHead(404);
      res.end();
    });
    // The fetcher only contacts standard ports, so the test server needs port
    // 80 (available to the test container); skipped where it isn't.
    server = await new Promise<http.Server | null>((resolve) => {
      srv.once("error", () => resolve(null));
      srv.listen(80, "127.0.0.1", () => resolve(srv));
    });
  });
  afterAll(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  // Production refuses loopback; here a fake public hostname resolves to the
  // test server and only the test's address check allows loopback.
  const testResolve = async (host: string) => [{ address: host === "feeds.test-host.example" ? "127.0.0.1" : "93.184.216.34", family: 4 }];
  const viaTestHost = (path: string, extra: Parameters<typeof safeFetch>[1] = {}) =>
    safeFetch(`http://feeds.test-host.example${path}`, { resolve: testResolve, isAllowedAddress: (ip) => ip === "127.0.0.1", ...extra });

  it("refuses a public-looking hostname that resolves to an internal address (production rules)", async () => {
    await expect(safeFetch("http://rebind.example/feed", { resolve: async () => [{ address: "127.0.0.1", family: 4 }] })).rejects.toMatchObject({
      code: "blocked_address",
    });
    await expect(
      safeFetch("http://mixed.example/feed", {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.5", family: 4 },
        ],
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("fetches, follows safe redirects, and enforces size, time, redirect, and encoding limits", async (ctx) => {
    if (!server) return ctx.skip();
    expect((await viaTestHost("/feed")).body.toString()).toBe("<rss/>");
    expect((await viaTestHost("/redirect-ok")).body.toString()).toBe("<rss/>");
    await expect(viaTestHost("/big", { maxBytes: 1_000_000 })).rejects.toMatchObject({ code: "too_large" });
    await expect(viaTestHost("/declared-big")).rejects.toMatchObject({ code: "too_large" });
    await expect(viaTestHost("/slow", { timeoutMs: 300 })).rejects.toMatchObject({ code: "timeout" });
    await expect(viaTestHost("/redirect-internal")).rejects.toMatchObject({ code: "blocked_address" });
    // A redirect to a host that resolves somewhere the address check refuses.
    await expect(
      safeFetch("http://feeds.test-host.example/redirect-rebind", {
        resolve: async (h) => [{ address: h === "rebind.example" ? "10.0.0.7" : "127.0.0.1", family: 4 }],
        isAllowedAddress: (ip) => ip === "127.0.0.1",
      }),
    ).rejects.toMatchObject({ code: "blocked_address" });
    await expect(viaTestHost("/redirect-loop")).rejects.toMatchObject({ code: "redirects" });
    await expect(viaTestHost("/gzip")).rejects.toMatchObject({ code: "http" });
  });
});
