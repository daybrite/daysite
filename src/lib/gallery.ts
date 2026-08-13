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
  /** Curated row heading (site.toml `[gallery]`); absent, the label derives from the id. */
  title?: string;
  /** Path of the code the screen renders from, relative to the app repository. */
  source?: string;
  /** Day target id → variant name → capture. */
  byPlatform: Record<string, Record<string, GalleryCapture>>;
}

export interface GalleryManifest {
  themes: string[];
  locales: string[];
  /** Curated column order (site.toml `[gallery] platforms`); absent, the page picks its own. */
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
