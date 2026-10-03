// What the build made of the gallery's PNG files: every `<picture>` in dist/ pairs a WebP
// source with its PNG fallback, so the pairs say how much a WebP-capable browser downloads
// instead, and the PNG files no page offers a WebP for are listed by name.
// Run after astro build: node scripts/image-report.mjs [dist]
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { parse } from 'parse5';

const root = resolve(process.argv[2] ?? 'dist');
const size = async (file) => stat(join(root, file)).then((s) => s.size, () => undefined);
const pairs = new Map(); // png path → webp path
const pngs = new Set();
for (const entry of await readdir(root, { recursive: true })) {
  if (entry.endsWith('.png') && !entry.split(sep).includes('webapp')) pngs.add(entry.split(sep).join('/'));
  if (!entry.endsWith('.html') || entry.split(sep).includes('webapp')) continue;
  const page = 'https://test.invalid/' + entry.split(sep).join('/');
  const tree = parse(await readFile(join(root, entry), 'utf8'));
  const local = (value) => decodeURIComponent(new URL(value, page).pathname).slice(1);
  (function walk(node) {
    if (node.tagName === 'picture') {
      const source = node.childNodes.find((c) => c.tagName === 'source');
      const img = node.childNodes.find((c) => c.tagName === 'img');
      const webp = source?.attrs.find((a) => a.name === 'srcset')?.value.split(/\s+/)[0];
      const png = img?.attrs.find((a) => a.name === 'src')?.value;
      if (webp && png) pairs.set(local(png), local(webp));
    }
    // The gallery's switcher holds every variant on the image: data-v-<variant> is the PNG,
    // data-w-<variant> its WebP.
    if (node.tagName === 'img') {
      for (const a of node.attrs) {
        if (!a.name.startsWith('data-v-')) continue;
        const webp = node.attrs.find((w) => w.name === `data-w-${a.name.slice(7)}`)?.value;
        if (webp) pairs.set(local(a.value), local(webp));
      }
    }
    for (const child of node.childNodes ?? []) walk(child);
    if (node.content) walk(node.content);
  })(tree);
}

let pngBytes = 0, webpBytes = 0;
const rows = [];
for (const [png, webp] of pairs) {
  const [a, b] = await Promise.all([size(png), size(webp)]);
  if (a === undefined || b === undefined) continue;
  pngBytes += a; webpBytes += b;
  rows.push({ png, webp, a, b });
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`${rows.length} PNG capture(s) offered as WebP: ${mb(pngBytes)} of PNG, ${mb(webpBytes)} of WebP (${(100 * webpBytes / Math.max(pngBytes, 1)).toFixed(0)}%)`);
rows.sort((x, y) => y.a - x.a);
for (const r of rows.slice(0, 5)) console.log(`  ${r.png}: ${mb(r.a)} → ${mb(r.b)}`);
const unconverted = [...pngs].filter((p) => !pairs.has(p)).sort();
const captures = unconverted.filter((p) => /(^|\/)gallery\//.test(p));
const other = unconverted.filter((p) => !/(^|\/)gallery\//.test(p));
console.log(`${captures.length} gallery PNG(s) no page offers as WebP${captures.length ? ':' : ''}`);
for (const p of captures.slice(0, 40)) console.log(`  ${p}`);
if (captures.length > 40) console.log(`  … and ${captures.length - 40} more`);
console.log(`${other.length} other PNG(s) served as PNG (icons, badges)${other.length ? ':' : ''}`);
for (const p of other.slice(0, 20)) console.log(`  ${p}`);
