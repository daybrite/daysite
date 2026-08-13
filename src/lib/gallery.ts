// Loader for gallery-manifest.json (written by scripts/assemble-gallery.mjs next to site.toml).
// Absent or empty, the /gallery routes are simply not generated — a site without captures has
// no dead link and no empty page.
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface GalleryCapture {
  src: string;
  width?: number;
  height?: number;
}

export interface GalleryShot {
  id: string;
  /** Localized row heading, keyed by locale tag — the dayscript `screenshot:` step's
   *  `title:` metadata, carried through `day screenshot index`. Absent, the label derives
   *  from the id. */
  title?: Record<string, string>;
  /** Localized caption, same shape and source as `title`. */
  caption?: Record<string, string>;
  /** Path of the code the screen renders from, relative to the app repository. */
  source?: string;
  /** Day target id → variant name → capture. */
  byPlatform: Record<string, Record<string, GalleryCapture>>;
}

export interface GalleryManifest {
  themes: string[];
  locales: string[];
  /** Column order from the index (`day screenshot index`); absent, the page picks its own. */
  platforms?: string[];
  shots: GalleryShot[];
}

export async function loadGallery(siteInfoFile: string): Promise<GalleryManifest | undefined> {
  const path = join(dirname(siteInfoFile), 'gallery-manifest.json');
  if (!existsSync(path)) return undefined;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as GalleryManifest;
  return parsed.shots?.length ? parsed : undefined;
}

/** `san-francisco-fahrenheit` → `San Francisco Fahrenheit` — the shot's display label. */
export function shotLabel(id: string): string {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Resolve a locale-keyed text for `locale`: the exact tag, then any tag with the same
 *  primary language (`fr` ↔ `fr-FR`), then English, then anything — the same ladder the day
 *  CLI's own resolution uses, so a page and its published index can never disagree. */
export function localizedText(
  text: Record<string, string> | undefined,
  locale: string,
): string | undefined {
  if (!text) return undefined;
  if (text[locale] !== undefined) return text[locale];
  const lang = (t: string) => t.split(/[-_]/)[0].toLowerCase();
  const near = Object.keys(text).find((k) => lang(k) === lang(locale));
  if (near) return text[near];
  const en = Object.keys(text).find((k) => lang(k) === 'en');
  if (en) return text[en];
  return Object.values(text)[0];
}
