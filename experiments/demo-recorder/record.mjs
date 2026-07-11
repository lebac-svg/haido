/**
 * Headless recorder for the README live-map GIF (docs/DEMO.md).
 *
 * Films a STAGED CLONE, never the real repo: it edits files on a timeline
 * (agent-stamped touches -> cyan glow, a new file -> bloom, an unstamped edit
 * on docs/vi/QUALITY.md -> the m_boot_010 diamond flashes yellow, revert ->
 * heal), while screenshotting the live map and encoding a GIF.
 *
 * Setup (one-off, in THIS folder — deps are not part of the product):
 *   npm init -y && npm i playwright pngjs gifenc && npx playwright install chromium
 *
 * Stage + run:
 *   git clone <repo> <stage>/haido && cp -r <repo>/.haido <stage>/haido/.haido
 *   (cd <stage>/haido && node <repo>/dist/cli.js viz --live --port 6199) &
 *   node record.mjs <stage>/haido http://127.0.0.1:6199/ live-map.gif
 */
import { chromium } from 'playwright';
import pngpkg from 'pngjs';
import gifpkg from 'gifenc';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { PNG } = pngpkg;
const { GIFEncoder, quantize, applyPalette } = gifpkg;

const [REPO, URL = 'http://127.0.0.1:6199/', OUT = 'live-map.gif'] = process.argv.slice(2);
if (!REPO) {
  console.error('usage: node record.mjs <stagedRepoRoot> [mapUrl] [outGif]');
  process.exit(1);
}
const W = 1280;
const H = 720;
const FPS = 8;
const TOTAL_S = 24;

const sessionDir = path.join(REPO, '.haido', 'session');
mkdirSync(sessionDir, { recursive: true });

function stampAgent(files) {
  const lastTouch = {};
  for (const f of files) lastTouch[f] = Date.now();
  // also stamp an injection so the GIF shows recall happening (🤖 in the feed)
  writeFileSync(
    path.join(sessionDir, 'demo.json'),
    JSON.stringify({
      injected: ['m_boot_014'],
      lastTouch,
      lastInject: { m_boot_014: Date.now() },
    }),
  );
}
function touch(rel) {
  appendFileSync(path.join(REPO, rel), `\n// demo touch ${Date.now()}\n`);
}

const qualityPath = path.join(REPO, 'docs/vi/QUALITY.md');
const qualityOriginal = readFileSync(qualityPath, 'utf8');

// timeline: [seconds, action]
const actions = [
  [
    3.0,
    () => {
      stampAgent(['src/viz/live.ts', 'src/viz/html.ts', 'src/viz/replay.ts']);
      touch('src/viz/live.ts');
    },
  ],
  [5.0, () => touch('src/viz/html.ts')],
  [
    8.5,
    () =>
      writeFileSync(
        path.join(REPO, 'src/viz/replay.ts'),
        'export function replaySession(frames: string[]): number {\n  return frames.length;\n}\n',
      ),
  ],
  [13.5, () => appendFileSync(qualityPath, '\nquy tac vua bi sua ngay tren song\n')],
  [19.0, () => writeFileSync(qualityPath, qualityOriginal)],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'load' }); // NOT networkidle — SSE never idles

// settle physics, then pull the camera back a touch so the whole map breathes
await page.waitForTimeout(2500);
await page.mouse.move(W / 2, H / 2);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(150);
await page.mouse.wheel(0, 120);
await page.waitForTimeout(800);

const frames = [];
const started = Date.now();
const pending = [...actions];
const frameMs = 1000 / FPS;
let nextShot = started;

while (Date.now() - started < TOTAL_S * 1000) {
  const elapsed = (Date.now() - started) / 1000;
  while (pending.length > 0 && pending[0][0] <= elapsed) {
    const [, act] = pending.shift();
    try {
      act();
    } catch (e) {
      console.error('action failed:', e.message);
    }
  }
  if (Date.now() >= nextShot) {
    nextShot += frameMs;
    frames.push(await page.screenshot({ type: 'png' }));
  } else {
    await delay(5);
  }
}
await browser.close();
console.log('frames captured:', frames.length);

// encode gif (2x box-downscale -> 640x360 keeps the README light)
const SCALE = 2;
const OW = W / SCALE;
const OH = H / SCALE;
const gif = GIFEncoder();
for (const buf of frames) {
  const png = PNG.sync.read(buf);
  const small = new Uint8ClampedArray(OW * OH * 4);
  for (let y = 0; y < OH; y++) {
    for (let x = 0; x < OW; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const si = ((y * SCALE + dy) * W + (x * SCALE + dx)) * 4;
          r += png.data[si];
          g += png.data[si + 1];
          b += png.data[si + 2];
        }
      }
      const di = (y * OW + x) * 4;
      const n = SCALE * SCALE;
      small[di] = r / n;
      small[di + 1] = g / n;
      small[di + 2] = b / n;
      small[di + 3] = 255;
    }
  }
  const palette = quantize(small, 256);
  gif.writeFrame(applyPalette(small, palette), OW, OH, { palette, delay: Math.round(1000 / FPS) });
}
gif.finish();
writeFileSync(OUT, gif.bytes());
console.log('gif written:', OUT, Math.round(gif.bytes().length / 1024), 'KB');
