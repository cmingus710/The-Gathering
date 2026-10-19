import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDate } from "@/lib/time";
import { renderStatementPdf, type StatementData } from "./statement-pdf";

// Font files are read once per server instance (the CJK ones are large and
// are only read when a statement contains those scripts).
const fontCache = new Map<string, Promise<Uint8Array | null>>();
function loadFont(file: string) {
  let bytes = fontCache.get(file);
  if (!bytes) {
    bytes = readFile(path.join(process.cwd(), "assets/fonts", file)).then(
      (b) => new Uint8Array(b),
      () => {
        fontCache.delete(file);
        return null;
      },
    );
    fontCache.set(file, bytes);
  }
  return bytes;
}

export async function statementResponse(statement: StatementData, filename: string) {
  const { settings } = await getChurchSettings();
  const logo = await readFile(path.join(process.cwd(), "public/brand/the-gathering-logo.png")).catch(() => null);
  const pdf = await renderStatementPdf(statement, logo ? new Uint8Array(logo) : null, formatDate(new Date(), settings.timezone), loadFont);
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
