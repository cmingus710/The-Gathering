// bidi-js ships no types; this covers the parts statement PDFs use.
declare module "bidi-js" {
  type Bidi = {
    getEmbeddingLevels(text: string, direction?: "ltr" | "rtl" | "auto"): { levels: Uint8Array; paragraphs: Array<{ start: number; end: number; level: number }> };
    getMirroredCharacter(char: string): string | null;
  };
  export default function bidiFactory(): Bidi;
}
