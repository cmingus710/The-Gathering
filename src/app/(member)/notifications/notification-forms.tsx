"use client";

import { Check, CheckCheck } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { useCommunityRealtime } from "@/components/community/realtime-provider";
import { Button } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { MySettings, NotificationCategory } from "@/lib/community/types";
import { initialFormState } from "@/lib/forms";
import { markReadAction, pushSubscribeAction, pushUnsubscribeAction, saveQuietHoursAction, savePrefsAction } from "./actions";

export function MarkReadButton({ id, label }: { id?: string; label: string }) {
  const [state, action] = useActionState(markReadAction, initialFormState);
  const { refresh } = useCommunityRealtime();
  useEffect(() => {
    if (state.status === "success") refresh();
  }, [state, refresh]);
  return (
    <form action={action}>
      {id ? <input type="hidden" name="id" value={id} /> : null}
      <SubmitButton size="sm" variant={id ? "ghost" : "secondary"} icon={id ? <Check className="size-4" aria-hidden="true" /> : <CheckCheck className="size-4" aria-hidden="true" />}>
        {label}
      </SubmitButton>
      <span role="status" className="sr-only">
        {state.status === "success" ? state.message : ""}
      </span>
    </form>
  );
}

const CATEGORY_INFO: Record<NotificationCategory, { label: string; hint: string }> = {
  forum: { label: "Discussions", hint: "Replies to your discussions and ones you follow." },
  groups: { label: "Groups", hint: "Invitations, join requests, and decisions." },
  messages: { label: "Direct messages", hint: "Email and push only say “You have a new message”, never the text or sender." },
  moderation: { label: "Moderator actions", hint: "Always shown in the app when a moderator acts on your posts or account." },
  events: { label: "Event updates", hint: "Changes and cancellations for events you're registered for. Event emails are set on the Events page." },
  prayer: { label: "Prayer", hint: "Comments and updates on requests you wrote or follow. Email and push never include the request or names." },
  care: { label: "Care", hint: "Responses to your care requests, volunteer confirmations, and (for coordinators) assignments and follow-ups. Email and push are generic." },
  teaching: { label: "Teaching and media", hint: "New devotionals, Sunday lessons, podcast episodes, reading assignments, and playlists you can see. Email and push only name the section." },
  gallery: { label: "Photo galleries", hint: "New photos in albums you can see (grouped, a few times a day) and decisions about photos you shared." },
  reading: { label: "Bible reading", hint: "Daily reminders you switch on for a reading plan, and changes to upcoming readings. Email and push only say your reading is ready, never the plan, passage, or your journal." },
};

export function PrefsForm({ prefs, pushAvailable }: { prefs: MySettings["prefs"]; pushAvailable: boolean }) {
  const [state, action] = useActionState(savePrefsAction, initialFormState);
  return (
    <form action={action} className="space-y-6">
      <FormMessage state={state} />
      {/* Only categories the database reports (each phase's categories appear once its migrations are applied). */}
      <input type="hidden" name="categories" value={(Object.keys(CATEGORY_INFO) as NotificationCategory[]).filter((c) => prefs[c]).join(",")} />
      {(Object.keys(CATEGORY_INFO) as NotificationCategory[]).filter((c) => prefs[c]).map((c) => (
        <fieldset key={c} className="space-y-3 border-b border-border pb-5 last:border-0">
          <legend className="font-bold">{CATEGORY_INFO[c].label}</legend>
          <p className="text-meta text-text-secondary">{CATEGORY_INFO[c].hint}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <CheckboxField name={`${c}.in_app`} label="In the app" defaultChecked={prefs[c]!.in_app} disabled={c === "moderation"} />
            {c === "events" ? null : (
              <SelectField label="Email" name={`${c}.email`} defaultValue={prefs[c]!.email}>
                <option value="off">Off</option>
                <option value="immediate">Right away</option>
                {c === "messages" || c === "care" || c === "reading" ? null : (
                  <>
                    <option value="daily">Daily summary</option>
                    <option value="weekly">Weekly summary</option>
                  </>
                )}
              </SelectField>
            )}
            {pushAvailable ? <CheckboxField name={`${c}.push`} label="Push on my devices" defaultChecked={prefs[c]!.push} /> : null}
          </div>
        </fieldset>
      ))}
      <SubmitButton pendingText="Saving…">Save preferences</SubmitButton>
    </form>
  );
}

export function QuietHoursForm({ settings, timezones }: { settings: MySettings; timezones: string[] }) {
  const [state, action] = useActionState(saveQuietHoursAction, initialFormState);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField name="enabled" label="Pause email and push during quiet hours" defaultChecked={settings.quiet_enabled} hint="Notifications still appear in the app. Anything held is sent when quiet hours end." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="From" name="start" type="time" required defaultValue={settings.quiet_start} />
        <TextField label="Until" name="end" type="time" required defaultValue={settings.quiet_end} />
      </div>
      <SelectField label="Time zone" name="timezone" defaultValue={settings.timezone ?? ""} hint={`Currently using ${settings.effective_timezone}.`}>
        <option value="">Church time zone</option>
        {timezones.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, " ")}
          </option>
        ))}
      </SelectField>
      <SubmitButton size="sm" pendingText="Saving…">
        Save quiet hours
      </SubmitButton>
    </form>
  );
}

function urlBase64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "This device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "browser";
  return `${os} · ${browser}`;
}

/**
 * Web push opt-in. Asks for permission only when the member presses the
 * button (never on page load). Delivery is best effort: in-app and email
 * remain the reliable channels.
 */
export function PushDevices({ publicKey, devices }: { publicKey: string | null; devices: MySettings["push_devices"] }) {
  const [support, setSupport] = useState<"checking" | "unsupported" | "needs-install" | "denied" | "ready">("checking");
  const [subscribed, setSubscribed] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setSupport(ios && !standalone ? "needs-install" : "unsupported");
        return;
      }
      if (ios && !standalone) {
        setSupport("needs-install");
        return;
      }
      if (Notification.permission === "denied") {
        setSupport("denied");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      setSubscribed(sub?.endpoint ?? null);
      setSupport("ready");
    })().catch(() => setSupport("unsupported"));
  }, []);

  async function enable() {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(permission === "denied" ? "denied" : "ready");
        setMessage("Notifications weren't allowed. You can change this in your browser settings.");
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) });
      const json = sub.toJSON();
      const result = await pushSubscribeAction({ endpoint: sub.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", label: deviceLabel() });
      setMessage(result.message);
      if (result.ok) setSubscribed(sub.endpoint);
      else await sub.unsubscribe();
    } catch {
      setMessage("Push notifications couldn't be turned on in this browser.");
    } finally {
      setBusy(false);
    }
  }

  async function disableHere() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await pushUnsubscribeAction({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setSubscribed(null);
      setMessage("Push notifications are off for this device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <p role="status" className="text-meta">
        {message}
      </p>
      {!publicKey ? (
        <p className="text-text-secondary">Push notifications aren&apos;t set up for this app yet. You&apos;ll still get notifications in the app and by email.</p>
      ) : support === "checking" ? null : support === "unsupported" ? (
        <p className="text-text-secondary">This browser doesn&apos;t support push notifications. You&apos;ll still get them in the app and by email.</p>
      ) : support === "needs-install" ? (
        <p className="text-text-secondary">
          On iPhone and iPad, push notifications work after you add the app to your Home Screen (iOS 16.4 or later) and open it from there.{" "}
          <a href="/install" className="font-semibold text-primary underline">How to install</a>
        </p>
      ) : support === "denied" ? (
        <p className="text-text-secondary">Notifications are blocked for this site in your browser settings. Allow them there, then return here.</p>
      ) : subscribed ? (
        <Button variant="secondary" size="sm" onClick={disableHere} loading={busy} loadingText="Turning off…">
          Turn off on this device
        </Button>
      ) : (
        <Button size="sm" onClick={enable} loading={busy} loadingText="Turning on…">
          Turn on for this device
        </Button>
      )}
      {devices.length ? (
        <ul className="space-y-2">
          {devices.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-muted px-4 py-3">
              <span>
                <span className="block font-semibold">{d.label ?? "A device"}</span>
                <span className="block text-sm text-text-secondary">Added {new Date(d.created_at).toLocaleDateString("en-US", { dateStyle: "medium" })}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  const r = await pushUnsubscribeAction({ id: d.id });
                  setMessage(r.message);
                }}
              >
                Remove<span className="sr-only"> {d.label ?? "device"}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-sm text-text-secondary">Push messages say only that something is new. Delivery isn&apos;t guaranteed, so in-app and email remain on.</p>
    </div>
  );
}
