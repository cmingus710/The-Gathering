"use client";

import { ProviderButton } from "@/components/auth/provider-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PROVIDER_LABEL, type OAuthProvider } from "@/lib/auth/oauth";
import { linkProviderAction, unlinkProviderAction } from "./actions";

export function ConnectProvider({ provider }: { provider: OAuthProvider }) {
  return (
    <form action={linkProviderAction} className="max-w-sm">
      <ProviderButton provider={provider} label={`Continue with ${PROVIDER_LABEL[provider]}`} />
    </form>
  );
}

export function DisconnectProvider({ provider }: { provider: OAuthProvider }) {
  const name = PROVIDER_LABEL[provider];
  return (
    <ConfirmDialog
      trigger={`Disconnect ${name}`}
      title={`Disconnect ${name}?`}
      confirmLabel={`Disconnect ${name}`}
      formAction={unlinkProviderAction}
      hidden={{ provider }}
    >
      You won&apos;t be able to sign in with {name} any more. Your account, membership, and everything in it stay exactly as
      they are, and you can connect {name} again later.
    </ConfirmDialog>
  );
}
