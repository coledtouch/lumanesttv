import {readFile} from 'node:fs/promises';
import sharp from 'sharp';

const icon = await readFile(new URL('../public/pwa/icon.svg', import.meta.url));
for (const size of [180, 192, 512]) {
  await sharp(icon).resize(size, size).png().toFile(new URL(`../public/pwa/icon-${size}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}
await sharp(Buffer.from(icon.toString().replace('rx="112"', 'rx="0"'))).resize(512, 512).png().toFile(new URL('../public/pwa/icon-maskable-512.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
