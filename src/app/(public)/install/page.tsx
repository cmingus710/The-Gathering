import type { Metadata } from "next";
import { IconBadge } from "@/components/brand/logo";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { Card } from "@/components/ui/card";

export const metadata: Metadata = { title: "Add to Home Screen" };

const STEPS: Array<{ title: string; note?: string; steps: string[] }> = [
  {
    title: "iPhone and iPad (Safari)",
    steps: [
      "Open this site in Safari.",
      "Tap the Share button (the square with an arrow pointing up).",
      "Scroll down and tap “Add to Home Screen”.",
      "Keep the name “The Gathering” and tap Add.",
    ],
    note: "On iOS 16.4 and later, Chrome and Edge also offer “Add to Home Screen” from their Share menu.",
  },
  {
    title: "Android (Chrome, Edge, or Samsung Internet)",
    steps: ["Open the browser menu (⋮ or ≡).", "Tap “Install app” or “Add to Home screen”.", "Confirm by tapping Install."],
  },
  {
    title: "Computer (Chrome or Edge)",
    steps: ["Look for the install icon at the right end of the address bar.", "Click it, then choose Install."],
    note: "Safari on macOS Sonoma or later: choose File → Add to Dock. Firefox doesn't support installing web apps.",
  },
];

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="flex items-center gap-4">
        <IconBadge className="size-16" />
        <div>
          <h1 className="font-display text-3xl font-semibold">Add The Gathering to your Home Screen</h1>
          <p className="mt-1 text-text-secondary">It opens full-screen like an app, with no app store needed.</p>
        </div>
      </div>
      <div className="mt-6">
        <InstallPrompt />
      </div>
      <div className="mt-8 grid gap-5">
        {STEPS.map((s) => (
          <Card key={s.title}>
            <h2 className="text-xl font-bold">{s.title}</h2>
            <ol className="mt-3 list-decimal space-y-1.5 pl-6">
              {s.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {s.note ? <p className="mt-3 text-meta text-text-secondary">{s.note}</p> : null}
          </Card>
        ))}
      </div>
      <p className="mt-8 text-text-secondary">
        For your privacy, the installed app never stores member pages for offline use. Signing out removes access on that device.
      </p>
    </div>
  );
}
