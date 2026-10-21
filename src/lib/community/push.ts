/**
 * Web push helpers shared by the settings page and the test-send action.
 * Kept free of server-only imports so they can be unit tested.
 */

/** Where a tapped test notification opens (signed-in page; the service worker allows only this and /notifications/open/<id>). */
export const TEST_PUSH_URL = "/notifications/settings";

/**
 * Push services run by the browser vendors. A test send goes only to these
 * hosts, so the action can't be used to make the server POST elsewhere.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^web\.push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

export function isPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && !url.username && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

/** The test message: generic text, a fixed tag (repeat tests replace each other), and the settings page. */
export function testPushPayload(churchName: string): string {
  return JSON.stringify({ title: churchName, body: "Test notification: push works on this device.", url: TEST_PUSH_URL, tag: "push-test" });
}
