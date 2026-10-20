import Link from "next/link";
import { formatStartShort } from "@/lib/events/format";
import type { EventOccurrence } from "@/lib/events/types";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayLabel(ymd: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${ymd}T12:00:00Z`));
}

/**
 * Month grid for wider screens. A plain table: every event is a link, so
 * Tab moves through them in date order; the agenda list below the grid is
 * the screen-reader and phone alternative.
 */
export function MonthGrid({ month, days, byDay, today }: { month: string; days: string[]; byDay: Map<string, EventOccurrence[]>; today: string }) {
  const weeks = Array.from({ length: 6 }, (_, w) => days.slice(w * 7, w * 7 + 7));
  return (
    <table className="hidden w-full table-fixed border-separate border-spacing-1 md:table" aria-describedby="month-grid-note">
      <caption id="month-grid-note" className="sr-only">
        Calendar grid. Each day lists its events; the same events are listed by day after the grid.
      </caption>
      <thead>
        <tr>
          {WEEKDAY_SHORT.map((d, i) => (
            <th key={d} scope="col" className="pb-1 pl-1.5 text-left text-eyebrow font-semibold text-text-secondary">
              <abbr title={WEEKDAY_LONG[i]} className="no-underline">
                {d}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]}>
            {week.map((day) => {
              const inMonth = day.startsWith(month);
              const items = byDay.get(day) ?? [];
              const isToday = day === today;
              return (
                <td
                  key={day}
                  className={`h-28 rounded-control border p-1.5 align-top ${inMonth ? "border-border bg-surface" : "border-transparent bg-surface-muted/50"} ${isToday ? "ring-2 ring-primary" : ""}`}
                >
                  <div className={`mb-1 text-meta font-semibold tabular-nums ${isToday ? "text-primary" : inMonth ? "text-text" : "text-text-secondary"}`}>
                    <span aria-hidden="true">{Number(day.slice(8))}</span>
                    <span className="sr-only">
                      {dayLabel(day)}
                      {isToday ? " (today)" : ""}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((o) => (
                      <li key={`${o.id}-${day}`}>
                        <Link
                          href={`/events/${o.id}`}
                          className={`block truncate rounded px-1.5 py-0.5 text-xs font-semibold hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-primary ${
                            o.status === "canceled" ? "text-text-secondary line-through" : "border-l-2 border-accent bg-primary-soft text-text"
                          }`}
                        >
                          {o.status === "canceled" ? <span className="sr-only">Canceled: </span> : null}
                          {formatStartShort(o)} {o.title}
                        </Link>
                      </li>
                    ))}
                    {items.length > 3 ? <li className="px-1.5 text-xs text-text-secondary">+{items.length - 3} more (listed below)</li> : null}
                  </ul>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
