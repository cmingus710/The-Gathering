import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getChurchSettings } from "@/lib/settings/queries";
import { formatDate } from "@/lib/time";
import { renderStatementPdf, type StatementData } from "./statement-pdf";

export async function statementResponse(statement: StatementData, filename: string) {
  const { settings } = await getChurchSettings();
  const logo = await readFile(path.join(process.cwd(), "public/brand/the-gathering-logo.png")).catch(() => null);
  const pdf = await renderStatementPdf(statement, logo ? new Uint8Array(logo) : null, formatDate(new Date(), settings.timezone));
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
