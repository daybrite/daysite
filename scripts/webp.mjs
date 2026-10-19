// WebP renditions of a capture tree's PNG files, one `<shot>.webp` beside each `<shot>.png`,
// encoded with sharp (lossy, quality 80: UI text stays crisp at about a third of the PNG's
// size). components/ShotPicture.astro offers the WebP first and the PNG as the fallback, so the
// PNG keeps its published URL and the WebP has the same name beside it.
//
// A capture sharp cannot read (a frame corrupted on its way off a device) gets no WebP and is
// reported by name, rather than stopping the site build: the page shows its PNG, as it does for
// any capture without a WebP, and the other captures publish as usual.
import { readdir, stat } from 'node:fs/promises';
import { cpus } from 'node:os';
import { relative, resolve, sep } from 'node:path';

export const WEBP_QUALITY = 80;

/**
 * Encode every `.png` under `dir` that has no `.webp` beside it yet. Returns the count made,
 * the two totals in bytes, and the PNGs that could not be read (paths relative to `dir`, each
 * with sharp's reason), which are left without a WebP.
 */
export async function webpTree(dir, { quality = WEBP_QUALITY, concurrency = cpus().length } = {}) {
  const sharp = (await import('sharp')).default;
  const root = resolve(dir);
  const result = { made: 0, png: 0, webp: 0, unreadable: [] };
  // A channel with no captures assembles no tree at all (a release without a bundle yet).
  if (!(await stat(root).then((s) => s.isDirectory(), () => false))) return result;
  const pngs = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
      pngs.push(resolve(entry.parentPath, entry.name));
    }
  }
  const queue = pngs.slice();
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let png = queue.shift(); png; png = queue.shift()) {
      const webp = png.slice(0, -4) + '.webp';
      const exists = await stat(webp).then(() => true, () => false);
      if (!exists) {
        try {
          await sharp(png).webp({ quality }).toFile(webp);
        } catch (e) {
          const file = relative(root, png).split(sep).join('/');
          result.unreadable.push({ file, reason: e.message });
          // A GitHub annotation on CI, a plain line elsewhere: the run stays green and says which
          // capture to look at.
          console.warn(`::warning::${file}: not a readable PNG (${e.message}); it is published without a WebP`);
          continue;
        }
        result.made++;
      }
      // Read both sizes before adding: `total += await …` reads the total first, and the
      // other workers' additions in the meantime would be lost.
      const [pngSize, webpSize] = await Promise.all([stat(png), stat(webp)]);
      result.png += pngSize.size;
      result.webp += webpSize.size;
    }
  }));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/webp.mjs <capture tree>');
    process.exit(2);
  }
  const r = await webpTree(dir);
  const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
  console.log(`[webp] ${r.made} file(s) encoded under ${dir.split(sep).join('/')}: ${mb(r.png)} of PNG, ${mb(r.webp)} of WebP`);
  if (r.unreadable.length) console.log(`[webp] ${r.unreadable.length} unreadable PNG(s) left without a WebP`);
}
