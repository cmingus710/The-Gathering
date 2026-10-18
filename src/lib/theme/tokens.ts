/**
 * Approved palette, mirrored from the @theme block in src/app/globals.css.
 * Unit tests verify the contrast of every text/background pairing the UI uses.
 */
export const palette = {
  brandGold: "#AD8C53",
  brandCharcoal: "#363430",
  background: "#F7F4ED",
  surface: "#FFFFFF",
  surfaceMuted: "#EAE3D5",
  primary: "#80642F",
  primaryHover: "#6A5226",
  primarySoft: "#F3ECDD",
  onPrimary: "#FFFFFF",
  text: "#363430",
  textSecondary: "#716B61",
  border: "#DDD5C6",
  borderStrong: "#8A8275",
  success: "#52664D",
  successSoft: "#E9EEE6",
  danger: "#A14538",
  dangerHover: "#873A2F",
  dangerSoft: "#F7E9E6",
} as const;

function luminance(hex: string): number {
  const channels = [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
