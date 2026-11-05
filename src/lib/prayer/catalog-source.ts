import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CATHOLIC_ONLINE, normalizeCatalog, type CatalogLink, type CatalogReport, type CatalogTopic } from "./catalog";

export type PreparedCatalog =
  | { ok: true; links: CatalogLink[]; topics: CatalogTopic[]; report: CatalogReport; sha256: string }
  | { ok: false; message: string };

/**
 * Reads the pinned Catholic Online catalogue shipped with the app (traced
 * into the admin routes by next.config.ts), checks both files' SHA-256
 * against the pinned hashes, and normalizes them. Nothing is written and
 * nothing is fetched: this is the dry run the import runs first.
 */
export async function prepareCatholicOnline(): Promise<PreparedCatalog> {
  let bytes: Buffer;
  let coverageBytes: Buffer;
  try {
    // Literal paths, so the build traces exactly these two files
    // (CATHOLIC_ONLINE.localPath / .coveragePath name the same ones).
    bytes = await readFile(path.join(process.cwd(), "data/prayers/catholic-online/prayers.json"));
    coverageBytes = await readFile(path.join(process.cwd(), "data/prayers/catholic-online/coverage.json"));
  } catch {
    return { ok: false, message: "The catalogue files aren't available on this server. Nothing was imported." };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const coverageSha256 = createHash("sha256").update(coverageBytes).digest("hex");
  let parsed: unknown;
  let coverageParsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
    coverageParsed = JSON.parse(coverageBytes.toString("utf8"));
  } catch {
    return { ok: false, message: "A catalogue file isn't valid JSON. Nothing was imported." };
  }
  const { links, topics, report } = normalizeCatalog(parsed, coverageParsed, { sha256, coverageSha256 });
  if (!report.source.sha256_matches || report.source.coverage_matches === false) {
    return { ok: false, message: `The catalogue files on this server don't match the pinned hashes (${CATHOLIC_ONLINE.localPath}). Nothing was imported.` };
  }
  return { ok: true, links, topics, report, sha256 };
}
