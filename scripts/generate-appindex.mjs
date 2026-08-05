// Synthesize appindex.json for a conventional Day project.
//
// The App Fair publication document (https://appfair.org/schemas/appindex/) normally comes from
// a store-release pipeline; a Day repository already CONTAINS everything it records, so this
// script derives it instead of asking anyone to maintain a second copy:
//
//   Day.toml                → app id, title, target list
//   store/app.toml          → bundle id, copyright, contact
//   store/<locale>/*.txt    → localized name, subtitle, description, keywords, release notes,
//                             privacy/support/marketing URLs (the store-submission texts)
//   releases/latest (API)   → per-target download artifacts at their stable
//                             /releases/latest/download/ URLs (absent offline — the site then
//                             renders without download cards, the same degradation the
//                             daybrite.dev showcase page uses)
//   resource/icons/         → app icon, copied into the site's public/ tree
//
// `platforms` uses the schema's conventional `ios`/`android` keys for those two targets and
// Day's additive keys (macos, windows, linux-gtk, linux-qt, harmony, web) for the rest — an
// App Fair consumer reads the subset it understands, daysite reads all of it.
//
// Usage: node scripts/generate-appindex.mjs <project-root> <out-dir> [--repo owner/name]
//        <out-dir> is the directory holding site.toml; appindex.json lands beside it.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseTOML } from 'smol-toml';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Day target id → appindex platforms key. `ios`/`android` are the App Fair schema's
// conventional names; the rest are Day's extension (mirrors src/lib/day-targets.ts).
const TARGET_KEYS = {
  'ios-uikit': 'ios',
  'android-mdc': 'android',
  'macos-appkit': 'macos',
  'windows-xaml': 'windows',
  'linux-gtk': 'linux-gtk',
  'linux-qt': 'linux-qt',
  'harmony-arkui': 'harmony',
  'web-dom': 'web',
};

// Which release-asset name belongs to which target. build-day-app packs with
// `--no-version-in-name`, so assets look like `<name>-<target>[-arch][.ext]` — match on the
// target id in the file name, which every Day release asset carries.
function assetTarget(name) {
  // Not everything on a release is installable: screenshot zips and the checksum manifest ride
  // along for the gallery and for verification, not for the download card.
  if (name.startsWith('screenshots-') || name === 'SHA256SUMS' || name.endsWith('.buildinfo')) {
    return undefined;
  }
  for (const target of Object.keys(TARGET_KEYS)) {
    if (name.includes(target)) return target;
  }
  // The default flatpak naming carries gtk/qt without the linux- prefix in some layouts.
  if (/-gtk-.*\.flatpak$/.test(name)) return 'linux-gtk';
  if (/-qt-.*\.flatpak$/.test(name)) return 'linux-qt';
  return undefined;
}

const localizedFileKeys = {
  'name.txt': 'title',
  'subtitle.txt': 'subtitle',
  'description.txt': 'description',
  'release-notes.txt': 'releaseNotes',
};

function readText(path) {
  try {
    return readFileSync(path, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

async function latestReleaseAssets(repo, log) {
  if (!repo) return [];
  try {
    const headers = { accept: 'application/vnd.github+json' };
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const release = await res.json();
    return (release.assets ?? []).map((a) => ({ name: a.name, size: a.size }));
  } catch (e) {
    log(`no release data for ${repo} (${e.message}) — download cards will be absent`);
    return [];
  }
}

export async function generateAppIndex(projectRoot, outDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[appindex] ${m}`);

  const dayToml = parseTOML(readFileSync(join(projectRoot, 'Day.toml'), 'utf8'));
  const app = dayToml.app ?? {};
  const cargo = existsSync(join(projectRoot, 'Cargo.toml'))
    ? parseTOML(readFileSync(join(projectRoot, 'Cargo.toml'), 'utf8'))
    : {};
  const version = cargo.package?.version;

  const storeDir = join(projectRoot, 'store');
  const storeApp = existsSync(join(storeDir, 'app.toml'))
    ? parseTOML(readFileSync(join(storeDir, 'app.toml'), 'utf8'))
    : {};

  // Localized store texts: one directory per locale, one file per field.
  const title = {};
  const subtitle = {};
  const description = {};
  const releaseNotes = {};
  const keywords = {};
  const links = { privacy: {}, support: {}, marketing: {} };
  const locales = existsSync(storeDir)
    ? readdirSync(storeDir).filter((d) => {
        try {
          return readdirSync(join(storeDir, d)).length > 0;
        } catch {
          return false;
        }
      })
    : [];
  for (const locale of locales) {
    const dir = join(storeDir, locale);
    const fieldMaps = { title, subtitle, description, releaseNotes };
    for (const [file, field] of Object.entries(localizedFileKeys)) {
      const v = readText(join(dir, file));
      if (v) fieldMaps[field][locale] = v;
    }
    const kw = readText(join(dir, 'keywords.txt'));
    if (kw) keywords[locale] = kw.split(',').map((s) => s.trim()).filter(Boolean);
    for (const [key, file] of [
      ['privacy', 'privacy-url.txt'],
      ['support', 'support-url.txt'],
      ['marketing', 'marketing-url.txt'],
    ]) {
      const v = readText(join(dir, file));
      if (v) links[key][locale] = v;
    }
  }
  for (const k of Object.keys(links)) if (!Object.keys(links[k]).length) delete links[k];

  // App icon → served from the site so the appindex needs no external asset host.
  let iconLocation;
  for (const candidate of ['resource/icons/icon.png', 'resource/icons/AppIcon.png', 'resource/icon.png']) {
    const p = join(projectRoot, candidate);
    if (existsSync(p)) {
      const pub = join(TEMPLATE_ROOT, 'public', 'app');
      mkdirSync(pub, { recursive: true });
      copyFileSync(p, join(pub, 'icon.png'));
      iconLocation = 'app/icon.png';
      break;
    }
  }

  const repo = opts.repo ?? process.env.GITHUB_REPOSITORY;
  const assets = await latestReleaseAssets(repo, log);
  const assetsByTarget = new Map();
  for (const a of assets) {
    const t = assetTarget(a.name);
    if (!t) continue;
    if (!assetsByTarget.has(t)) assetsByTarget.set(t, []);
    assetsByTarget.get(t).push({
      name: a.name,
      url: `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(a.name)}`,
      size: a.size,
    });
  }

  // Screenshots: when assemble-gallery.mjs has run (its manifest sits beside site.toml), each
  // platform's appindex entry gets locale-keyed screenshot lists pointing at the same served
  // images — the landing carousel and the /gallery page share one copy. Light theme wins for
  // the carousel; a locale without its own capture falls back to the default variant.
  let galleryShots;
  try {
    galleryShots = JSON.parse(readFileSync(join(outDir, 'gallery-manifest.json'), 'utf8'));
  } catch {
    galleryShots = undefined;
  }
  function screenshotsFor(target) {
    if (!galleryShots) return undefined;
    const byLocale = {};
    for (const shot of galleryShots.shots) {
      const caps = shot.byPlatform[target];
      if (!caps) continue;
      for (const [variant, cap] of Object.entries(caps)) {
        // `dark…` variants stay out of the carousel; the gallery page offers them.
        if (variant.startsWith('dark')) continue;
        const locale = variant === 'default' || variant === 'light'
          ? 'default'
          : variant.replace(/^light-/, '');
        (byLocale[locale] ??= []).push({ location: cap.src, width: cap.width, height: cap.height });
      }
    }
    if (!Object.keys(byLocale).length) return undefined;
    // The schema wants real locale keys; alias the default-variant set under the store's
    // default locale (en when present) so pickAssetList's ladder finds it.
    if (byLocale['default']) {
      const def = locales.includes('en') ? 'en' : locales[0];
      if (def && !byLocale[def]) byLocale[def] = byLocale['default'];
      delete byLocale['default'];
    }
    return Object.keys(byLocale).length ? byLocale : undefined;
  }

  const targets = (app.targets ?? []).filter((t) => TARGET_KEYS[t]);
  const platforms = {};
  for (const target of targets) {
    const key = TARGET_KEYS[target];
    const entry = { platform: target };
    if (version) entry.version = version;
    if (app.build != null) entry.buildNumber = String(app.build);
    if (key === 'ios' && (storeApp['bundle-id'] ?? app.id)) entry.bundleIdentifier = storeApp['bundle-id'] ?? app.id;
    if (key === 'android' && app.id) entry.applicationId = app.id;
    const shots = screenshotsFor(target);
    if (iconLocation || shots) {
      entry.assets = {
        ...(iconLocation ? { icon: { location: iconLocation } } : {}),
        ...(shots ? { screenshots: shots } : {}),
      };
    }
    // The web build is hosted (the site's own webapp/ directory), not downloaded — its dist
    // zip on the release is plumbing for this very pipeline, not a user-facing package.
    const arts = key === 'web' ? undefined : assetsByTarget.get(target);
    if (arts?.length) entry.artifacts = arts;
    platforms[key] = entry;
  }

  const index = {
    $schema: 'https://appfair.org/schemas/appindex/v1.json',
    generator: 'daysite/generate-appindex',
    generated: opts.now ?? new Date().toISOString(),
    apps: [
      {
        name: repo?.split('/')[1] ?? app.title ?? 'app',
        source: repo
          ? {
              url: `https://github.com/${repo}`,
              release: `https://github.com/${repo}/releases/latest`,
            }
          : undefined,
        ...(Object.keys(links).length ? { links } : {}),
        ...(Object.keys(title).length ? { title } : {}),
        ...(Object.keys(subtitle).length ? { subtitle } : {}),
        ...(Object.keys(description).length ? { description } : {}),
        ...(Object.keys(keywords).length ? { keywords } : {}),
        ...(Object.keys(releaseNotes).length ? { releaseNotes } : {}),
        platforms,
      },
    ],
  };

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'appindex.json');
  writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
  log(
    `${Object.keys(platforms).length} platform(s), ${locales.length} locale(s), ` +
      `${assets.length} release asset(s) → ${outPath}`,
  );
  return index;
}

// Standalone entry point.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const repoFlag = process.argv.indexOf('--repo');
  const [projectRoot, outDir] = args;
  if (!projectRoot || !outDir) {
    console.error('usage: generate-appindex.mjs <project-root> <site-toml-dir> [--repo owner/name]');
    process.exit(2);
  }
  await generateAppIndex(resolve(projectRoot), resolve(outDir), {
    repo: repoFlag > 0 ? process.argv[repoFlag + 1] : undefined,
  });
}
