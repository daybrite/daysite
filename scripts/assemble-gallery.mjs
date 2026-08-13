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
// Output: images copied into the template's `public/gallery/<target>/<variant>/<shot>.png`,
//         a `gallery-manifest.json` written next to site.toml (the same split as the
//         appindex: generated data beside the config, generated assets where they serve from),
//         and `public/gallery/gallery.json` — the machine-readable index of every published
//         screenshot, served at `<host>/gallery/gallery.json`. Each entry carries the file
//         name, published URL, shot id and title, platform-toolkit, theme, locale, pixel
//         dimensions, byte size, and sha-256, so another site (or any tool) can reference the
//         screenshots without scraping the pages. daybrite.dev consumes the Showcase's copy to
//         build its own gallery from these hosted images.
//
// Curation (optional): a `[gallery]` table in site.toml selects, orders, and titles what the
// gallery shows — without it, every capture appears, alphabetically, labeled from its file
// name. Shots the curation lists but no capture matches are reported, not silently dropped.
//
//     [gallery]
//     platforms = ["ios-uikit", "macos-appkit"]   # column order; unlisted targets are hidden
//     [[gallery.shots]]
//     id = "home"                # the capture's file name, without .png
//     title = "Home"             # the row heading (otherwise derived from the id)
//     source = "src/lib.rs"      # optional: the code the screen renders from, in the app repo
//
// Usage : node scripts/assemble-gallery.mjs <screenshots-dir> [site-toml-dir]

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

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
function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(12) !== 0x49484452 /* IHDR */) return {};
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** `san-francisco-fahrenheit` → `San Francisco Fahrenheit` (mirrors src/lib/gallery.ts). */
function shotLabel(id) {
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// A variant segment that reads as a language tag (`fr`, `zh-CN`). Variant names are data and
// anything may appear (a local capture run leaves `ipad` or `landscape` behind); the manifest
// keeps them all, but gallery.json only CLAIMS a locale for one shaped like a locale.
const LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

/** site.toml, for the published host (absolute URLs), the locale list, and `[gallery]`.
 *  Absent or unparsable is fine — the index just carries no absolute URLs or curation. */
function readSiteToml(siteDir) {
  try {
    return parseToml(readFileSync(join(siteDir, 'site.toml'), 'utf8'));
  } catch {
    return {};
  }
}

export function assembleGallery(shotsDir, siteDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[gallery] ${m}`);
  const outImages = join(TEMPLATE_ROOT, 'public', 'gallery');
  rmSync(outImages, { recursive: true, force: true });

  const site = readSiteToml(siteDir);
  const curation = site.gallery ?? {};
  const curatedShots = Array.isArray(curation.shots) ? curation.shots.filter((s) => s?.id) : [];
  const curatedPlatforms = Array.isArray(curation.platforms) ? curation.platforms : [];
  const titleOf = new Map(curatedShots.map((s) => [s.id, s.title]));
  const sourceOf = new Map(curatedShots.map((s) => [s.id, s.source]));
  // The locale a bare `light`/`dark`/`default` capture is in: the app's first declared locale —
  // the same aliasing the appindex generator applies when it feeds the store carousels.
  const defaultLocale = Array.isArray(site.locales) ? (site.locales[0] ?? null) : null;
  // `host` may carry a base path (a github.io project page); split it into origin + base so
  // published URLs come out right either way.
  let origin = null;
  let basePath = '';
  try {
    const u = new URL(site.host);
    origin = u.origin;
    basePath = u.pathname.replace(/\/$/, '');
  } catch {
    /* no host — the index carries paths only */
  }

  let targets = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((t) => {
        if (SKIP_DIRS.has(t)) return false;
        return statSync(join(shotsDir, t)).isDirectory();
      })
    : [];
  // Curated platforms are the column set AND order; anything unlisted is deliberately hidden.
  if (curatedPlatforms.length) {
    targets = curatedPlatforms.filter((t) => targets.includes(t));
  } else {
    targets = targets.sort();
  }

  const themes = new Set();
  const locales = new Set();
  const shots = new Map(); // shot id -> { byPlatform: { target: { variant: {src,width,height} } } }
  const index = []; // one flat entry per published capture (gallery.json)

  for (const target of targets) {
    const tDir = join(shotsDir, target);
    // `<os>-<toolkit>` by construction (ios-uikit, harmony-arkui, web-dom).
    const [os, ...tk] = target.split('-');
    const toolkit = tk.join('-');
    for (const variant of readdirSync(tDir).sort()) {
      const vDir = join(tDir, variant);
      if (!statSync(vDir).isDirectory()) continue;
      const { theme, locale } = parseVariant(variant);
      for (const file of readdirSync(vDir).sort()) {
        if (!file.toLowerCase().endsWith('.png')) continue;
        const id = file.slice(0, -4);
        if (curatedShots.length && !titleOf.has(id)) continue; // curated out, stays in the artifact
        const src = `gallery/${target}/${variant}/${file}`;
        const buf = readFileSync(join(vDir, file));
        mkdirSync(join(outImages, target, variant), { recursive: true });
        writeFileSync(join(outImages, target, variant, file), buf);
        const size = pngSize(buf);
        const entry = shots.get(id) ?? { byPlatform: {} };
        const plat = (entry.byPlatform[target] ??= {});
        plat[variant] = { src, ...size };
        shots.set(id, entry);
        themes.add(theme);
        locales.add(locale);
        index.push({
          file,
          path: src,
          url: origin ? `${origin}${basePath}/${src}` : null,
          shot: id,
          title: titleOf.get(id) ?? shotLabel(id),
          platform: target,
          os,
          toolkit,
          variant,
          theme: theme === 'default' ? null : theme,
          locale: locale === 'default' ? defaultLocale : LOCALE_RE.test(locale) ? locale : null,
          width: size.width ?? null,
          height: size.height ?? null,
          bytes: buf.length,
          sha256: createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  }

  // Row order: the curation's, else alphabetical. A curated shot nothing captured is a broken
  // walkthrough step (or a typo here) — name it in the log rather than shrinking the page quietly.
  const shotOrder = curatedShots.length
    ? curatedShots.map((s) => s.id).filter((id) => shots.has(id))
    : [...shots.keys()].sort((a, b) => a.localeCompare(b));
  const missing = curatedShots.map((s) => s.id).filter((id) => !shots.has(id));
  if (missing.length && shots.size > 0) {
    log(`curated shot(s) with no capture: ${missing.join(', ')}`);
  }
  const rank = new Map(shotOrder.map((id, i) => [id, i]));
  index.sort(
    (a, b) =>
      rank.get(a.shot) - rank.get(b.shot) ||
      targets.indexOf(a.platform) - targets.indexOf(b.platform) ||
      a.variant.localeCompare(b.variant),
  );

  const manifest = {
    themes: [...themes].sort((a, b) => (a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b))),
    locales: [...locales].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))),
    // Column order for the page — present only when the curation pinned one.
    ...(curatedPlatforms.length ? { platforms: targets } : {}),
    shots: shotOrder.map((id) => ({
      id,
      ...(titleOf.get(id) ? { title: titleOf.get(id) } : {}),
      ...(sourceOf.get(id) ? { source: sourceOf.get(id) } : {}),
      byPlatform: shots.get(id).byPlatform,
    })),
  };
  const manifestPath = join(siteDir, 'gallery-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  // The published machine-readable index, beside the images it describes. Written only when
  // there are captures: an empty gallery generates no /gallery pages, so it publishes no index.
  if (index.length > 0) {
    mkdirSync(outImages, { recursive: true });
    const galleryJson = {
      generator: 'daysite/assemble-gallery',
      generated: new Date().toISOString(),
      site: origin ? `${origin}${basePath}` : null,
      themes: manifest.themes.filter((t) => t !== 'default'),
      locales: [
        ...new Set(
          manifest.locales
            .map((l) => (l === 'default' ? defaultLocale : LOCALE_RE.test(l) ? l : null))
            .filter(Boolean),
        ),
      ],
      platforms: targets,
      shots: manifest.shots.map(({ id, title, source }) => ({
        id,
        title: title ?? shotLabel(id),
        ...(source ? { source } : {}),
      })),
      screenshots: index,
    };
    writeFileSync(join(outImages, 'gallery.json'), JSON.stringify(galleryJson, null, 2) + '\n');
  }

  const total = index.length;
  log(
    manifest.shots.length > 0
      ? `${manifest.shots.length} screen(s) × ${targets.length} target(s), ${total} capture(s) → ${manifestPath} + gallery.json`
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
