"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { OAuthProvider } from "@/lib/auth/oauth";
import { AppleLogo, GoogleLogo } from "./provider-logos";

/**
 * "Continue with Google / Apple" submit button, styled to each provider's
 * rules (colours in globals.css, .provider-btn): Google's light or dark theme
 * with the colour G, and Apple's black (or, on dark, white) style with the
 * title at ~43% of the button height. Both are the same size, so Apple is
 * never less prominent. Only the corner radius follows The Gathering.
 */
const styles: Record<OAuthProvider, string> = {
  google:
    "border border-(--google-border) bg-(--google-bg) text-(--google-text) hover:bg-(--google-bg-hover) font-medium text-[1rem] [font-family:Roboto,'Google_Sans',Arial,sans-serif]",
  apple:
    "border border-(--apple-border) bg-(--apple-bg) text-(--apple-text) hover:bg-(--apple-bg-hover) font-medium text-[1.25rem] [font-family:-apple-system,BlinkMacSystemFont,'Helvetica_Neue',Arial,sans-serif]",
};

export function ProviderButton({
  provider,
  label,
  name = "provider",
  className,
}: {
  provider: OAuthProvider;
  /** "Continue with Google" etc. Apple allows only Sign in / Sign up / Continue with Apple. */
  label: string;
  name?: string;
  className?: string;
}) {
  const { pending, data } = useFormStatus();
  const isThis = pending && data?.get(name) === provider;
  return (
    <button
      type="submit"
      name={name}
      value={provider}
      disabled={pending}
      aria-busy={isThis || undefined}
      className={cn(
        "provider-btn relative flex h-12 w-full min-w-[140px] items-center justify-center gap-3 rounded-button px-12 leading-none",
        "transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary",
        "disabled:cursor-not-allowed disabled:opacity-70",
        styles[provider],
        className,
      )}
    >
      <span className="absolute inset-y-0 left-4 flex items-center">
        {isThis ? (
          <Spinner className="size-5" />
        ) : provider === "google" ? (
          <GoogleLogo className="size-5" />
        ) : (
          <AppleLogo className="h-5 w-auto -translate-y-px" />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}
