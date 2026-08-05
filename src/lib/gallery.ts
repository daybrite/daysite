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
  /** Day target id → variant name → capture. */
  byPlatform: Record<string, Record<string, GalleryCapture>>;
}

export interface GalleryManifest {
  themes: string[];
  locales: string[];
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
