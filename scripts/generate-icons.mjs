/**
 * Generate extension icons as PNG from inline SVG.
 * Run: node scripts/generate-icons.mjs
 * Requires: npm install sharp (dev dependency)
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SIZES = [16, 48, 128];
const ICON_DIR = join(import.meta.dirname, '..', 'public', 'icons');

mkdirSync(ICON_DIR, { recursive: true });

// Simple SVG icon — a "Y" shape (for "yard") on a blue circle
function svgIcon(size) {
  const r = size / 2;
  const stroke = Math.max(1, size * 0.12);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <circle cx="${r}" cy="${r}" r="${r}" fill="#3b82f6"/>
  <text x="${r}" y="${r * 1.35}" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="${size * 0.55}" fill="white">Y</text>
</svg>`;
}

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.log('sharp not installed, writing SVG files instead.');
    for (const size of SIZES) {
      const svg = svgIcon(size);
      const svgPath = join(ICON_DIR, `icon${size}.svg`);
      writeFileSync(svgPath, svg);
      console.log(`  wrote ${svgPath}`);
    }
    console.log('\nTo convert to PNG, run: npm install sharp && node scripts/generate-icons.mjs');
    return;
  }

  for (const size of SIZES) {
    const svg = svgIcon(size);
    const pngPath = join(ICON_DIR, `icon${size}.png`);
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    console.log(`  wrote ${pngPath}`);
  }
  console.log('\nIcons generated successfully!');
}

main();
