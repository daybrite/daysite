// The WebP rendition of a published capture: `<shot>.webp` beside `<shot>.png` under
// `public/`, encoded by scripts/webp.mjs when the gallery is assembled. The PNG keeps its
// published URL (the index's readers and the stores take it); `<picture>` offers the WebP
// first (components/ShotPicture.astro).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../../public/', import.meta.url));
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * The WebP's URL for a capture's site-relative URL (`gallery/…`, `main/gallery/…`, with or
 * without the deployment base), or undefined when the build holds none: a remote asset, a
 * store-listing upload, a tree assembled without the WebP pass.
 */
export function webpOf(url: string | undefined): string | undefined {
  if (!url || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return undefined;
  const [path, query] = url.split('?');
  if (!path || !path.toLowerCase().endsWith('.png')) return undefined;
  const rel = path.startsWith(`${BASE}/`) ? path.slice(BASE.length + 1) : path.replace(/^\/+/, '');
  if (rel.split('/').includes('..')) return undefined;
  const webpRel = rel.slice(0, -4) + '.webp';
  if (!existsSync(resolve(PUBLIC, ...webpRel.split('/')))) return undefined;
  return `${path.slice(0, -4)}.webp${query ? `?${query}` : ''}`;
}
