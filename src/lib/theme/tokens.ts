/**
 * Design tokens, mirrored from src/app/globals.css (light values in @theme,
 * dark values under [data-theme="dark"]). Unit tests verify that both files
 * agree and that every text/background pairing the UI uses meets WCAG AA.
 */
/** Approved brand palette (unchanged). */
export const brand = {
  gold: "#AD8C53",
  charcoal: "#363430",
  ivory: "#F7F4ED",
  white: "#FFFFFF",
  sand: "#EAE3D5",
  deepGold: "#80642F",
  warmGray: "#716B61",
  olive: "#52664D",
  clay: "#A14538",
} as const;

export type ThemeName = "light" | "dark";

/** Semantic tokens. Keys map to `--color-<kebab-key>` in globals.css. */
export const palettes = {
  light: {
    background: "#F7F4ED",
    surface: "#FFFFFF",
    surfaceMuted: "#F1ECE2",
    surfaceRaised: "#FFFFFF",
    primary: "#80642F",
    primaryHover: "#664F24",
    primarySoft: "#F3EBDB",
    onPrimary: "#FFFFFF",
    accent: "#AD8C53",
    cta: "#363430",
    ctaHover: "#24221F",
    onCta: "#F7F4ED",
    text: "#363430",
    textSecondary: "#6B655B",
    border: "#E6DECF",
    borderStrong: "#8F887B",
    success: "#4A5D45",
    successSoft: "#EDF1E9",
    danger: "#A14538",
    dangerHover: "#86372C",
    dangerSoft: "#F8ECE9",
    onDanger: "#FFFFFF",
  },
  dark: {
    background: "#141311",
    surface: "#1F1D1B",
    surfaceMuted: "#2A2825",
    surfaceRaised: "#26241F",
    primary: "#C9AA72",
    primaryHover: "#DABF8C",
    primarySoft: "#2D2820",
    onPrimary: "#1C1B19",
    accent: "#AD8C53",
    cta: "#F7F4ED",
    ctaHover: "#EAE3D5",
    onCta: "#1C1B19",
    text: "#F7F4ED",
    textSecondary: "#B8B1A4",
    border: "#36332F",
    borderStrong: "#827C71",
    success: "#A3BC99",
    successSoft: "#1E271D",
    danger: "#E8998A",
    dangerHover: "#F0B0A4",
    dangerSoft: "#2E1C19",
    onDanger: "#1C1B19",
  },
} as const satisfies Record<ThemeName, Record<string, string>>;

/** Browser chrome colour (theme-color) per theme. */
export const THEME_COLOR: Record<ThemeName, string> = { light: palettes.light.background, dark: palettes.dark.background };

/** Sign-in pages: the light panel scoped by `.auth-theme` in globals.css. */
export const authBrand = {
  warmIvory: "#F6F1E6",
  plum: "#352936",
  antiqueGold: "#B89A60",
} as const;

export const authPalette = {
  background: "#F6F1E6",
  surface: "#FCFAF5",
  surfaceMuted: "#EDE6D8",
  surfaceRaised: "#FCFAF5",
  primary: "#352936",
  primaryHover: "#4A3A4B",
  primarySoft: "#ECE3E3",
  onPrimary: "#F6F1E6",
  accent: "#B89A60",
  cta: "#352936",
  ctaHover: "#4A3A4B",
  onCta: "#F6F1E6",
  text: "#2B2230",
  textSecondary: "#5E5361",
  border: "#E0D6C4",
  borderStrong: "#8A7E86",
  success: "#3F5A3A",
  successSoft: "#E5ECDF",
  danger: "#9A3324",
  dangerHover: "#7F2A1E",
  dangerSoft: "#F6E3DD",
  onDanger: "#F6F1E6",
} as const;

/**
 * Public welcome page: the light palette scoped by `.welcome-theme` in
 * globals.css (warm ivory, antique gold, charcoal; one look in both themes).
 */
export const welcomeBrand = {
  ivory: "#F7F4EC",
  antiqueGold: "#AE8C4E",
  charcoal: "#34332D",
  /** Warm near-black behind the hero gradient. */
  scrim: "#1A1611",
  /** Text on the antique gold button. */
  onGold: "#1F1E1A",
} as const;

export const welcomePalette = {
  background: "#F7F4EC",
  surface: "#FCFAF6",
  surfaceMuted: "#EFE9DC",
  surfaceRaised: "#FCFAF6",
  primary: "#6E5527",
  primaryHover: "#58431C",
  primarySoft: "#EFE6D3",
  onPrimary: "#F7F4EC",
  accent: "#AE8C4E",
  cta: "#34332D",
  ctaHover: "#24231F",
  onCta: "#F7F4EC",
  text: "#34332D",
  textSecondary: "#5F5A50",
  border: "#E4DBC8",
  borderStrong: "#8C8474",
  success: "#3F5A3A",
  successSoft: "#E5ECDF",
  danger: "#9A3324",
  dangerHover: "#7F2A1E",
  dangerSoft: "#F6E3DD",
  onDanger: "#F7F4EC",
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
