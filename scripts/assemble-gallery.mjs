// Assemble the /gallery data from `day launch --script` screenshot output.
//
// Input : a directory of per-target capture trees — either the raw
//         `build/day/screenshots/` of a local run, or a directory the CI workflow filled by
//         downloading every `screenshots-<target>` artifact (same layout either way):
//
//             <in>/<target>/<variant>/<shot>.png
//
//         Variant names follow day's capture matrix (cli.rs `capture_matrix`): locales alone
//         produce `en`, `fr`, …; themes × locales produce `light`, `dark-fr`, …; a bare run
//         produces `default`. Treated as data, not re-derived: the union of what is present
//         drives the gallery's switchers.
//
// Output: images copied into the template's `public/gallery/<target>/<variant>/<shot>.png`
//         and a `gallery-manifest.json` written next to site.toml — the same split as the
//         appindex: generated data beside the config, generated assets where they serve from.
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

export function assembleGallery(shotsDir, siteDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[gallery] ${m}`);
  const outImages = join(TEMPLATE_ROOT, 'public', 'gallery');
  rmSync(outImages, { recursive: true, force: true });

  const targets = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((t) => {
        if (SKIP_DIRS.has(t)) return false;
        return statSync(join(shotsDir, t)).isDirectory();
      })
    : [];

  const themes = new Set();
  const locales = new Set();
  const shots = new Map(); // shot id -> { byPlatform: { target: { variant: {src,width,height} } } }

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
        const entry = shots.get(id) ?? { byPlatform: {} };
        const plat = (entry.byPlatform[target] ??= {});
        plat[variant] = { src, ...pngSize(join(vDir, file)) };
        shots.set(id, entry);
        themes.add(theme);
        locales.add(locale);
      }
    }
  }

  const manifest = {
    themes: [...themes].sort((a, b) => (a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b))),
    locales: [...locales].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))),
    shots: [...shots.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, s]) => ({ id, byPlatform: s.byPlatform })),
  };
  const manifestPath = join(siteDir, 'gallery-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  const total = manifest.shots.reduce(
    (n, s) => n + Object.values(s.byPlatform).reduce((m, v) => m + Object.keys(v).length, 0),
    0,
  );
  log(
    manifest.shots.length > 0
      ? `${manifest.shots.length} screen(s) × ${targets.length} target(s), ${total} capture(s) → ${manifestPath}`
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
