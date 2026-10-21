import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";

const ITEMS: Array<{ href: string; label: string; requires: Capability }> = [
  { href: "/admin/finance", label: "Overview", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/contributions", label: "Contributions", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/recurring", label: "Recurring", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/manual", label: "Record cash/check", requires: CAPABILITIES.financeRecord },
  { href: "/admin/finance/statements", label: "Statements", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/funds", label: "Funds", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/campaigns", label: "Campaigns", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/settings", label: "Settings", requires: CAPABILITIES.financeView },
  { href: "/admin/finance/operations", label: "Reconcile & email", requires: CAPABILITIES.financeManage },
];

export function FinanceNav({ current, capabilities }: { current: string; capabilities: ReadonlySet<Capability> }) {
  return (
    <nav aria-label="Giving administration" className="-mx-1 mb-6 overflow-x-auto px-1">
      <ul className="flex gap-1.5">
        {ITEMS.filter((i) => capabilities.has(i.requires)).map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={current === i.href ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center whitespace-nowrap rounded-full border px-4 font-semibold",
                current === i.href ? "border-text bg-text text-background" : "border-border-strong bg-surface hover:bg-surface-muted",
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Persistent reminder that this phase runs on Stripe test mode only. */
export function TestModeNotice() {
  return (
    <p className="mb-4 inline-flex rounded-full border border-primary/60 bg-primary-soft px-3 py-1 text-sm font-bold text-text">
      Test mode: no real money moves in this environment
    </p>
  );
}
