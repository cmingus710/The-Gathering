import { describe, expect, it } from "vitest";
import {
  appleEmbed,
  normalizeAudibleUrl,
  normalizeKindleUrl,
  parseApplePodcasts,
  parsePodcastProvider,
  parseProviderRefString,
  parseSpotify,
  parseVideoUrl,
  providerRefString,
  spotifyEmbed,
  videoEmbed,
} from "./embeds";

describe("video links", () => {
  it("accepts YouTube in its common forms and rebuilds a privacy-enhanced embed", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=42",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ]) {
      expect(parseVideoUrl(url)).toEqual({ provider: "youtube", id: "dQw4w9WgXcQ" });
    }
    const e = videoEmbed({ provider: "youtube", id: "dQw4w9WgXcQ" }, { origin: "https://app.example" });
    expect(e.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(e.src).toContain("enablejsapi=1");
    expect(e.src).toContain("origin=https%3A%2F%2Fapp.example");
    expect(e.src).not.toContain("autoplay");
  });

  it("accepts Vimeo, including unlisted hashes", () => {
    expect(parseVideoUrl("https://vimeo.com/76979871")).toEqual({ provider: "vimeo", id: "76979871", hash: null });
    expect(parseVideoUrl("https://vimeo.com/76979871/abc123def4")).toEqual({ provider: "vimeo", id: "76979871", hash: "abc123def4" });
    expect(parseVideoUrl("https://player.vimeo.com/video/76979871?h=abc123def4")).toEqual({ provider: "vimeo", id: "76979871", hash: "abc123def4" });
    expect(videoEmbed({ provider: "vimeo", id: "76979871", hash: "abc123def4" }).src).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&playsinline=1&title=0&byline=0&portrait=0&h=abc123def4",
    );
  });

  it("refuses look-alike hosts, other schemes, credentials, odd ports, and bad ids", () => {
    for (const url of [
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
      "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ\"><script>",
      "https://vimeo.com/abc",
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    ]) {
      expect(parseVideoUrl(url)).toBeNull();
    }
  });
});

describe("Spotify", () => {
  it("accepts playlist links with locale and tracking parts, and builds the official embed", () => {
    const ref = parseSpotify("https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abcdef", ["playlist"]);
    expect(ref).toEqual({ provider: "spotify", kind: "playlist", id: "37i9dQZF1DXcBWIGoYBM5M" });
    const e = spotifyEmbed(ref!);
    expect(e.src).toBe("https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=generator");
    expect(e.openUrl).toBe("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M");
    // Full-size player (cover, controls, and track list), not the compact strip.
    expect(e.height).toBe(352);
    expect(e.sandbox).toBeUndefined();
  });

  it("refuses other kinds, hosts, http, and malformed ids", () => {
    expect(parseSpotify("https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", ["playlist"])).toBeNull();
    expect(parseSpotify("http://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", ["playlist"])).toBeNull();
    expect(parseSpotify("https://spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M", ["playlist"])).toBeNull();
    expect(parseSpotify("https://open.spotify.com/playlist/37i9dQZF1DXc", ["playlist"])).toBeNull();
    expect(parseSpotify("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M", ["playlist"])).toBeNull();
  });
});

describe("podcast providers", () => {
  it("parses Apple Podcasts shows and episodes and round-trips stored references", () => {
    const show = parseApplePodcasts("https://podcasts.apple.com/us/podcast/the-example-show/id1234567890");
    expect(show).toEqual({ provider: "apple", country: "us", slug: "the-example-show", showId: "1234567890", episodeId: null });
    const ep = parsePodcastProvider("https://podcasts.apple.com/gb/podcast/the-example-show/id1234567890?i=1000600000000")!;
    expect(appleEmbed(ep as never).src).toBe("https://embed.podcasts.apple.com/gb/podcast/the-example-show/id1234567890?i=1000600000000");
    for (const ref of [show!, ep, parsePodcastProvider("https://open.spotify.com/show/5CfCWKI5pZ28U0uOzXkDHe")!]) {
      expect(parseProviderRefString(providerRefString(ref))).toEqual(ref);
    }
    expect(parseProviderRefString("apple:us:x:notdigits")).toBeNull();
    expect(parsePodcastProvider("https://podcasts.apple.com.evil.example/us/podcast/x/id1234567890")).toBeNull();
  });
});

describe("Audible", () => {
  it("keeps only https links on Audible's own domains, without tracking", () => {
    expect(normalizeAudibleUrl("https://www.audible.com/pd/Some-Title-Audiobook/B0123ABCDE?ref=a&qid=1")).toBe(
      "https://www.audible.com/pd/Some-Title-Audiobook/B0123ABCDE",
    );
    expect(normalizeAudibleUrl("https://audible.co.uk/pd/B0123ABCDE")).toBe("https://audible.co.uk/pd/B0123ABCDE");
    expect(normalizeAudibleUrl("http://www.audible.com/pd/B0123ABCDE")).toBeNull();
    expect(normalizeAudibleUrl("https://www.audible.com.evil.example/pd/x")).toBeNull();
    expect(normalizeAudibleUrl("https://www.amazon.com/dp/B0123ABCDE")).toBeNull();
    expect(normalizeAudibleUrl("https://www.audible.com/")).toBeNull();
  });
});

describe("Kindle links", () => {
  it("keeps Amazon product pages without tracking", () => {
    expect(normalizeKindleUrl("https://www.amazon.com/Some-Book-ebook/dp/B0123ABCDE/ref=sr_1_1?crid=x&keywords=y")).toBe(
      "https://www.amazon.com/Some-Book-ebook/dp/B0123ABCDE",
    );
    expect(normalizeKindleUrl("https://amazon.co.uk/dp/B0123ABCDE")).toBe("https://amazon.co.uk/dp/B0123ABCDE");
  });
  it("keeps only the ASIN on Kindle Cloud Reader links", () => {
    expect(normalizeKindleUrl("https://read.amazon.com/?asin=b0123abcde&ref_=x")).toBe("https://read.amazon.com/?asin=B0123ABCDE");
    expect(normalizeKindleUrl("https://read.amazon.com/?asin=<script>")).toBeNull();
  });
  it("refuses other hosts, http, and lookalikes", () => {
    for (const bad of ["http://www.amazon.com/dp/B0123ABCDE", "https://www.amazon.com.evil.example/dp/x", "https://evil.example/www.amazon.com/", "javascript:alert(1)", "https://www.amazon.com/", "https://user:pw@www.amazon.com/dp/x"]) {
      expect(normalizeKindleUrl(bad)).toBeNull();
    }
  });
  it("accepts Amazon's country stores and product-page forms", () => {
    expect(normalizeKindleUrl("https://www.amazon.de/-/en/dp/B0123ABCDE?th=1")).toBe("https://www.amazon.de/-/en/dp/B0123ABCDE");
    expect(normalizeKindleUrl("https://www.amazon.se/dp/B0123ABCDE/")).toBe("https://www.amazon.se/dp/B0123ABCDE");
    expect(normalizeKindleUrl("https://www.amazon.com.be/gp/product/B0123ABCDE/ref=x")).toBe("https://www.amazon.com.be/gp/product/B0123ABCDE");
    expect(normalizeKindleUrl("https://WWW.AMAZON.SG/gp/aw/d/B0123ABCDE")).toBe("https://www.amazon.sg/gp/aw/d/B0123ABCDE");
    for (const t of ["ca", "com.mx", "com.br", "ie", "fr", "it", "es", "nl", "pl", "com.tr", "ae", "sa", "eg", "in", "co.jp", "com.au"]) {
      expect(normalizeKindleUrl(`https://www.amazon.${t}/dp/B0123ABCDE`)).toBe(`https://www.amazon.${t}/dp/B0123ABCDE`);
    }
  });
  it("accepts a.co short links, without tracking", () => {
    expect(normalizeKindleUrl("https://a.co/d/0aBcDeF?ref=share")).toBe("https://a.co/d/0aBcDeF");
    expect(normalizeKindleUrl("https://a.co/7JcW4Yj")).toBe("https://a.co/7JcW4Yj");
    expect(normalizeKindleUrl("https://a.co/d/0aBcDeF/")).toBe("https://a.co/d/0aBcDeF");
  });
  it("refuses non-book Amazon pages, lookalike domains, and unsafe schemes", () => {
    for (const bad of [
      "https://www.amazon.com/gp/cart/view.html",
      "https://www.amazon.com/s?k=book",
      "https://www.amazon.com/ap/signin",
      "https://www.amazon.com/dp/short",
      "https://a.co/",
      "https://a.co/d/",
      "https://a.co/d/abc/../../x",
      "http://a.co/d/0aBcDeF",
      "https://a.co.evil.example/d/0aBcDeF",
      "https://www.a.co/d/0aBcDeF",
      "https://evila.co/d/0aBcDeF",
      "https://a.co@evil.example/d/0aBcDeF",
      "https://amazon.com@evil.example/dp/B0123ABCDE",
      "https://amazon-books.com/dp/B0123ABCDE",
      "https://www.amaz0n.com/dp/B0123ABCDE",
      "https://www.xn--amazon-9ya.com/dp/B0123ABCDE",
      "https://www.amazon.cn/dp/B0123ABCDE",
      "https://www.amazon.com:8443/dp/B0123ABCDE",
      "data:text/html,<script>alert(1)</script>",
      "JAVASCRIPT:alert(1)",
      "ftp://www.amazon.com/dp/B0123ABCDE",
      "//www.amazon.com/dp/B0123ABCDE",
      "www.amazon.com/dp/B0123ABCDE",
      "kindle://book?asin=B0123ABCDE",
    ]) {
      expect(normalizeKindleUrl(bad), bad).toBeNull();
    }
  });
});
