import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import type { ImportReport } from "@/lib/devotionals/morning-evening";
import type { ImportResult } from "@/lib/devotionals/types";

const num = (n: number) => n.toLocaleString("en-US");

/** The dry-run report: counts, calendar coverage, problems, corrections made, and warnings left for review. */
export function ImportReportView({ report }: { report: ImportReport }) {
  const rows: Array<[string, ReactNode]> = [
    ["Source", `${report.source.repository.replace(/^https:\/\/github\.com\//, "")} @ ${report.source.commit.slice(0, 12)} · ${report.source.path}`],
    [
      "File hash (SHA-256)",
      <span key="sha" className="[overflow-wrap:anywhere]">
        {report.source.sha256 ?? "not checked"}{" "}
        {report.source.sha256_matches === true ? <Badge tone="success">matches the pinned hash</Badge> : report.source.sha256_matches === false ? <Badge tone="danger">does not match</Badge> : null}
      </span>,
    ],
    ["Records in the file", num(report.records)],
    ["Readings ready", `${num(report.readings)} (morning ${num(report.by_slot.morning)}, evening ${num(report.by_slot.evening)})`],
    ["Calendar days with both readings", `${num(report.days_complete)} of 366`],
    ["February 29", `morning ${report.feb29.morning ? "present" : "missing"}, evening ${report.feb29.evening ? "present" : "missing"}`],
    ["Missing", report.missing.length ? report.missing.join(", ") : "none"],
    ["Duplicates", report.duplicates.length ? report.duplicates.join(", ") : "none"],
    ["Malformed records", report.malformed.length ? num(report.malformed.length) : "none"],
  ];
  return (
    <div className="space-y-5 text-meta">
      <p>{report.ok ? <Badge tone="success">Ready to import</Badge> : <Badge tone="danger">Blocked: fix the problems below first</Badge>}</p>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[14rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold text-text-secondary">{k}</dt>
            <dd className="[overflow-wrap:anywhere]">{v}</dd>
          </div>
        ))}
      </dl>
      {report.malformed.length ? (
        <ul className="list-disc space-y-1 pl-5 text-danger">
          {report.malformed.map((m, i) => (
            <li key={i}>{m.message}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <h3 className="mb-1 font-semibold text-text">Corrections made (verified)</h3>
        <ul className="space-y-2">
          {report.fixes.map((f) => (
            <li key={f.code}>
              <span className="font-semibold">
                {num(f.readings)} {f.readings === 1 ? "reading" : "readings"}, {num(f.occurrences)} {f.occurrences === 1 ? "change" : "changes"}:
              </span>{" "}
              {f.description} <span className="text-text-secondary">(e.g. {f.examples.slice(0, 4).join(", ")})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="mb-1 font-semibold text-text">Left as the source has it (for review)</h3>
        {report.warnings.length ? (
          <ul className="space-y-2">
            {report.warnings.map((w) => (
              <li key={w.code}>
                <span className="font-semibold">
                  {num(w.readings.length)} {w.readings.length === 1 ? "reading" : "readings"}:
                </span>{" "}
                {w.description}{" "}
                <span className="text-text-secondary [overflow-wrap:anywhere]">
                  ({w.readings.slice(0, 8).join(", ")}
                  {w.readings.length > 8 ? ", …" : ""})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Nothing.</p>
        )}
      </div>
    </div>
  );
}

/** What an applied import did. */
export function ImportResultView({ result }: { result: ImportResult }) {
  const parts = [
    `${num(result.inserted)} added`,
    `${num(result.updated)} updated from the source`,
    `${num(result.unchanged)} unchanged`,
    `${num(result.kept_edits)} corrections kept`,
    `${num(result.conflicts.length)} conflicts`,
  ];
  return (
    <div className="space-y-1 text-meta">
      <p>
        {num(result.staged)} readings checked: {parts.join(", ")}. The collection has {num(result.total)} readings.
      </p>
      {result.conflicts.length ? (
        <p>
          <span className="font-semibold">Conflicts</span> (an editor&apos;s correction was kept; the new source text is shown on each reading):{" "}
          <span className="[overflow-wrap:anywhere]">{result.conflicts.join(", ")}</span>
        </p>
      ) : null}
      {result.not_in_source.length ? (
        <p>
          <span className="font-semibold">Not in this source</span> (kept, never deleted by an import):{" "}
          <span className="[overflow-wrap:anywhere]">{result.not_in_source.join(", ")}</span>
        </p>
      ) : null}
    </div>
  );
}
