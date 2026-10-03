// The WebP renditions of the published captures. Each capture stays the PNG file at its
// published URL under `public/` (the index's readers and browsers without WebP take it), and
// Astro's image service encodes a WebP beside it in `_astro/`, which `<picture>` offers first
// (components/ShotPicture.astro).
//
// The service is handed a record of the PNG rather than an import: an imported image is emitted
// into `_astro/` as well, which would publish every capture twice. The record's `src` is the
// file's path in the built site, which is where the service reads it from once `public/` has
// been copied there.
import { getImage } from 'astro:assets';
import { existsSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/** Lossy WebP at this quality keeps UI text crisp at about a third of the PNG's size. */
export const WEBP_QUALITY = 80;

export interface WebImage {
  src: string;
  width: number;
  height: number;
}

/** Width and height straight out of the PNG header; no image library for 8 fixed bytes. */
function pngSize(file: string): { width: number; height: number } | undefined {
  const head = Buffer.alloc(24);
  const fd = openSync(file, 'r');
  try {
    if (readSync(fd, head, 0, 24, 0) < 24) return undefined;
  } finally {
    closeSync(fd);
  }
  if (head.toString('latin1', 12, 16) !== 'IHDR') return undefined;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

const renditions = new Map<string, Promise<WebImage | undefined>>();

/**
 * The WebP rendition of a capture, by its site-relative URL (`gallery/…`, `main/gallery/…`,
 * with or without the deployment base). Undefined for an image this build does not hold: a
 * remote asset, a store-listing upload, anything that is not a PNG under `public/`.
 */
export function webpOf(url: string | undefined): Promise<WebImage | undefined> {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return Promise.resolve(undefined);
  const rel = (url.startsWith(`${BASE}/`) ? url.slice(BASE.length + 1) : url.replace(/^\/+/, ''))
    .split('?')[0]!;
  let pending = renditions.get(rel);
  if (!pending) {
    pending = encode(rel);
    renditions.set(rel, pending);
  }
  return pending;
}

async function encode(rel: string): Promise<WebImage | undefined> {
  if (!rel.toLowerCase().endsWith('.png') || rel.split('/').includes('..')) return undefined;
  const fsPath = resolve(PUBLIC, ...rel.split('/'));
  if (!existsSync(fsPath)) return undefined;
  const size = pngSize(fsPath);
  if (!size) return undefined;
  const image = await getImage({
    // No `fsPath`: with one, the build treats the PNG as an import's original and deletes it
    // from the site once the WebP exists, and the PNG is the published file.
    src: { src: `/${rel}`, ...size, format: 'png' },
    format: 'webp',
    quality: WEBP_QUALITY,
  });
  return { src: image.src, ...size };
}
