/**
 * Design tokens, mirrored from the @theme block in src/app/globals.css.
 * Unit tests verify the contrast of every text/background pairing the UI uses.
 */
/** Approved brand palette (unchanged by the dark interface). */
export const brand = {
  gold: "#AD8C53",
  charcoal: "#363430",
  ivory: "#F7F4ED",
  sand: "#EAE3D5",
  deepGold: "#80642F",
  olive: "#52664D",
  clay: "#A14538",
} as const;

/** Semantic tokens for the dark interface. */
export const palette = {
  background: "#121110",
  surface: "#22201E",
  surfaceMuted: "#2E2C29",
  primary: "#AD8C53",
  primaryHover: "#C4A46C",
  primarySoft: "#2A261F",
  onPrimary: "#1C1B19",
  cta: "#F7F4ED",
  ctaHover: "#EAE3D5",
  onCta: "#1C1B19",
  text: "#F7F4ED",
  textSecondary: "#B3AC9F",
  border: "#33312D",
  borderStrong: "#7F796E",
  success: "#9DB794",
  successSoft: "#1D261C",
  danger: "#E59484",
  dangerHover: "#EEAB9E",
  dangerSoft: "#2D1B18",
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
