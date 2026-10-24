"use client";

import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CAPTCHA_FIELD, turnstileSiteKey, widgetErrorMessage } from "@/lib/auth/captcha";

/**
 * Cloudflare Turnstile for the auth forms. The token goes to the Server Action
 * in a hidden field and on to Supabase Auth, which verifies it; nothing here
 * decides whether someone may sign in. Without NEXT_PUBLIC_TURNSTILE_SITE_KEY
 * nothing renders and forms submit exactly as before.
 */

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  theme?: "light" | "dark" | "auto";
  size?: "normal" | "flexible" | "compact";
  appearance?: "always" | "execute" | "interaction-only";
  "response-field"?: boolean;
  "refresh-expired"?: "auto" | "manual" | "never";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: (code: string) => boolean | void;
  "timeout-callback"?: () => void;
  "before-interactive-callback"?: () => void;
  "after-interactive-callback"?: () => void;
};

type TurnstileApi = {
  render: (el: HTMLElement, options: TurnstileOptions) => string | undefined;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 15_000;
/** How long a non-interactive check may run before the form stops waiting for it. */
const PENDING_LIMIT_MS = 20_000;

let scriptPromise: Promise<TurnstileApi> | null = null;

/** Loads Cloudflare's script once per page; a failed load can be retried. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    const fail = () => {
      window.clearTimeout(timer);
      script.remove();
      scriptPromise = null;
      reject(new Error("turnstile script unavailable"));
    };
    const timer = window.setTimeout(fail, SCRIPT_TIMEOUT_MS);
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

type Status =
  | "off" // no site key configured
  | "loading" // script loading or a non-interactive check running
  | "interactive" // Cloudflare wants the visitor to click the checkbox
  | "verified"
  | "slow" // pending longer than usual; the form no longer waits
  | "error"
  | "unavailable"; // script couldn't load

export type Captcha = {
  status: Status;
  token: string;
  /** True while the form should wait for a token before it can be submitted. */
  blocking: boolean;
  message: string | null;
  /** Called by CaptchaField with the element Cloudflare draws into. */
  attach: (el: HTMLDivElement | null) => void;
  retry: () => void;
};

/**
 * One widget per form. `resetOn` is the form's action state: every response
 * means the token was spent (Supabase accepts each one once), so the widget
 * fetches a new one.
 */
export function useCaptcha(action: string, resetOn: unknown): Captcha {
  const siteKey = turnstileSiteKey();
  const [status, setStatus] = useState<Status>(siteKey ? "loading" : "off");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const widgetId = useRef<string | undefined>(undefined);

  // Render (or re-render after "Try again") the widget once its container exists.
  useEffect(() => {
    if (!siteKey || !el) return;
    let cancelled = false;
    loadTurnstile().then(
      (api) => {
        if (cancelled) return;
        const dark = document.documentElement.getAttribute("data-theme") === "dark";
        widgetId.current = api.render(el, {
          sitekey: siteKey,
          action,
          theme: dark ? "dark" : "light",
          size: "flexible",
          "response-field": false,
          "refresh-expired": "auto",
          callback: (t) => {
            setToken(t);
            setStatus("verified");
            setMessage(null);
          },
          "expired-callback": () => {
            setToken("");
            setStatus("loading");
            setMessage("The security check expired and is refreshing.");
          },
          "before-interactive-callback": () => {
            setStatus("interactive");
            setMessage("Please complete the security check.");
          },
          "timeout-callback": () => {
            setToken("");
            setStatus("error");
            setMessage("The security check timed out. Please try again.");
          },
          "error-callback": (code) => {
            setToken("");
            setStatus("error");
            setMessage(widgetErrorMessage(code));
            // Handled here; Cloudflare still retries transient failures itself.
            return true;
          },
        });
      },
      () => {
        if (cancelled) return;
        setStatus("unavailable");
        setMessage("The security check couldn't load. Check your connection or any content blocker, then try again.");
      },
    );
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, [siteKey, el, action, attempt]);

  // A server response spent the token: clear it now, then fetch a fresh one.
  const [seen, setSeen] = useState(resetOn);
  if (seen !== resetOn) {
    setSeen(resetOn);
    if (status !== "off" && status !== "unavailable") {
      setToken("");
      setStatus("loading");
      setMessage(null);
    }
  }
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
  }, [resetOn]);

  // Don't hold the form hostage to a check that never finishes; Supabase still decides.
  useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      setStatus("slow");
      setMessage("The security check is taking longer than usual. You can try again, or submit and we'll let you know if it's needed.");
    }, PENDING_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  const retry = useCallback(() => {
    setToken("");
    setStatus("loading");
    setMessage(null);
    if (widgetId.current && window.turnstile && status !== "unavailable") window.turnstile.reset(widgetId.current);
    else setAttempt((n) => n + 1);
  }, [status]);

  return {
    status,
    token,
    blocking: status === "loading" || status === "interactive",
    message,
    attach: setEl,
    retry,
  };
}

/** The widget, its status line, and the hidden token field. Renders nothing when off. */
export function CaptchaField({ captcha }: { captcha: Captcha }) {
  const ref = useRef<HTMLDivElement>(null);
  const { attach } = captcha;
  const off = captcha.status === "off";
  useEffect(() => {
    if (off) return;
    attach(ref.current);
    return () => attach(null);
  }, [attach, off]);
  if (off) return null;
  const canRetry = captcha.status === "error" || captcha.status === "unavailable" || captcha.status === "slow";
  return (
    <div className="space-y-2" data-testid="captcha">
      <input type="hidden" name={CAPTCHA_FIELD} value={captcha.token} />
      {/* Cloudflare draws its own accessible, keyboard-operable widget in here. */}
      <div ref={ref} className={captcha.status === "unavailable" ? undefined : "min-h-[65px]"} />
      <div aria-live="polite" className="space-y-2">
        {captcha.status === "loading" && !captcha.message ? (
          <p className="text-meta text-text-secondary">Running a quick security check…</p>
        ) : null}
        {captcha.message ? (
          <p className={captcha.status === "error" || captcha.status === "unavailable" ? "text-meta text-danger" : "text-meta text-text-secondary"}>
            {captcha.message}
          </p>
        ) : null}
        {canRetry ? (
          <Button type="button" variant="secondary" size="sm" icon={<RotateCw className="size-4" aria-hidden="true" />} onClick={captcha.retry}>
            Try the security check again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
