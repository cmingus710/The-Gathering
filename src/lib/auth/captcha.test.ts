import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPTCHA_REJECTED_MESSAGE,
  CAPTCHA_SERVICE_MESSAGE,
  captchaTokenFrom,
  isCaptchaError,
  turnstileSiteKey,
  widgetErrorMessage,
} from "./captcha";
import { authErrorMessage } from "./errors";

function form(token?: string) {
  const fd = new FormData();
  if (token !== undefined) fd.set("captchaToken", token);
  return fd;
}

describe("captcha helpers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads the public site key, treating blank as unset", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "0x4AAAAAAA-test");
    expect(turnstileSiteKey()).toBe("0x4AAAAAAA-test");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  ");
    expect(turnstileSiteKey()).toBeNull();
  });

  it("extracts a token, ignoring blank or oversized values", () => {
    expect(captchaTokenFrom(form(" abc "))).toBe("abc");
    expect(captchaTokenFrom(form(""))).toBeUndefined();
    expect(captchaTokenFrom(form())).toBeUndefined();
    expect(captchaTokenFrom(form("x".repeat(2049)))).toBeUndefined();
  });

  it("recognises Supabase captcha rejections", () => {
    expect(isCaptchaError({ code: "captcha_failed", status: 400 })).toBe(true);
    expect(isCaptchaError({ code: "unexpected_failure", status: 500, message: "captcha verification process failed" })).toBe(true);
    expect(isCaptchaError({ code: "invalid_credentials", status: 400 })).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
  });

  it("maps captcha rejections before the generic service error", () => {
    expect(authErrorMessage({ code: "captcha_failed", status: 400, message: "captcha protection: request disallowed (timeout-or-duplicate)" })).toBe(
      CAPTCHA_REJECTED_MESSAGE,
    );
    expect(authErrorMessage({ status: 500, message: "captcha verification process failed" })).toBe(CAPTCHA_SERVICE_MESSAGE);
    expect(authErrorMessage({ code: "invalid_credentials", status: 400 })).toMatch(/don't match/);
  });

  it("explains widget errors by family", () => {
    expect(widgetErrorMessage("110200")).toMatch(/isn't set up for this web address/);
    expect(widgetErrorMessage("110100")).toMatch(/isn't set up/);
    expect(widgetErrorMessage("200500")).toMatch(/couldn't load/);
    expect(widgetErrorMessage("110600")).toMatch(/timed out/);
    expect(widgetErrorMessage("300030")).toMatch(/couldn't confirm this browser/);
    expect(widgetErrorMessage(undefined)).toMatch(/didn't complete/);
  });
});
