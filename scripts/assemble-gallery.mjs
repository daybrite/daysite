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
//         A site that publishes more than one build channel (src/lib/channels.ts) runs this
//         once per channel, with `prefix` moving both the served images and the published
//         index under that channel's segment: the release channel keeps `gallery/`, the
//         development channel gets `main/gallery/`, and each channel's manifest names its
//         own copies.
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

/** The index to serve at `<host>/gallery/gallery.json`, rebuilt from the captures actually
 *  written under `public/gallery/`. Every list is the source index's, filtered to what survived —
 *  so the order and the metadata are the CLI's, and every URL in it resolves.
 *
 *  This is the invariant that keeps the published index honest: it is derived from the copy loop
 *  rather than copied alongside it, so no future change to what gets published can leave the two
 *  describing different sets. */
function republish(index, published) {
  const shotIds = new Set(published.map((e) => e.shot));
  const targets = new Set(published.map((e) => e.platform));
  const keep = (list, has) => (list ?? []).filter(has);
  return {
    ...index,
    // Themes and locales are re-derived rather than filtered by name: either may be null on a
    // capture (an app that varies neither), and the index spells them as it resolved them.
    themes: keep(index.themes, (t) => published.some((e) => e.theme === t)),
    locales: keep(index.locales, (l) => published.some((e) => e.locale === l)),
    platforms: keep(index.platforms, (p) => targets.has(p)),
    shots: keep(index.shots, (s) => shotIds.has(s.id)),
    screenshots: published,
  };
}

/** Build the manifest from `day screenshot index`'s gallery.json: copy each described image
 *  and shape the page's shot-major view.
 *
 *  Two audiences, two rules, and they are deliberately not the same rule:
 *
 *  - The PAGE is curated. Shots with a title are the curated set; when any exist, only they get
 *    a row (`title:` is how a dayscript says "this screen is worth showing").
 *  - The SITE publishes every capture the index describes, curated or not, because the index is
 *    what other sites read — daybrite.dev builds its Day Showcase gallery from this one — and an
 *    entry naming bytes nobody uploaded is worse than no entry at all.
 *
 *  Publishing used to follow the page's rule, so 679 of the Showcase's 2,624 indexed URLs (every
 *  untitled shot) 404'd on the sites that resolved them. Hence also the third rule below: the
 *  republished index is REBUILT from the copy loop's own record rather than passed through, so it
 *  cannot describe a file this run did not write — whatever the reason it went missing. */
function fromIndex(index, shotsDir, outImages, prefix, log) {
  const curated = index.shots.some((s) => s.title);
  const shown = index.shots.filter((s) => !curated || s.title);
  const shownIds = new Set(shown.map((s) => s.id));
  const byShot = new Map(shown.map((s) => [s.id, {}]));
  const columns = [];
  /** The entries whose bytes this run actually wrote — the republished index's only source. */
  const published = [];
  const missing = [];
  for (const e of index.screenshots) {
    // A capture taken on a named device carries an extra path level, and becomes its own
    // COLUMN — `ios-uikit/ipad` beside `ios-uikit/iphone` — so one screenshot row can show two
    // form factors side by side. Without a device the column id is the bare target, which is
    // what every project that does not use device profiles keeps producing.
    const rel = e.device ? `${e.platform}/${e.device}` : e.platform;
    const src = join(shotsDir, ...rel.split('/'), e.variant, e.file);
    if (!existsSync(src)) {
      missing.push(`${rel}/${e.variant}/${e.file}`);
      continue;
    }
    mkdirSync(join(outImages, ...rel.split('/'), e.variant), { recursive: true });
    copyFileSync(src, join(outImages, ...rel.split('/'), e.variant, e.file));
    // Republished pointing at this run's copies. `day screenshot index` knows nothing of build
    // channels: it spells every path `gallery/…` and every URL from site.toml's host. For the
    // channel that owns the root that is right; for a second one, served from `main/gallery/`,
    // it linked the root channel's images instead — which 404 wherever that channel captured
    // nothing, and that is how daybrite.dev lost four apps' galleries.
    const path = `${prefix}${rel}/${e.variant}/${e.file}`;
    const url =
      typeof e.url === 'string' && typeof e.path === 'string' && e.url.endsWith(e.path)
        ? e.url.slice(0, e.url.length - e.path.length) + path
        : e.url;
    published.push({ ...e, path, url });
    // From here on it is the page's turn, and the page shows the curated set only.
    if (!shownIds.has(e.shot)) continue;
    if (!columns.includes(rel)) columns.push(rel);
    // Keyed by the variant directory (the served path), with the theme and locale the index
    // resolved for the capture carried as fields: a reader selects on those and never decodes
    // the directory name.
    const plat = (byShot.get(e.shot)[rel] ??= {});
    plat[e.variant] = {
      src: `${prefix}${rel}/${e.variant}/${e.file}`,
      width: e.width ?? undefined,
      height: e.height ?? undefined,
      theme: e.theme ?? undefined,
      locale: e.locale ?? undefined,
    };
  }
  // An index entry with no file behind it means a capture that never arrived — an artifact that
  // failed to upload, a trimmed download. It is dropped from the published index rather than
  // shipped as a dead URL, and named here so the run that lost it says so.
  if (missing.length) {
    log(`${missing.length} indexed capture(s) had no file and were left out: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}`);
  }
  // Theme/locale vocabularies re-derived from the captures actually copied, from the fields
  // the index resolved (an older index without them falls back to the variant name), in the
  // spelling the switchers use ('default' for a capture that has neither).
  const themes = new Set();
  const locales = new Set();
  for (const caps of byShot.values()) {
    for (const variants of Object.values(caps)) {
      for (const [v, cap] of Object.entries(variants)) {
        const parsed = parseVariant(v);
        themes.add(cap.theme ?? parsed.theme);
        locales.add(cap.locale ?? parsed.locale);
      }
    }
  }
  if (curated) {
    log(
      `curated: ${shown.length} of ${index.shots.length} shot(s) are titled and get a row; ` +
        `every capture is published and indexed either way`,
    );
  }
  return {
    copied: published.length,
    index: republish(index, published),
    manifest: {
      // The listings `day screenshot index` resolved from store/storefront.toml [screenshots]: per
      // target, `default` is the list its landing page shows, `stores` what each store's
      // listing shows per device kind. Passed through as the CLI wrote them; the landing
      // carousel reads `default`, the gallery page shows everything regardless.
      ...(index.listings ? { listings: index.listings } : {}),
      themes: [...themes].sort((a, b) => (a === 'light' ? -1 : b === 'light' ? 1 : a.localeCompare(b))),
      locales: [...locales].sort((a, b) => (a === 'default' ? -1 : b === 'default' ? 1 : a.localeCompare(b))),
      // Column order: the index's target order, each target followed by its own devices in
      // first-seen order. A target with no device captures contributes exactly itself, so a
      // project without device profiles gets the list it always got.
      platforms: (index.platforms ?? []).flatMap((t) =>
        columns.includes(t)
          ? [t, ...columns.filter((c) => c.startsWith(`${t}/`))]
          : columns.filter((c) => c === t || c.startsWith(`${t}/`)),
      ),
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

/** Every `[columnId, dir, variantName]` under a target directory. A child holding only
 *  directories is a DEVICE level (`ios-uikit/ipad/dark/`), giving column `ios-uikit/ipad`; one
 *  holding files is a plain variant, giving column `ios-uikit`. */
function variantDirs(tDir, target) {
  const dirsIn = (p) =>
    readdirSync(p)
      .filter((n) => statSync(join(p, n)).isDirectory())
      .sort();
  const out = [];
  for (const name of readdirSync(tDir).sort()) {
    const child = join(tDir, name);
    if (!statSync(child).isDirectory()) continue;
    const entries = readdirSync(child);
    const onlyDirs =
      entries.length > 0 && entries.every((n) => statSync(join(child, n)).isDirectory());
    if (onlyDirs) {
      for (const v of dirsIn(child)) out.push([`${target}/${name}`, join(child, v), v]);
    } else {
      out.push([target, child, name]);
    }
  }
  return out;
}

/** The no-index fallback (a local preview without the day CLI): scan the trees directly. */
function fromScan(shotsDir, outImages, prefix) {
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
    // A target's children are variant directories, or DEVICE directories that each hold
    // variants. Told apart by CONTENT — a directory holding only directories is a device — for
    // the same reason the day CLI's own scan does: a device slug and a variant name are both
    // free-form, and `ipad` reads exactly like a variant.
    for (const [column, vDir, variant] of variantDirs(join(shotsDir, target), target)) {
      const { theme, locale } = parseVariant(variant);
      for (const file of readdirSync(vDir).sort()) {
        if (!file.toLowerCase().endsWith('.png')) continue;
        const id = file.slice(0, -4);
        const src = `${prefix}${column}/${variant}/${file}`;
        mkdirSync(join(outImages, ...column.split('/'), variant), { recursive: true });
        copyFileSync(join(vDir, file), join(outImages, ...column.split('/'), variant, file));
        copied += 1;
        const entry = shots.get(id) ?? { byPlatform: {} };
        const plat = (entry.byPlatform[column] ??= {});
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

/**
 * @param {string} shotsDir  the capture tree (or the CI artifacts directory)
 * @param {string} siteDir   where the manifest is written, beside site.toml
 * @param {{ quiet?: boolean, outImages?: string, publicDir?: string, prefix?: string,
 *           manifest?: string }} [opts]
 *        `prefix` is the served path every image URL starts with, `gallery/` by default and
 *        `<channel>/gallery/` for a second build channel; `manifest` names the manifest file
 *        relative to `siteDir`. `publicDir` is the served root (the template's `public/`), and
 *        `outImages` overrides the image directory outright; the test suite points either at a
 *        temp dir so it does not clobber a working preview.
 */
export function assembleGallery(shotsDir, siteDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[gallery] ${m}`);
  // Always a single trailing slash and no leading one: it is spliced straight into every `src`.
  const prefix = `${(opts.prefix ?? 'gallery').replace(/^\/+|\/+$/g, '')}/`;
  const outImages =
    opts.outImages ??
    join(opts.publicDir ?? join(TEMPLATE_ROOT, 'public'), ...prefix.split('/').filter(Boolean));
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

  const { copied, manifest, index: republished } = index
    ? fromIndex(index, shotsDir, outImages, prefix, log)
    : fromScan(shotsDir, outImages, prefix);

  // Publish the machine-readable index beside the images it describes — REBUILT from the copy
  // loop (see `republish`), never copied through, so every URL it carries has bytes behind it.
  // Only the day CLI writes a source index (`day screenshot index`); a scanned preview publishes
  // none.
  if (republished && copied > 0) {
    mkdirSync(outImages, { recursive: true });
    writeFileSync(
      join(outImages, 'gallery.json'),
      JSON.stringify(republished, null, 2) + '\n',
    );
  } else if (!index && copied > 0) {
    log('no gallery.json in the capture tree — run `day screenshot index` to publish the machine-readable index');
  }

  const manifestPath = join(siteDir, opts.manifest ?? 'gallery-manifest.json');
  mkdirSync(dirname(manifestPath), { recursive: true });
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
