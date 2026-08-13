// Assemble the /gallery data from `day launch --script` screenshot output.
//
// Input : a directory of per-target capture trees — either the raw
//         `build/day/screenshots/` of a local run, or a directory the CI workflow filled by
//         downloading every `screenshots-<target>` artifact (same layout either way):
//
//             <in>/<target>/<variant>/<shot>.png
//             <in>/gallery.json            (written by `day screenshot index`)
//
//         The index is the preferred source: the day CLI generates it from the capture trees
//         plus each `screenshot:` step's localized `title:`/`caption:` metadata, and this
//         script just parses it. Without one (a local preview that skipped the CLI), the
//         trees are scanned directly — every capture, alphabetically, labels derived from
//         file names, and no index is published.
//
// Output: images copied into the template's `public/gallery/<target>/<variant>/<shot>.png`,
//         the index republished verbatim at `public/gallery/gallery.json` (so the site
//         serves it at `<host>/gallery/gallery.json` — the machine-readable form other
//         sites reference, the way daybrite.dev references the Day Showcase's), and a
//         `gallery-manifest.json` written next to site.toml — the same split as the
//         appindex: generated data beside the config, generated assets where they serve
//         from.
//
// Usage : node scripts/assemble-gallery.mjs <screenshots-dir> [site-toml-dir]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Day target ids that may appear as capture directories but are development stand-ins
// (macos-gtk exercises linux-gtk's toolkit) or tool droppings — not publication targets.
const SKIP_DIRS = new Set(['_drive', 'macos-gtk', 'macos-qt', 'windows-gtk', 'windows-qt', 'android-widget']);

const THEMES = new Set(['light', 'dark']);

/** `light-fr` → {theme:'light', locale:'fr'}; `fr` → {locale:'fr'}; `default` → both defaults. */
function parseVariant(name) {
  if (name === 'default') return { theme: 'default', locale: 'default' };
  const [head, ...rest] = name.split('-');
  if (THEMES.has(head)) {
    return { theme: head, locale: rest.length ? rest.join('-') : 'default' };
  }
  return { theme: 'default', locale: name };
}

/** Width/height straight out of the PNG IHDR — no image library for 8 fixed bytes. */
function pngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* IHDR */) return {};
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Build the manifest from `day screenshot index`'s gallery.json: copy each described image
 *  and shape the page's shot-major view. Shots WITH a title are the curated set — when any
 *  exist, only they render (the untitled extras stay machine-readable in the index). */
function fromIndex(index, shotsDir, outImages, log) {
  const curated = index.shots.some((s) => s.title);
  const shown = index.shots.filter((s) => !curated || s.title);
  const shownIds = new Set(shown.map((s) => s.id));
  const byShot = new Map(shown.map((s) => [s.id, {}]));
  let copied = 0;
  for (const e of index.screenshots) {
    if (!shownIds.has(e.shot)) continue;
    const src = join(shotsDir, e.platform, e.variant, e.file);
    if (!existsSync(src)) continue;
    mkdirSync(join(outImages, e.platform, e.variant), { recursive: true });
    copyFileSync(src, join(outImages, e.platform, e.variant, e.file));
    copied += 1;
    const plat = (byShot.get(e.shot)[e.platform] ??= {});
    plat[e.variant] = {
      src: `gallery/${e.platform}/${e.variant}/${e.file}`,
      width: e.width ?? undefined,
      height: e.height ?? undefined,
    };
  }
  // Theme/locale vocabularies re-derived from the variants actually copied, in the same
  // spelling the switchers use ('default' included) rather than the index's resolved tags.
  const themes = new Set();
  const locales = new Set();
  for (const caps of byShot.values()) {
    for (const variants of Object.values(caps)) {
      for (const v of Object.keys(variants)) {
        const { theme, locale } = parseVariant(v);
        themes.add(theme);
        locales.add(locale);
      }
    }
  }
  if (curated) log(`curated: ${shown.length} titled shot(s) of ${index.shots.length} in the index`);
  return {
    copied,
    manifest: {
      themes: [...themes].sort((a, b) => (a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b))),
      locales: [...locales].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))),
      platforms: index.platforms,
      shots: shown
        .map((s) => ({
          id: s.id,
          ...(s.title ? { title: s.title } : {}),
          ...(s.caption ? { caption: s.caption } : {}),
          ...(s.source ? { source: s.source } : {}),
          byPlatform: byShot.get(s.id),
        }))
        .filter((s) => Object.keys(s.byPlatform).length > 0),
    },
  };
}

/** The no-index fallback (a local preview without the day CLI): scan the trees directly. */
function fromScan(shotsDir, outImages) {
  const targets = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((t) => {
        if (SKIP_DIRS.has(t)) return false;
        return statSync(join(shotsDir, t)).isDirectory();
      })
    : [];
  const themes = new Set();
  const locales = new Set();
  const shots = new Map();
  let copied = 0;
  for (const target of targets.sort()) {
    const tDir = join(shotsDir, target);
    for (const variant of readdirSync(tDir).sort()) {
      const vDir = join(tDir, variant);
      if (!statSync(vDir).isDirectory()) continue;
      const { theme, locale } = parseVariant(variant);
      for (const file of readdirSync(vDir).sort()) {
        if (!file.toLowerCase().endsWith('.png')) continue;
        const id = file.slice(0, -4);
        const src = `gallery/${target}/${variant}/${file}`;
        mkdirSync(join(outImages, target, variant), { recursive: true });
        copyFileSync(join(vDir, file), join(outImages, target, variant, file));
        copied += 1;
        const entry = shots.get(id) ?? { byPlatform: {} };
        const plat = (entry.byPlatform[target] ??= {});
        plat[variant] = { src, ...pngSize(join(vDir, file)) };
        shots.set(id, entry);
        themes.add(theme);
        locales.add(locale);
      }
    }
  }
  return {
    copied,
    manifest: {
      themes: [...themes].sort((a, b) => (a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b))),
      locales: [...locales].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))),
      shots: [...shots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, s]) => ({ id, byPlatform: s.byPlatform })),
    },
  };
}

export function assembleGallery(shotsDir, siteDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[gallery] ${m}`);
  const outImages = join(TEMPLATE_ROOT, 'public', 'gallery');
  rmSync(outImages, { recursive: true, force: true });

  const indexPath = join(shotsDir, 'gallery.json');
  let index = null;
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
      if (Array.isArray(parsed.screenshots) && Array.isArray(parsed.shots)) index = parsed;
    } catch {
      log(`unreadable ${indexPath} — falling back to a directory scan`);
    }
  }

  const { copied, manifest } = index
    ? fromIndex(index, shotsDir, outImages, log)
    : fromScan(shotsDir, outImages);

  // Republish the machine-readable index beside the images it describes. Only the day CLI
  // writes one (`day screenshot index`); a scanned preview publishes none.
  if (index && copied > 0) {
    mkdirSync(outImages, { recursive: true });
    copyFileSync(indexPath, join(outImages, 'gallery.json'));
  } else if (!index && copied > 0) {
    log('no gallery.json in the capture tree — run `day screenshot index` to publish the machine-readable index');
  }

  const manifestPath = join(siteDir, 'gallery-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  log(
    manifest.shots.length > 0
      ? `${manifest.shots.length} screen(s), ${copied} capture(s) → ${manifestPath}${index ? ' + gallery.json' : ''}`
      : 'no screenshots found — wrote an empty manifest (the gallery page will be skipped)',
  );
  return manifest;
}

// Standalone entry point.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [shotsDir, siteDir] = process.argv.slice(2);
  if (!shotsDir) {
    console.error('usage: assemble-gallery.mjs <screenshots-dir> [site-toml-dir]');
    process.exit(2);
  }
  assembleGallery(resolve(shotsDir), resolve(siteDir ?? join(TEMPLATE_ROOT, 'samples')));
}
