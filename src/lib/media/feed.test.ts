import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { FeedParseError, htmlToText, parseDuration, parseFeed } from "./feed";
import { buildPodcastFeed, type PublicFeedData } from "./podcast-feed";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>Synthetic Show &amp; Friends</title>
  <link>https://example.test/show</link>
  <description><![CDATA[<p>About the <b>show</b></p><script>alert(1)</script>]]></description>
  <itunes:author>Example Publisher</itunes:author>
  <itunes:image href="https://cdn.example.test/art.jpg"/>
  <item>
    <title>Episode one</title>
    <guid isPermaLink="false">ep-1</guid>
    <pubDate>Tue, 01 Oct 2026 12:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <a href="javascript:alert(1)" onclick="x()">world</a></p><img src=x onerror=alert(1)> &lt;script&gt;bad()&lt;/script&gt;]]></description>
    <enclosure url="https://cdn.example.test/1.mp3" length="12345" type="audio/mpeg"/>
    <itunes:duration>1:02:03</itunes:duration>
  </item>
  <item>
    <title>No guid, insecure audio</title>
    <pubDate>Wed, 02 Oct 2026 12:00:00 GMT</pubDate>
    <enclosure url="http://cdn.example.test/2.mp3" length="5" type="audio/mpeg"/>
    <link>javascript:alert(1)</link>
  </item>
  <item>
    <title>Video enclosure</title>
    <guid>ep-3</guid>
    <enclosure url="https://cdn.example.test/3.mp4" type="video/mp4"/>
  </item>
  <item><description>No title: skipped</description></item>
</channel>
</rss>`;

describe("feed parsing", () => {
  it("reads RSS metadata and episodes as plain text with safe URLs only", () => {
    const feed = parseFeed(Buffer.from(RSS));
    expect(feed.title).toBe("Synthetic Show & Friends");
    expect(feed.description).toBe("About the show");
    expect(feed.author).toBe("Example Publisher");
    expect(feed.artwork_url).toBe("https://cdn.example.test/art.jpg");
    expect(feed.episodes).toHaveLength(3);
    expect(feed.skipped).toBe(1);
    const [one, two, three] = feed.episodes;
    expect(one).toMatchObject({ guid: "ep-1", title: "Episode one", audio_url: "https://cdn.example.test/1.mp3", audio_length: 12345, duration_seconds: 3723 });
    // Escaped markup is decoded and then stripped too; only its text remains.
    expect(one.description).toBe("Hello world\nbad()");
    expect(one.description).not.toMatch(/<|javascript|onerror|onclick/);
    // No guid: a stable identity from title + date; insecure audio dropped; javascript: link dropped.
    expect(two.guid).toMatch(/^title-date:[0-9a-f]{64}$/);
    expect(two.audio_url).toBeNull();
    expect(two.link).toBeNull();
    // Video enclosures are not podcast audio.
    expect(three.audio_url).toBeNull();
  });

  it("keeps the same identity when the publisher moves its files", () => {
    const a = parseFeed(RSS).episodes[1].guid;
    const b = parseFeed(RSS.replace("http://cdn.example.test/2.mp3", "https://new-cdn.example.test/2.mp3")).episodes[1].guid;
    expect(a).toBe(b);
  });

  it("refuses DOCTYPE and entity declarations (XXE, billion laughs)", () => {
    const xxe = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><title>&x;</title></channel></rss>`;
    expect(() => parseFeed(xxe)).toThrow(FeedParseError);
    const lol = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><rss><channel><title>&lol2;</title></channel></rss>`;
    expect(() => parseFeed(lol)).toThrow(/DOCTYPE or entity/);
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow(/RSS or Atom/);
    expect(() => parseFeed("<rss><channel><title>broken")).toThrow();
  });

  it("reads Atom feeds", () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Show</title>
      <link rel="alternate" href="https://example.test/"/><entry><id>urn:uuid:1</id><title>Atom episode</title>
      <published>2026-09-01T10:00:00Z</published><summary>Hi &lt;b&gt;there&lt;/b&gt;</summary>
      <link rel="enclosure" href="https://cdn.example.test/a.m4a" type="audio/mp4" length="99"/></entry></feed>`;
    const feed = parseFeed(atom);
    expect(feed.title).toBe("Atom Show");
    expect(feed.episodes[0]).toMatchObject({ guid: "urn:uuid:1", audio_url: "https://cdn.example.test/a.m4a", audio_type: "audio/mp4", description: "Hi there" });
  });

  it("caps episodes and decodes declared legacy encodings", () => {
    const items = Array.from({ length: 700 }, (_, i) => `<item><title>E${i}</title><guid>g${i}</guid></item>`).join("");
    expect(parseFeed(`<rss><channel><title>Many</title>${items}</channel></rss>`).episodes).toHaveLength(500);
    const latin = Buffer.concat([
      Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Caf'),
      Buffer.from([0xe9]),
      Buffer.from("</title></channel></rss>"),
    ]);
    expect(parseFeed(latin).title).toBe("Café");
  });

  it("parses durations and strips markup", () => {
    expect(parseDuration("3723")).toBe(3723);
    expect(parseDuration("62:03")).toBe(3723);
    expect(parseDuration("1:02:03")).toBe(3723);
    expect(parseDuration("forever")).toBeNull();
    expect(htmlToText("&lt;img src=x onerror=alert(1)&gt;Hi &amp; bye")).toBe("Hi & bye");
  });
});

describe("public podcast feed", () => {
  const data: PublicFeedData = {
    show: {
      id: "11111111-1111-4111-8111-111111111111",
      title: "The Gathering <Podcast> & “Talks”",
      description: "Teaching & conversation",
      author: "The Gathering",
      website_url: null,
      language: "en-us",
      category: "Religion & Spirituality > Christianity",
      explicit: false,
      owner_email: "podcast@example.test",
      updated_at: "2026-10-01T00:00:00Z",
      artwork: { asset_id: "22222222-2222-4222-8222-222222222222", mime: "image/webp", width: 2000, height: 2000 },
    },
    episodes: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Episode <1> & more",
        summary: "Short",
        body: "**Bold** [link](https://example.test) <script>x</script>",
        publish_at: "2026-10-05T14:00:00Z",
        episode_number: 1,
        season_number: null,
        audio: { asset_id: "44444444-4444-4444-8444-444444444444", mime: "audio/mpeg", size_bytes: 1234567, duration_seconds: 1830 },
      },
    ],
  };

  it("produces valid RSS with stable identifiers, enclosures, and escaped text", () => {
    const xml = buildPodcastFeed(data, "https://app.example.test/");
    expect(XMLValidator.validate(xml)).toBe(true);
    const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
    const ch = doc.rss.channel;
    expect(ch.title).toBe("The Gathering <Podcast> & “Talks”");
    expect(ch["atom:link"]["@_href"]).toBe("https://app.example.test/podcast/feed.xml");
    expect(ch["itunes:category"]["@_text"]).toBe("Religion & Spirituality");
    expect(ch["itunes:category"]["itunes:category"]["@_text"]).toBe("Christianity");
    const item = ch.item;
    expect(item.guid["#text"]).toBe("gathering-episode-33333333-3333-4333-8333-333333333333");
    expect(item.guid["@_isPermaLink"]).toBe("false");
    expect(item.enclosure).toMatchObject({
      "@_url": "https://app.example.test/api/podcast/episodes/33333333-3333-4333-8333-333333333333/audio",
      "@_length": "1234567",
      "@_type": "audio/mpeg",
    });
    expect(item["itunes:duration"]).toBe("30:30");
    expect(item.pubDate).toBe("Mon, 05 Oct 2026 14:00:00 GMT");
    expect(xml).not.toContain("<script>");
    expect(xml).not.toMatch(/token=|\/storage\/v1\//);
  });
});
