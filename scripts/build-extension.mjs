/**
 * Build the Chrome extension.
 * 1. Run Vite build
 * 2. Copy extension assets into dist/
 * 3. Ready to load as unpacked extension
 */
import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, existsSync, cpSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');

console.log('🔨 Building ScreenYard extension...\n');

// Step 1: Vite build
console.log('1/3 Running Vite build...');
execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' });

// Step 2: Copy extension assets
console.log('\n2/3 Copying extension assets...');

// Copy manifest.json
copyFileSync(join(PUBLIC, 'manifest.json'), join(DIST, 'manifest.json'));
console.log('  ✓ manifest.json');

// Copy background.js
copyFileSync(join(PUBLIC, 'background.js'), join(DIST, 'background.js'));
console.log('  ✓ background.js');

// Copy content_script.js
copyFileSync(join(PUBLIC, 'content_script.js'), join(DIST, 'content_script.js'));
console.log('  ✓ content_script.js');

// Copy icons
const iconsSrc = join(PUBLIC, 'icons');
const iconsDist = join(DIST, 'icons');
mkdirSync(iconsDist, { recursive: true });

for (const size of [16, 48, 128]) {
  const pngSrc = join(iconsSrc, `icon${size}.png`);
  if (existsSync(pngSrc)) {
    copyFileSync(pngSrc, join(iconsDist, `icon${size}.png`));
    console.log(`  ✓ icons/icon${size}.png`);
  } else {
    console.log(`  ⚠ icons/icon${size}.png not found — run "node scripts/generate-icons.mjs" first`);
  }
}

// Copy MediaPipe WASM + model for offline support
const mediapipeSrc = join(PUBLIC, 'mediapipe');
const mediapipeDist = join(DIST, 'mediapipe');
if (existsSync(mediapipeSrc)) {
  mkdirSync(mediapipeDist, { recursive: true });
  cpSync(join(mediapipeSrc, 'wasm'), join(mediapipeDist, 'wasm'), { recursive: true });
  console.log('  ✓ mediapipe/wasm/');
  const modelSrc = join(mediapipeSrc, 'hand_landmarker.task');
  if (existsSync(modelSrc)) {
    copyFileSync(modelSrc, join(mediapipeDist, 'hand_landmarker.task'));
    console.log('  ✓ mediapipe/hand_landmarker.task');
  } else {
    console.log('  ⚠ mediapipe/hand_landmarker.task not found');
  }
} else {
  console.log('  ⚠ mediapipe/ not found — hand tracking will use CDN fallback');
}

// Step 3: Done
console.log('\n3/3 Done!\n');
console.log('To install in Brave/Chrome:');
console.log('  1. Open brave://extensions/ (or chrome://extensions/)');
console.log('  2. Enable "Developer mode"');
console.log('  3. Click "Load unpacked"');
console.log(`  4. Select the folder: ${DIST}`);
console.log('');
