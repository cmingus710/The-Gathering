// fontkit 2 ships no types; this covers what statement PDFs use. The font
// is also handed to pdf-lib, which has its own font types.
declare module "fontkit" {
  export type Subset = { includeGlyph(glyph: unknown): number; encode(): Uint8Array };
  export type Position = { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number };
  export type Font = {
    unitsPerEm: number;
    layout(text: string): { glyphs: unknown[]; positions: Position[] };
    createSubset(): Subset;
    [key: string]: unknown;
  };
  export function create(buffer: Buffer | Uint8Array, postscriptName?: string): Font;
}
