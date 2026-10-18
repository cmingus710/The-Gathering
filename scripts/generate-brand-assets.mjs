#!/usr/bin/env node
/**
 * Generates optimized web/PWA brand assets from the approved source artwork in
 * assets/brand/source. The source files are never modified.
 *
 *   npm run brand:assets
 *
 * Rules (from the brand brief):
 * - Never redraw, stretch, distort, or crop the artwork. Every resize keeps the
 *   aspect ratio (fit: "contain"/"inside"), and trimming only removes fully
 *   transparent padding plus isolated export specks far outside the artwork.
 * - App icons use the icon mark, never the shrunken wordmark.
 * - Corners are not pre-rounded; the operating system applies its own mask.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = {
  icon: path.join(root, "assets/brand/source/gathering-icon.supplied.webp"),
  logo: path.join(root, "assets/brand/source/the-gathering-logo-clearer-cross.supplied.webp"),
};
const IVORY = { r: 0xf7, g: 0xf4, b: 0xed, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Bounding box of the artwork, ignoring tiny isolated export specks. */
async function artworkBox(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rows = new Array(height).fill(0);
  const cols = new Array(width).fill(0);
  let total = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        rows[y]++;
        cols[x]++;
        total++;
      }
    }
  }
  const significantRange = (counts) => {
    const runs = [];
    let start = -1;
    let mass = 0;
    counts.forEach((c, i) => {
      if (c > 0 && start < 0) {
        start = i;
        mass = 0;
      }
      if (c > 0) mass += c;
      if ((c === 0 || i === counts.length - 1) && start >= 0) {
        runs.push({ start, end: c === 0 ? i - 1 : i, mass });
        start = -1;
      }
    });
    // A run holding < 0.05% of all artwork pixels is an export speck, not design.
    const kept = runs.filter((r) => r.mass / total >= 0.0005);
    return { start: Math.min(...kept.map((r) => r.start)), end: Math.max(...kept.map((r) => r.end)) };
  };
  const r = significantRange(rows);
  const c = significantRange(cols);
  const box = { left: c.start, top: r.start, width: c.end - c.start + 1, height: r.end - r.start + 1 };

  // Safety check: refuse to drop more than a negligible number of pixels.
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
      if (!inside && data[(y * width + x) * 4 + 3] > 0) outside++;
    }
  }
  if (outside / total > 0.0005) {
    throw new Error(`Trimming ${file} would remove ${outside} artwork pixels; refusing to crop the design.`);
  }
  return { box, width, height, removedSpeckPixels: outside };
}

async function trimmed(file) {
  const meta = await artworkBox(file);
  const buffer = await sharp(file).extract(meta.box).png().toBuffer();
  return { buffer, ...meta };
}

/** Places artwork centred on a square canvas; artwork height = `scale` × size. */
async function squareIcon(art, size, { scale, background }) {
  const inner = Math.round(size * scale);
  const resized = await sharp(art)
    .resize({ width: inner, height: inner, fit: "inside", kernel: "lanczos3" })
    .toBuffer();
  const m = await sharp(resized).metadata();
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: resized, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Verifies every visible pixel of a maskable icon lies inside the 40% radius safe zone. */
async function assertMaskableSafe(buffer, size, background) {
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const c = size / 2;
  const limit = size * 0.4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const differs =
        Math.abs(data[i] - background.r) + Math.abs(data[i + 1] - background.g) + Math.abs(data[i + 2] - background.b) > 12;
      if (differs && Math.hypot(x + 0.5 - c, y + 0.5 - c) > limit) {
        throw new Error(`Maskable icon ${size}px has artwork outside the safe zone at ${x},${y}`);
      }
    }
  }
}

/** Builds a PNG-embedded .ico (supported by all current browsers). */
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

async function out(rel, buffer) {
  const file = path.join(root, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  const m = await sharp(buffer).metadata().catch(() => null);
  console.log(`  ${rel}${m?.width ? ` (${m.width}×${m.height})` : ""}`);
}

async function main() {
  console.log("Brand sources:");
  const icon = await trimmed(SOURCE.icon);
  console.log(
    `  icon ${icon.width}×${icon.height} → artwork ${icon.box.width}×${icon.box.height} at ${icon.box.left},${icon.box.top}` +
      ` (removed ${icon.removedSpeckPixels} isolated speck pixels)`,
  );
  const logo = await trimmed(SOURCE.logo);
  console.log(
    `  logo ${logo.width}×${logo.height} → artwork ${logo.box.width}×${logo.box.height} at ${logo.box.left},${logo.box.top}` +
      ` (removed ${logo.removedSpeckPixels} isolated speck pixels)`,
  );

  console.log("Display copies:");
  // Full logo: 1200px wide is ample for 2× displays at the sizes we render (≤ 560 CSS px).
  const logoPng = await sharp(logo.buffer).resize({ width: 1200, fit: "inside", kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
  await out("public/brand/the-gathering-logo.png", logoPng);
  await out("public/brand/the-gathering-logo.webp", await sharp(logoPng).webp({ quality: 92, alphaQuality: 100 }).toBuffer());
  const iconPng = await sharp(icon.buffer).resize({ height: 512, fit: "inside", kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();
  await out("public/brand/gathering-icon.png", iconPng);
  await out("public/brand/gathering-icon.webp", await sharp(iconPng).webp({ quality: 92, alphaQuality: 100 }).toBuffer());

  console.log("App and browser icons:");
  // "any" purpose: transparent square, artwork fills 92% of the height.
  for (const size of [192, 512]) {
    await out(`public/icons/icon-${size}.png`, await squareIcon(icon.buffer, size, { scale: 0.92, background: TRANSPARENT }));
  }
  // Maskable: opaque ivory, artwork kept within the 80% diameter safe zone.
  for (const size of [192, 512]) {
    const buf = await squareIcon(icon.buffer, size, { scale: 0.58, background: IVORY });
    await assertMaskableSafe(buf, size, IVORY);
    await out(`public/icons/maskable-${size}.png`, buf);
  }
  // Apple touch icon must be opaque (iOS fills transparency with black) and square.
  await out("src/app/apple-icon.png", await squareIcon(icon.buffer, 180, { scale: 0.8, background: IVORY }));
  // Browser tab icons: transparent, artwork as large as possible for legibility.
  await out("src/app/icon.png", await squareIcon(icon.buffer, 96, { scale: 1, background: TRANSPARENT }));
  const ico = [];
  for (const size of [16, 32, 48]) {
    ico.push({ size, data: await squareIcon(icon.buffer, size, { scale: 1, background: TRANSPARENT }) });
  }
  await out("src/app/favicon.ico", buildIco(ico));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
