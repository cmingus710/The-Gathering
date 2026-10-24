import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MORNING_EVENING, normalizeMorningEvening, type ImportReport, type Reading } from "./morning-evening";

export type PreparedImport = { ok: true; readings: Reading[]; report: ImportReport; sha256: string } | { ok: false; message: string };

/**
 * Reads the pinned Morning & Evening file shipped with the app (traced into
 * the admin routes by next.config.ts), checks its SHA-256 against the pinned
 * hash, and normalizes it. Nothing is written: this is the dry run.
 */
export async function prepareMorningEvening(): Promise<PreparedImport> {
  let bytes: Buffer;
  try {
    // A literal path, so the build traces only this file (MORNING_EVENING.localPath names the same file).
    bytes = await readFile(path.join(process.cwd(), "data/devotionals/morning-and-evening/m_e.json"));
  } catch {
    return { ok: false, message: "The source file isn't available on this server. Nothing was imported." };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return { ok: false, message: "The source file isn't valid JSON. Nothing was imported." };
  }
  const { readings, report } = normalizeMorningEvening(parsed, { sha256 });
  return { ok: true, readings, report, sha256 };
}

/** The collection's description and provenance, as the import writes them. */
export function morningEveningMeta() {
  const m = MORNING_EVENING;
  return {
    key: m.key,
    title: m.title,
    subtitle: m.subtitle,
    author: m.author,
    description: m.description,
    attribution: `${m.title} — ${m.author}`,
    rights: m.text.rights,
    rights_statement: m.text.statement,
    text_source_url: m.text.url,
    upstream_url: m.text.upstream,
    source_repository: m.source.repository,
    source_commit: m.source.commit,
    source_path: m.source.path,
    source_sha256: m.source.sha256,
    source_license: m.source.license,
    source_license_notice: m.source.licenseNotice,
  };
}

/** The report as stored with the import (examples trimmed; warnings keep their full reading lists). */
export function storedReport(report: ImportReport): ImportReport {
  return { ...report, malformed: report.malformed.slice(0, 50) };
}
