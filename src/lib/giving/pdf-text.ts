import bidiFactory from "bidi-js";
import * as fontkit from "fontkit";
import {
  PDFHexString,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
  showText,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";

/**
 * Unicode text for statement PDFs. The standard PDF fonts only cover
 * Western European characters, so names like "李伟", "محمد" or "Nguyễn"
 * would otherwise be lost. Text is split into runs, each drawn with the
 * first bundled Noto font that has its glyphs, and runs are placed in
 * visual order using the Unicode bidi algorithm so Arabic and Hebrew read
 * right to left. fontkit shapes each run (Arabic joining, Indic
 * reordering) and positions marks; each glyph is drawn at that position,
 * because pdf-lib's drawText ignores mark offsets (Noto Sans Arabic draws
 * the dots of letters like ي as separately positioned marks).
 */

/**
 * pdf-lib expects the fontkit 1 API (@pdf-lib/fontkit), but that fork's
 * subsetter drops glyph outlines from the Noto fonts. fontkit 2 subsets
 * correctly; the only difference pdf-lib touches is encodeStream(), which
 * fontkit 2 replaced with encode().
 */
let lastCreated: fontkit.Font | null = null;
const pdfLibFontkit = {
  create(data: Uint8Array) {
    const font = fontkit.create(Buffer.from(data));
    lastCreated = font;
    const createSubset = font.createSubset.bind(font);
    font.createSubset = () => {
      const subset = createSubset();
      return Object.assign(subset, {
        encodeStream() {
          const handlers: Record<string, (arg?: unknown) => void> = {};
          const stream = {
            on(event: string, handler: (arg?: unknown) => void) {
              handlers[event] = handler;
              return stream;
            },
          };
          queueMicrotask(() => {
            try {
              handlers.data?.(subset.encode());
              handlers.end?.();
            } catch (error) {
              handlers.error?.(error);
            }
          });
          return stream;
        },
      });
    };
    return font;
  },
};

export type Face = "regular" | "bold";
type Script = "latin" | "arabic" | "hebrew" | "thai" | "cjk" | "korean";

/** Font files in assets/fonts. CJK is Regular only to limit size. */
export const FONT_FILES: Record<Script, Record<Face, string>> = {
  latin: { regular: "NotoSans-Regular.ttf", bold: "NotoSans-Bold.ttf" },
  arabic: { regular: "NotoSansArabic-Regular.ttf", bold: "NotoSansArabic-Bold.ttf" },
  hebrew: { regular: "NotoSansHebrew-Regular.ttf", bold: "NotoSansHebrew-Bold.ttf" },
  thai: { regular: "NotoSansThai-Regular.ttf", bold: "NotoSansThai-Bold.ttf" },
  cjk: { regular: "NotoSansSC-Regular.ttf", bold: "NotoSansSC-Regular.ttf" },
  korean: { regular: "NotoSansKR-Regular.ttf", bold: "NotoSansKR-Regular.ttf" },
};

/** Which optional fonts a string needs, so the large ones load only when used. */
const SCRIPT_TESTS: Array<[Script, RegExp]> = [
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["thai", /\p{Script=Thai}/u],
  ["korean", /\p{Script=Hangul}/u],
  ["cjk", /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u3000-\u303f\uff00-\uffef]/u],
];

const NEUTRAL = /^[\p{Script=Common}\p{Script=Inherited}]$/u;
const RTL_SCRIPT = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const LETTER = /[^\p{Script=Common}\p{Script=Inherited}]/u;

export type FontLoader = (file: string) => Promise<Uint8Array | null>;

type Loaded = { font: PDFFont; chars: Set<number>; shaper: fontkit.Font };
type Run = { text: string; font: PDFFont };

let bidi: ReturnType<typeof bidiFactory> | null = null;

/**
 * Last resort when the bundled fonts can't be read: the standard PDF fonts
 * only cover WinAnsi, so substitute anything else rather than fail.
 */
export function winAnsiSafe(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, "?");
}

export class PdfText {
  private fonts: Partial<Record<Script, Partial<Record<Face, Loaded>>>> = {};
  private shapers = new Map<PDFFont, fontkit.Font>();

  private constructor(private fallback: Record<Face, PDFFont>) {}

  /**
   * Embeds the fonts `texts` need (always Latin, plus any other scripts
   * present). Glyphs are subset, so the PDF only carries characters used.
   */
  static async create(doc: PDFDocument, texts: string[], load: FontLoader, fallback: Record<Face, PDFFont>): Promise<PdfText> {
    doc.registerFontkit(pdfLibFontkit as unknown as Parameters<PDFDocument["registerFontkit"]>[0]);
    const pdf = new PdfText(fallback);
    const all = texts.join("\n");
    const scripts: Script[] = ["latin", ...SCRIPT_TESTS.filter(([, re]) => re.test(all)).map(([s]) => s)];
    for (const script of scripts) {
      for (const face of ["regular", "bold"] as const) {
        const file = FONT_FILES[script][face];
        const same = face === "bold" && file === FONT_FILES[script].regular ? pdf.fonts[script]?.regular : undefined;
        if (same) {
          pdf.fonts[script] = { ...pdf.fonts[script], bold: same };
          continue;
        }
        const bytes = await load(file);
        if (!bytes) continue;
        lastCreated = null;
        const font = await doc.embedFont(bytes, { subset: true });
        if (!lastCreated) throw new Error("Font was not loaded through fontkit");
        const shaper: fontkit.Font = lastCreated;
        pdf.shapers.set(font, shaper);
        pdf.fonts[script] = { ...pdf.fonts[script], [face]: { font, chars: new Set(font.getCharacterSet()), shaper } };
      }
    }
    return pdf;
  }

  private candidates(face: Face): Loaded[] {
    const order: Script[] = ["latin", "arabic", "hebrew", "thai", "cjk", "korean"];
    return order.map((s) => this.fonts[s]?.[face]).filter((f): f is Loaded => !!f);
  }

  /** Runs of `text` in left-to-right drawing order, each with its font. */
  runs(text: string, face: Face): Run[] {
    const clean = text.normalize("NFC").replace(/[\r\n\t]+/g, " ");
    if (!clean) return [];
    const fonts = this.candidates(face);
    if (!fonts.length) return [{ text: winAnsiSafe(clean), font: this.fallback[face] }];
    bidi ??= bidiFactory();
    const { levels } = bidi.getEmbeddingLevels(clean);

    // Logical runs: split where the font or the bidi level changes.
    type Logical = { chars: string[]; font: PDFFont; level: number };
    const logical: Logical[] = [];
    let index = 0;
    for (const ch of clean) {
      const code = ch.codePointAt(0)!;
      const level = levels[index];
      index += ch.length;
      const current = logical.at(-1);
      const sticky = current && current.level === level && NEUTRAL.test(ch) && fonts.find((f) => f.font === current.font)?.chars.has(code);
      let font: PDFFont;
      let out = ch;
      if (sticky) font = current.font;
      else {
        const found = fonts.find((f) => f.chars.has(code));
        if (found) font = found.font;
        else {
          // Nothing bundled has this character (for example an emoji).
          font = fonts[0].font;
          out = "?";
        }
      }
      if (current && current.font === font && current.level === level) current.chars.push(out);
      else logical.push({ chars: [out], font, level });
    }

    // Reverse runs per the bidi algorithm (rule L2), highest level first.
    const max = Math.max(...logical.map((r) => r.level));
    const minOdd = Math.min(...logical.map((r) => (r.level % 2 ? r.level : r.level + 1)));
    let visual = logical;
    for (let k = max; k >= minOdd; k--) {
      const next: Logical[] = [];
      let i = 0;
      while (i < visual.length) {
        if (visual[i].level < k) next.push(visual[i++]);
        else {
          const start = i;
          while (i < visual.length && visual[i].level >= k) i++;
          next.push(...visual.slice(start, i).reverse());
        }
      }
      visual = next;
    }

    // fontkit reverses a run itself when its first letter is Arabic or
    // Hebrew. Reverse any run whose order still differs from its level
    // (neutrals in right-to-left text, or Arabic-Indic digits in a
    // left-to-right run) and mirror brackets in right-to-left runs.
    return visual.map((r) => {
      const first = r.chars.find((c) => LETTER.test(c));
      const fontkitReverses = !!first && RTL_SCRIPT.test(first);
      const rtl = r.level % 2 === 1;
      let chars = r.chars;
      if (rtl && !fontkitReverses) chars = [...chars].reverse().map((c) => bidi!.getMirroredCharacter(c) ?? c);
      else if (!rtl && fontkitReverses) chars = [...chars].reverse();
      return { text: chars.join(""), font: r.font };
    });
  }

  /** Advance of one run, including kerning and mark positioning. */
  private runWidth(run: Run, size: number): number {
    const shaper = this.shapers.get(run.font);
    if (!shaper) return run.font.widthOfTextAtSize(run.text, size);
    const { positions } = shaper.layout(run.text);
    return (positions.reduce((sum, p) => sum + p.xAdvance, 0) * size) / shaper.unitsPerEm;
  }

  width(text: string, size: number, face: Face): number {
    return this.runs(text, face).reduce((sum, r) => sum + this.runWidth(r, size), 0);
  }

  /** Draws `text` with its left edge at x, on baseline y. */
  draw(page: PDFPage, text: string, opts: { x: number; y: number; size: number; face: Face; color: RGB }) {
    let x = opts.x;
    for (const run of this.runs(text, opts.face)) {
      const shaper = this.shapers.get(run.font);
      // encodeText adds the glyphs to the font subset and returns their
      // subset ids, in the same (visual) order as fontkit's layout.
      const ids = shaper ? run.font.encodeText(run.text).toString().slice(1, -1).match(/.{4}/g) ?? [] : [];
      const layout = shaper?.layout(run.text);
      if (!shaper || !layout || ids.length !== layout.positions.length) {
        page.drawText(run.text, { x, y: opts.y, size: opts.size, font: run.font, color: opts.color });
        x += run.font.widthOfTextAtSize(run.text, opts.size);
        continue;
      }
      const scale = opts.size / shaper.unitsPerEm;
      const key = page.node.newFontDictionary(run.font.name, run.font.ref);
      const ops = [pushGraphicsState(), beginText(), setFillingColor(opts.color), setFontAndSize(key, opts.size)];
      layout.positions.forEach((p, i) => {
        ops.push(setTextMatrix(1, 0, 0, 1, x + p.xOffset * scale, opts.y + p.yOffset * scale), showText(PDFHexString.of(ids[i])));
        x += p.xAdvance * scale;
      });
      ops.push(endText(), popGraphicsState());
      page.pushOperators(...ops);
    }
  }
}
