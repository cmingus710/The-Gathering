import { describe, expect, it } from "vitest";
import { isPushServiceEndpoint, TEST_PUSH_URL, testPushPayload } from "./push";

describe("push service endpoints", () => {
  it("accepts the browser vendors' push services", () => {
    expect(isPushServiceEndpoint("https://web.push.apple.com/QGx1Zm9v")).toBe(true);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com/fcm/send/abc:def")).toBe(true);
    expect(isPushServiceEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushServiceEndpoint("https://wns2-bl2p.notify.windows.com/w/?token=abc")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isPushServiceEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isPushServiceEndpoint("https://web.push.apple.com.evil.example/x")).toBe(false);
    expect(isPushServiceEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushServiceEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isPushServiceEndpoint("https://user@fcm.googleapis.com/x")).toBe(false);
    expect(isPushServiceEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isPushServiceEndpoint("not a url")).toBe(false);
  });
});

describe("test push payload", () => {
  it("is generic and opens the settings page", () => {
    const p = JSON.parse(testPushPayload("The Gathering"));
    expect(p).toEqual({ title: "The Gathering", body: "Test notification: push works on this device.", url: TEST_PUSH_URL, tag: "push-test" });
  });
});
