import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The auth Server Actions with a mocked Supabase client: the Turnstile token
 * reaches the right Supabase Auth call, captcha rejections get clear messages
 * (also in the flows that otherwise hide errors), and entered values survive
 * without echoing passwords or tokens. Supabase itself verifies the token.
 */
const auth = {
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithOAuth: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth }) }));
vi.mock("@/lib/membership/server", () => ({ settleOwnApprovalAlert: vi.fn() }));
vi.mock("@/lib/auth/oauth-config", () => ({ getOfferedProviders: async () => ["google", "apple"] }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://www.gathering.church" }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));

const TOKEN = "0.turnstile-token";
const CAPTCHA_MISSING = { code: "captcha_failed", status: 400, message: "captcha protection: request disallowed (no captcha_token found)" };
const CAPTCHA_SERVICE = { code: "unexpected_failure", status: 500, message: "captcha verification process failed" };
const idle = { status: "idle" as const };

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { url: string }).url;
  }
  throw new Error("expected a redirect");
}

const signUpFields = {
  fullName: "Ruth Example",
  email: "ruth@example.test",
  password: "Password123x",
  confirmPassword: "Password123x",
};

describe("auth actions and Turnstile", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.gathering.church");
    for (const fn of Object.values(auth)) fn.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("sign-up passes the token to Supabase and keeps confirmation and pending approval", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: { id: "u1" } }, error: null });
    const { signUpAction } = await import("@/app/(auth)/actions");
    const url = await redirectOf(signUpAction(idle, form({ ...signUpFields, captchaToken: TOKEN })));
    expect(url).toBe("/check-email?reason=verify");
    const arg = auth.signUp.mock.calls[0][0];
    expect(arg.options.captchaToken).toBe(TOKEN);
    expect(arg.options.emailRedirectTo).toBe("https://www.gathering.church/auth/confirm?next=%2Faccount-status");
    expect(arg.options.data.full_name).toBe("Ruth Example");
  });

  it("sign-up without a token still calls Supabase (it decides) and explains a rejection, keeping name and email", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: CAPTCHA_MISSING });
    const { signUpAction } = await import("@/app/(auth)/actions");
    const state = await signUpAction(idle, form(signUpFields));
    expect(auth.signUp.mock.calls[0][0].options.captchaToken).toBeUndefined();
    expect(state.status).toBe("error");
    expect(state.message).toMatch(/security check/i);
    expect(state.values).toEqual({ fullName: "Ruth Example", email: "ruth@example.test" });
  });

  it("never echoes the token back into the form", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: CAPTCHA_MISSING });
    const { signUpAction } = await import("@/app/(auth)/actions");
    const state = await signUpAction(idle, form({ ...signUpFields, captchaToken: TOKEN }));
    expect(JSON.stringify(state)).not.toContain(TOKEN);
  });

  it("ignores an implausibly long token rather than forwarding it", async () => {
    auth.signUp.mockResolvedValue({ data: { session: null, user: null }, error: CAPTCHA_MISSING });
    const { signUpAction } = await import("@/app/(auth)/actions");
    await signUpAction(idle, form({ ...signUpFields, captchaToken: "x".repeat(3000) }));
    expect(auth.signUp.mock.calls[0][0].options.captchaToken).toBeUndefined();
  });

  it("sign-in passes the token and keeps the email and next path after an error", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: CAPTCHA_SERVICE });
    const { signInAction } = await import("@/app/(auth)/actions");
    const state = await signInAction(idle, form({ email: "ruth@example.test", password: "Password123x", next: "/prayer", captchaToken: TOKEN }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "ruth@example.test",
      password: "Password123x",
      options: { captchaToken: TOKEN },
    });
    expect(state.message).toMatch(/security check service/i);
    expect(state.values).toMatchObject({ email: "ruth@example.test", next: "/prayer" });
    expect(state.values).not.toHaveProperty("password");
    expect(state.values).not.toHaveProperty("captchaToken");
  });

  it("sign-in success still redirects to the requested page", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    const { signInAction } = await import("@/app/(auth)/actions");
    const url = await redirectOf(signInAction(idle, form({ email: "ruth@example.test", password: "Password123x", next: "/prayer", captchaToken: TOKEN })));
    expect(url).toBe("/prayer");
  });

  it("an unverified email is still flagged so the resend form appears", async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { code: "email_not_confirmed", status: 400, message: "Email not confirmed" } });
    const { signInAction } = await import("@/app/(auth)/actions");
    const state = await signInAction(idle, form({ email: "ruth@example.test", password: "Password123x", captchaToken: TOKEN }));
    expect(state.values?.unverified).toBe("1");
  });

  it("resend passes the token and surfaces a captcha rejection instead of a false success", async () => {
    const { resendVerificationAction } = await import("@/app/(auth)/actions");
    auth.resend.mockResolvedValue({ error: CAPTCHA_MISSING });
    const rejected = await resendVerificationAction(idle, form({ email: "ruth@example.test" }));
    expect(rejected.status).toBe("error");
    expect(rejected.message).toMatch(/security check/i);

    auth.resend.mockResolvedValue({ error: null });
    const ok = await resendVerificationAction(idle, form({ email: "ruth@example.test", captchaToken: TOKEN }));
    expect(ok.status).toBe("success");
    expect(auth.resend.mock.calls[1][0]).toMatchObject({ type: "signup", email: "ruth@example.test", options: { captchaToken: TOKEN } });
  });

  it("resend still hides other account errors", async () => {
    auth.resend.mockResolvedValue({ error: { code: "user_not_found", status: 400, message: "User not found" } });
    const { resendVerificationAction } = await import("@/app/(auth)/actions");
    const state = await resendVerificationAction(idle, form({ email: "nobody@example.test", captchaToken: TOKEN }));
    expect(state.status).toBe("success");
  });

  it("forgot password passes the token, surfaces a captcha rejection, and keeps the email", async () => {
    const { forgotPasswordAction } = await import("@/app/(auth)/actions");
    auth.resetPasswordForEmail.mockResolvedValue({ error: CAPTCHA_MISSING });
    const state = await forgotPasswordAction(idle, form({ email: "ruth@example.test", captchaToken: TOKEN }));
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("ruth@example.test", {
      redirectTo: "https://www.gathering.church/auth/confirm?next=%2Freset-password",
      captchaToken: TOKEN,
    });
    expect(state.message).toMatch(/security check/i);
    expect(state.values).toEqual({ email: "ruth@example.test" });

    auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    expect(await redirectOf(forgotPasswordAction(idle, form({ email: "ruth@example.test", captchaToken: TOKEN })))).toBe("/check-email?reason=reset");
  });

  it("Google/Apple sign-in sends no captcha token (Supabase doesn't check it on /authorize)", async () => {
    auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://example.supabase.co/auth/v1/authorize?provider=google" }, error: null });
    const { startOAuthAction } = await import("@/app/(auth)/actions");
    await redirectOf(startOAuthAction(idle, form({ provider: "google", next: "/home", captchaToken: TOKEN })));
    const arg = auth.signInWithOAuth.mock.calls[0][0];
    expect(arg.provider).toBe("google");
    expect(arg.options).not.toHaveProperty("captchaToken");
  });
});
