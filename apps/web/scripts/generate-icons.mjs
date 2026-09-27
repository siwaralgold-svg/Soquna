// Regenerates the PWA icons from scripts/icon.svg. Run after changing the SVG:
//   pnpm --filter @souqna/web icons
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync(new URL('./icon.svg', import.meta.url));
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url).pathname;
mkdirSync(out(''), { recursive: true });

for (const size of [192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(out(`icon-${size}.png`));
}

// Maskable icons need the artwork inside the central 80% "safe zone".
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#137e5d' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png({ compressionLevel: 9 })
  .toFile(out('maskable-512.png'));

await sharp(svg).resize(180, 180).png({ compressionLevel: 9 }).toFile(out('apple-touch-icon.png'));
console.log('Icons written to public/icons/');
