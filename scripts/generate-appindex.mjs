// Synthesize appindex.json for a conventional Day project.
//
// The App Fair publication document (https://appfair.org/schemas/appindex/) normally comes from
// a store-release pipeline; a Day repository already CONTAINS everything it records, so this
// script derives it instead of asking anyone to maintain a second copy:
//
//   --storefront FILE       → `day store export` (docs/store.md "Exporting"): the app's identity
//                             (id, title, version, build, targets), the live App Store / Google
//                             Play listings (badge + link), the listing text resolved per
//                             locale (name, subtitle, description, keywords, release notes,
//                             privacy/support/marketing URLs), each target's store records
//                             (bundle id), and the declared permissions with their native keys
//                             per platform and their reasons per locale. Read from the file
//                             when the workflow wrote one, else from `${DAY_BIN:-day} store
//                             export` run here; without either there is no site to generate,
//                             because everything it says about the app comes from this document.
//   --release-assets FILE   → the latest release's assets ([{name, size}], as the CI workflow
//                             writes them from `gh api …/releases/latest`), each mapped to its
//                             target and its /releases/download/<tag>/ URL. The script
//                             itself never touches the network: no file, no download cards —
//                             the same degradation the daybrite.dev showcase page uses.
//   build/day/host/png/     → the size-exact icon family `day icon build` renders (favicons); else
//   resource/icons/         → the largest PNG there is the app mark, copied into public/
//
// `platforms` uses the schema's conventional `ios`/`android` keys for those two targets and
// Day's additive keys (macos, windows, linux-gtk, linux-qt, harmony, web) for the rest — an
// App Fair consumer reads the subset it understands, daysite reads all of it.
//
// A site with more than one build channel (src/lib/channels.ts) runs this once per channel:
// `--out` names that channel's appindex, `--gallery` the manifest it reads its carousels from,
// and `--downloads DIR` replaces the release lookup for a development channel — the packages
// the CI run just built are copied under the site's own `--download-prefix` and linked from
// there, because a branch build has no release to link.
//
// Usage: node scripts/generate-appindex.mjs <project-root> <out-dir>
//            [--repo owner/name] [--release-assets FILE] [--tag vX.Y.Z] [--storefront FILE]
//            [--out NAME] [--gallery NAME] [--downloads DIR] [--download-prefix PATH]
//        <out-dir> is the directory holding site.toml; appindex.json lands beside it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// The extensions an installable package ends with, per target. A release also carries screenshot
// zips, the checksum manifest, and one provenance sidecar per artifact — and a sidecar is named
// after its artifact (`app-macos-appkit.dmg.sbom-cdx.json`), so it contains the target id and the
// package extension both. Matching the END of the name is what separates a download from a
// document that merely describes one.
const TARGET_PACKAGES = {
  'ios-uikit': ['.ipa'],
  'android-mdc': ['.apk', '.aab'],
  'macos-appkit': ['.dmg'],
  'windows-xaml': ['.msix', '-setup.exe'],
  'linux-gtk': ['.appimage', '.flatpak'],
  'linux-qt': ['.appimage', '.flatpak'],
  'harmony-arkui': ['.hap'],
  // web-dom is absent on purpose, mirroring day-targets.ts's empty `packages`: the web build is
  // hosted under the site's own webapp/, and its release zip is plumbing for that pipeline.
};

// Which release-asset name belongs to which target. build-day-app packs with
// `--no-version-in-name`, so assets look like `<stem>-<platform>-<toolkit>[-extra].<ext>` — match
// on the target id, which every Day release asset carries.
function assetTarget(name) {
  if (name.startsWith('screenshots-')) return undefined;
  for (const [target, exts] of Object.entries(TARGET_PACKAGES)) {
    if (name.includes(target) && exts.some((e) => name.endsWith(e))) return target;
  }
  // Older layouts named a flatpak with the toolkit alone, without the linux- prefix.
  if (/-gtk-.*\.flatpak$/.test(name)) return 'linux-gtk';
  if (/-qt-.*\.flatpak$/.test(name)) return 'linux-qt';
  return undefined;
}

/**
 * The name a packed file takes as a release asset, which is also the name a development
 * channel's staged copy takes — the two channels then differ only in where the bytes are, not
 * in what they are called. Mirrors the release job's two edits (daybrite/actions dayapp.yml):
 * GitHub rewrites a space in an uploaded asset name to a dot, and pack's `-unsigned` .ipa
 * marker is dropped so the iOS download keeps one name whether or not the run had signing
 * secrets.
 */
export function releaseAssetName(name) {
  return name.toLowerCase().replace(/[ ]/g, '-').replace('-unsigned.ipa', '.ipa');
}

/** Every file under `dir`, at any depth, as `{ name, path }`. The CI download lands one
 *  directory per artifact (`dist-macos-appkit/…`), so a flat read would find nothing. */
function* walkFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const path = join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(path);
    else yield { name: e.name, path };
  }
}

// Where a Day project keeps its icons, best source first. `png/` is the platform-neutral set
// `day new` scaffolds, and the one to prefer: macOS art is drawn pre-rounded with transparent
// padding, so masking it again for a favicon rounds it twice and shrinks it inside its own box.
// macOS is therefore last, used only when a project ships nothing else.
const ICON_DIRS = ['png', 'ios', 'linux', 'windows', 'android', '', 'macos'];

// The raster favicon slots and the size that fills each, copied straight from the icon family.
// 192 and 512 are what a web app manifest needs (site.webmanifest); 256 serves the apple-touch
// slot: iOS scales any square, and it is the family's nearest size above the 180 the guidelines
// name.
const FAVICON_SIZES = {
  64: 'favicon-64.png',
  192: 'icon-192.png',
  256: 'apple-touch-icon.png',
  512: 'icon-512.png',
};
// 192 joined the family late (day-cli 2026-09); a family rendered by an older CLI has the rest
// and still makes a favicon set, minus that one slot (the manifest then offers 256 and 512).
const FAVICON_OPTIONAL = new Set([192]);

// Where the size-exact `day-icon-<N>.png` family lives, freshest first: `day icon build` renders it
// under build/day/host/png/ (the CI website job runs `day icon build -p web-dom` for exactly this),
// and `day new` scaffolds a copy under resource/icons/png/.
const ICON_FAMILY_DIRS = [join('build', 'day', 'host', 'png'), join('resource', 'icons', 'png')];

/**
 * The first directory holding every size FAVICON_SIZES needs, as
 * `{ dir, bySize: Map<size, path>, largest }`, or undefined.
 */
function findIconFamily(projectRoot) {
  for (const sub of ICON_FAMILY_DIRS) {
    const dir = join(projectRoot, sub);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const bySize = new Map();
    for (const name of entries) {
      const m = /-(\d+)\.png$/i.exec(name);
      if (m) bySize.set(Number(m[1]), join(dir, name));
    }
    const required = Object.keys(FAVICON_SIZES).map(Number).filter((n) => !FAVICON_OPTIONAL.has(n));
    if (!required.every((size) => bySize.has(size))) continue;
    const largest = bySize.get(Math.max(...bySize.keys()));
    return { dir, bySize, largest };
  }
  return undefined;
}

/**
 * The largest PNG under `resource/icons/`, as an absolute path, or undefined.
 *
 * Size comes from the trailing `-<N>` every Day icon name carries (`day-icon-1024.png`,
 * `AppIcon-1024.png`, `day-icon-macos-512.png`); a name without one falls back to its byte count,
 * which orders a set of the same artwork correctly even though it is not a pixel count. Biggest
 * wins because both consumers scale DOWN — favicons to 512 and below, the landing page to 160.
 */
function findAppIcon(projectRoot) {
  for (const sub of ICON_DIRS) {
    const dir = join(projectRoot, 'resource', 'icons', sub);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    let best;
    for (const name of entries) {
      if (!name.toLowerCase().endsWith('.png')) continue;
      const path = join(dir, name);
      const stem = name.slice(0, -4);
      const tail = Number(stem.slice(stem.lastIndexOf('-') + 1));
      const rank = Number.isFinite(tail) && tail > 0 ? tail : statSync(path).size / 1000;
      if (!best || rank > best.rank) best = { path, rank };
    }
    if (best) return best.path;
  }
  return undefined;
}

// The storefront's text fields → the appindex's locale-keyed keys.
const TEXT_KEYS = {
  name: 'title',
  subtitle: 'subtitle',
  description: 'description',
  'release-notes': 'releaseNotes',
};
const LINK_KEYS = { 'privacy-url': 'privacy', 'support-url': 'support', 'marketing-url': 'marketing' };

/**
 * The latest release's assets as `[{ name, size }]`, read from the file the CI workflow writes
 * (`gh api repos/<owner>/<name>/releases/latest --jq '[.assets[] | {name, size}]'`). A whole
 * release object (`{ assets: [...] }`) is accepted too. No path, or a file that is missing or
 * not JSON, means no release data: the site renders without download cards.
 */
export function readReleaseAssets(path, log = () => {}) {
  if (!path) return [];
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    log(`no release data (${path}: ${e.message}) — download cards will be absent`);
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.assets) ? parsed.assets : [];
  return list
    .filter((a) => a && typeof a.name === 'string')
    .map((a) => ({ name: a.name, size: Number(a.size) || 0 }));
}

/**
 * The project's storefront document (`day store export`): from `path` when given (the
 * workflow writes one right after installing the CLI), else by running `${DAY_BIN:-day} store
 * export` in the project, so a local preview shows what CI shows. Throws when neither is
 * available: everything the site says about the app comes from this document, so there is
 * nothing to generate without it.
 */
export function readStorefront(projectRoot, path, log = () => {}) {
  if (path) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`generate-appindex: the storefront document ${path} could not be read (${e.message})`);
    }
    return checkStorefront(doc, path);
  }
  const bin = process.env.DAY_BIN || 'day';
  let out;
  try {
    out = execFileSync(bin, ['--project', projectRoot, 'store', 'export'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const why = String(e.stderr || e.message).trim().split('\n').pop();
    throw new Error(
      `generate-appindex: \`${bin} store export\` failed (${why}); the site is generated from that document — ` +
        'set DAY_BIN to a day CLI, or pass --storefront FILE written by `day store export --out FILE`',
    );
  }
  log(`storefront: from \`${bin} store export\``);
  return checkStorefront(JSON.parse(out.toString()), `${bin} store export`);
}

/** The document has to be a storefront export, not, say, `day metadata --json`. */
function checkStorefront(doc, from) {
  if (!doc || typeof doc !== 'object' || !doc.project || !doc.storefront || !Array.isArray(doc.locales)) {
    throw new Error(`generate-appindex: ${from} is not a \`day store export\` document (schema 1: project, locales, storefront)`);
  }
  return doc;
}

// The appindex platform key each of the CLI's permission columns belongs to.
const PERMISSION_PLATFORMS = { android: 'android', ios: 'ios', macos: 'macos', ohos: 'harmony' };

/**
 * The per-platform `permissions` arrays for the app index from a storefront export (or a
 * `day metadata --json` document, which carries the same two lists under `project`): every
 * declared permission's native keys on each platform, and the raw ones, each with its reason
 * as a locale-keyed description. Android takes no reason, so its entries carry none; the
 * site's own catalog describes them.
 */
export function permissionsByPlatform(metadata) {
  const project = metadata?.project?.permissions ? metadata.project : (metadata ?? {});
  const out = {};
  const add = (platform, key, reasons) => {
    const list = (out[platform] ??= []);
    if (list.some((e) => e.key === key)) return;
    const entry = { key };
    if (reasons && Object.keys(reasons).length) entry.description = reasons;
    list.push(entry);
  };
  for (const decl of project.permissions ?? []) {
    for (const [column, platform] of Object.entries(PERMISSION_PLATFORMS)) {
      for (const key of decl[column] ?? []) add(platform, key, column === 'android' ? undefined : decl.reasons);
    }
  }
  const raw = project.rawPermissions ?? {};
  for (const key of raw.android ?? []) add('android', key);
  for (const [column, platform] of [['ios', 'ios'], ['macos', 'macos']]) {
    for (const [key, v] of Object.entries(raw[column] ?? {})) add(platform, key, v?.reasons);
  }
  for (const p of raw.ohos ?? []) if (p?.name) add('harmony', p.name, p.reasons);
  for (const list of Object.values(out)) list.sort((a, b) => a.key.localeCompare(b.key));
  return out;
}

/** `owner/name` from a GitHub remote URL in any of git's spellings, or undefined. */
export function parseGithubRepo(url) {
  const m = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(String(url ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** The project's GitHub repository from its `origin` remote — what a local preview has where
 *  CI has `--repo`; without it the site has no source or release links. Undefined when the
 *  tree is not a checkout or the remote is elsewhere. */
function repoFromGit(projectRoot, log) {
  let url;
  try {
    url = execFileSync('git', ['-C', projectRoot, 'remote', 'get-url', 'origin'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return undefined;
  }
  const repo = parseGithubRepo(url);
  if (repo) log(`repository: ${repo} (from the git remote)`);
  return repo;
}

/** The listings Day.toml's `[store]` table says are live, as `{ id, url }` per store. A key is
 *  the store's own identifier for the listing (the App Store's numeric app id, Play's
 *  application id), never a URL, so the URL shape stays here in one place. */
export function storeListing(table) {
  const out = {};
  const apple = String(table?.['apple-app-id'] ?? '').trim();
  const google = String(table?.['google-play-id'] ?? '').trim();
  if (apple) out.apple = { id: apple, url: `https://apps.apple.com/app/id${apple}` };
  if (google) {
    out.google = {
      id: google,
      url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(google)}`,
    };
  }
  return out;
}

/**
 * The appindex's localized text and links from the storefront's shared-level text: one map per
 * field, keyed by locale, holding only what a locale resolves to (the default locale's text
 * where a locale sets none of its own, the way the stores see it).
 */
export function localizedText(storefront) {
  const out = { title: {}, subtitle: {}, description: {}, releaseNotes: {}, keywords: {}, links: { privacy: {}, support: {}, marketing: {} } };
  for (const [locale, fields] of Object.entries(storefront?.storefront?.metadata ?? {})) {
    if (!fields || typeof fields !== 'object') continue;
    for (const [key, target] of Object.entries(TEXT_KEYS)) {
      if (typeof fields[key] === 'string' && fields[key].trim()) out[target][locale] = fields[key].trim();
    }
    if (Array.isArray(fields.keywords) && fields.keywords.length) out.keywords[locale] = fields.keywords.map(String);
    for (const [key, target] of Object.entries(LINK_KEYS)) {
      if (typeof fields[key] === 'string' && fields[key].trim()) out.links[target][locale] = fields[key].trim();
    }
  }
  for (const k of Object.keys(out.links)) if (!Object.keys(out.links[k]).length) delete out.links[k];
  return out;
}

export async function generateAppIndex(projectRoot, outDir, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[appindex] ${m}`);
  // Where the site serves its own files from. The template's `public/` in every real run; the
  // test suite points it at a temp directory so a run does not clobber a working preview.
  const publicDir = opts.publicDir ?? join(TEMPLATE_ROOT, 'public');

  // Everything the site says about the app comes from the CLI's storefront export: the
  // project's identity, its locales, the listing text resolved per locale, the store records
  // and the permissions. The generator reads no project file of its own.
  const storefront = readStorefront(projectRoot, opts.storefront ?? process.env.DAYSITE_STOREFRONT, log);
  const app = storefront.project ?? {};
  // A release channel describes the release, not the checkout: the site is generated from the
  // newest commit, which may already be a version ahead of what has been released. The tag is
  // the released version, so it wins where there is one; a development channel has none and
  // keeps the version the source carries.
  const releaseTag = opts.tag ?? process.env.DAYSITE_RELEASE_TAG ?? undefined;
  const sourceVersion = typeof app.version === 'string' ? app.version : undefined;
  const version = releaseTag ? releaseTag.replace(/^v/, '') : sourceVersion;
  // The build number is the source tree's, so it describes the version reported here only while
  // the two agree. A release channel generated from a newer commit leaves it out rather than
  // pairing a released version with a build it never had.
  const buildNumber = !releaseTag || version === sourceVersion ? app.build : undefined;

  const locales = storefront.locales;
  const { title, subtitle, description, releaseNotes, keywords, links } = localizedText(storefront);

  // App icon → served from the site, so the appindex needs no external asset host. It becomes the
  // landing page's app mark and the social image, both of which want the biggest source
  // available — and, when the size-exact family is there, the raster favicon set, copied as-is
  // (docs: "The app icon" in the README). The site build rasterizes nothing itself.
  let iconLocation;
  const pub = join(publicDir, 'app');
  const family = findIconFamily(projectRoot);
  const icon = family?.largest ?? findAppIcon(projectRoot);
  if (icon) {
    mkdirSync(pub, { recursive: true });
    copyFileSync(icon, join(pub, 'icon.png'));
    iconLocation = 'app/icon.png';
    log(`app icon: ${icon.slice(projectRoot.length + 1)}`);
  } else {
    log('no PNG under build/day/host/png/ or resource/icons/ — the site gets no app mark');
  }
  if (family) {
    const missing = [];
    for (const [size, name] of Object.entries(FAVICON_SIZES)) {
      const src = family.bySize.get(Number(size));
      if (src) copyFileSync(src, join(pub, name));
      else {
        rmSync(join(pub, name), { force: true });
        missing.push(size);
      }
    }
    log(`favicon set: ${family.dir.slice(projectRoot.length + 1)}/${missing.length ? ` (no ${missing.join(', ')} px render; an older day-cli)` : ''}`);
  } else {
    for (const name of Object.values(FAVICON_SIZES)) rmSync(join(pub, name), { force: true });
    log('no size-exact icon family (`day icon build -p web-dom` renders one) — no raster favicon set');
  }

  // The VECTOR master itself (the app icon pipeline's source, docs/icons.md in the day repo):
  // preferred by the site wherever a browser renders the icon — the landing app mark and the
  // favicon — because it stays crisp at every size. The PNG above remains the source for the
  // DERIVED raster set (apple-touch, PWA tiles, legacy favicons) and the only icon for
  // projects without an SVG master.
  let iconVectorLocation;
  for (const name of ['icon.svg', 'day-icon.svg']) {
    const path = join(projectRoot, 'resource', 'icons', name);
    let svg;
    try {
      svg = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    // Reserved layers (day:monochrome / day:dark) are data for the icon pipeline, not for
    // display; a master may ship them visible, which would paint the black silhouette over
    // the art in a plain <img> render. Hide them the way generated masters already ship.
    for (const id of ['day:monochrome', 'day:dark']) {
      svg = svg.replace(
        new RegExp(`(<[a-zA-Z]+[^>]*\\bid="${id}")(?![^>]*\\bdisplay=)`),
        '$1 display="none"',
      );
    }
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'icon.svg'), svg);
    iconVectorLocation = 'app/icon.svg';
    log(`app icon (vector master): ${path.slice(projectRoot.length + 1)}`);
    break;
  }

  const repo = opts.repo ?? process.env.GITHUB_REPOSITORY ?? repoFromGit(projectRoot, log);
  const assetsByTarget = new Map();
  const addArtifact = (target, entry) => {
    if (!assetsByTarget.has(target)) assetsByTarget.set(target, []);
    assetsByTarget.get(target).push(entry);
  };
  let assetCount = 0;
  if (opts.downloads) {
    // A DEVELOPMENT channel: the packages this CI run built, staged on the site itself. There
    // is no release behind a branch build, so the site serves the bytes and the card links a
    // path under `--download-prefix` rather than a releases/latest URL. Only real packages are
    // copied — the provenance sidecars beside them describe a download, they are not one — so
    // the site carries what a visitor can install and nothing else.
    const prefix = `${(opts.downloadPrefix ?? 'downloads').replace(/^\/+|\/+$/g, '')}/`;
    const outDown = join(publicDir, ...prefix.split('/').filter(Boolean));
    rmSync(outDown, { recursive: true, force: true });
    let bytes = 0;
    const staged = new Set();
    for (const found of walkFiles(opts.downloads)) {
      const name = releaseAssetName(found.name);
      const target = assetTarget(name);
      // Two artifacts can normalize to one name — a signed and an unsigned .ipa both become
      // `<stem>-ios-uikit.ipa` — and the card would then offer the same file twice.
      if (!target || staged.has(name)) continue;
      staged.add(name);
      mkdirSync(outDown, { recursive: true });
      copyFileSync(found.path, join(outDown, name));
      const size = statSync(found.path).size;
      bytes += size;
      addArtifact(target, { name, url: `${prefix}${name}`, size });
      assetCount++;
    }
    log(`${assetCount} package(s), ${(bytes / 1e6).toFixed(1)} MB → public/${prefix}`);
  } else {
    const assets = readReleaseAssets(opts.releaseAssets ?? process.env.DAYSITE_RELEASE_ASSETS, log);
    assetCount = assets.length;
    for (const a of assets) {
      const t = assetTarget(a.name);
      if (!t) continue;
      // Pinned to the tag rather than `releases/latest/download/…`: the pages describe one
      // release, and `latest` answers with whatever is newest when a visitor clicks, which is a
      // different build as soon as the next one goes out. Without a tag (a preview run reading a
      // release it did not name) `latest` is still the best guess.
      const url = releaseTag
        ? `https://github.com/${repo}/releases/download/${encodeURIComponent(releaseTag)}/${encodeURIComponent(a.name)}`
        : `https://github.com/${repo}/releases/latest/download/${encodeURIComponent(a.name)}`;
      addArtifact(t, { name: a.name, url, size: a.size });
    }
  }

  // Screenshots: when assemble-gallery.mjs has run (its manifest sits beside site.toml), each
  // platform's appindex entry gets locale-keyed screenshot lists pointing at the same served
  // images — the landing carousel and the /gallery page share one copy. Light theme wins for
  // the carousel; a locale without its own capture falls back to the default variant.
  let galleryShots;
  try {
    galleryShots = JSON.parse(readFileSync(join(outDir, opts.gallery ?? 'gallery-manifest.json'), 'utf8'));
  } catch {
    galleryShots = undefined;
  }
  /** The theme and locale of a manifest capture: the fields the index resolved (stamped by the
   *  runner), or, for a manifest an older CLI wrote, decoded from the variant name
   *  (`light-fr` → light, fr; `fr` → fr; `default`/`light` → the default locale). */
  function captureParts(variant, cap) {
    if (cap?.theme || cap?.locale) {
      return { theme: cap.theme ?? 'default', locale: cap.locale ?? 'default' };
    }
    if (variant === 'default') return { theme: 'default', locale: 'default' };
    const [head, ...rest] = variant.split('-');
    if (head === 'light' || head === 'dark') {
      return { theme: head, locale: rest.length ? rest.join('-') : 'default' };
    }
    return { theme: 'default', locale: variant };
  }
  /** The device kind a column captures on: `ios-uikit/ipad` → ipad; a bare target → what a
   *  profile-less capture on it is (iphone, phone), the way the day CLI files it. */
  function columnKind(target, column) {
    if (column !== target) return column.slice(target.length + 1);
    if (target === 'ios-uikit') return 'iphone';
    if (target === 'android-mdc') return 'phone';
    return 'default';
  }
  /** One column's captures as a locale-keyed asset list: the declared list for the column's
   *  device kind (store/storefront.toml [storefront.<target>.screenshots], resolved by `day screenshot
   *  index` into the manifest's `listings`), in its order and themes; without one, every titled
   *  light capture, as the carousel always showed. */
  function columnScreenshots(target, column) {
    const byLocale = {};
    const kind = columnKind(target, column);
    const defaultLocale = locales.includes('en') ? 'en' : locales[0];
    // `website.<kind>` is resolved per locale by the CLI (a locale's own list first, then the
    // general one), keyed by the capture locale; `default` is a capture with no locale at all.
    const declared = galleryShots.listings?.[target]?.website?.[kind];
    const push = (locale, cap) => {
      if (locale !== 'default' && !/^[a-z]{2,3}(-[A-Za-z0-9]+)*$/.test(locale)) return;
      (byLocale[locale] ??= []).push({ location: cap.src, width: cap.width, height: cap.height });
    };
    // The capture of a shot in a theme and locale, by the fields the manifest carries; a
    // locale with no capture of its own takes the default locale's, the way the stores see it.
    const find = (caps, theme, locale) => {
      const parts = Object.entries(caps).map(([v, cap]) => ({ cap, ...captureParts(v, cap) }));
      const match = (l) =>
        parts.find((c) => c.locale === l && c.theme === theme) ??
        parts.find((c) => c.locale === l && c.theme === 'default');
      return match(locale) ?? (locale === defaultLocale ? match('default') : undefined);
    };
    if (declared && typeof declared === 'object' && Object.keys(declared).length) {
      for (const [locale, list] of Object.entries(declared)) {
        if (!Array.isArray(list)) continue;
        // `default` and the default locale resolve to the same captures; one list, not two.
        if (locale === 'default' && Array.isArray(declared[defaultLocale])) continue;
        const want = locale === 'default' ? defaultLocale : locale;
        for (const item of list) {
          const shot = galleryShots.shots.find((s) => s.id === item.shot);
          const caps = shot?.byPlatform[column];
          if (!caps) continue;
          const found = find(caps, item.theme ?? 'light', want);
          if (found) push(want, found.cap);
        }
      }
    } else {
      for (const shot of galleryShots.shots) {
        const caps = shot.byPlatform[column];
        if (!caps) continue;
        for (const [variant, cap] of Object.entries(caps)) {
          const parts = captureParts(variant, cap);
          if (parts.theme !== 'default' && parts.theme !== 'light') continue;
          push(parts.locale === 'default' ? defaultLocale : parts.locale, cap);
        }
      }
    }
    if (!Object.keys(byLocale).length) return undefined;
    return byLocale;
  }
  /** The landing page's screenshot rows for a target: one per column (device profile) the
   *  manifest has for it, in the manifest's column order (the phone before the tablet). */
  function screenshotRowsFor(target) {
    if (!galleryShots) return [];
    const columns = (galleryShots.platforms ?? []).filter((c) => c === target || c.startsWith(`${target}/`));
    const rows = [];
    for (const column of columns) {
      const screenshots = columnScreenshots(target, column);
      if (!screenshots) continue;
      rows.push(column === target ? { screenshots } : { device: columnKind(target, column), screenshots });
    }
    // Phones before tablets, whatever order the captures arrived in; anything else after, as
    // it came.
    const ORDER = ['iphone', 'phone', 'ipad', 'tablet'];
    const rank = (r) => (r.device && ORDER.includes(r.device) ? ORDER.indexOf(r.device) : ORDER.length);
    return rows.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
  }

  const listing = storeListing(app.store);
  const permissions = permissionsByPlatform(storefront);
  {
    const n = Object.values(permissions).reduce((a, l) => a + l.length, 0);
    log(`permissions: ${n} native declaration(s) across ${Object.keys(permissions).length} platform(s)`);
  }
  if (listing.apple) log(`listed on the App Store: ${listing.apple.url}`);
  if (listing.google) log(`listed on Google Play: ${listing.google.url}`);

  const targets = (app.targets ?? []).filter((t) => TARGET_KEYS[t]);
  const platforms = {};
  for (const target of targets) {
    const key = TARGET_KEYS[target];
    const entry = { platform: target };
    if (version) entry.version = version;
    if (buildNumber != null) entry.buildNumber = String(buildNumber);
    if (permissions[key]?.length) entry.permissions = permissions[key];
    // The App Store record's id: the store's resolved submission info, else the app's own id.
    if (key === 'ios') {
      entry.bundleIdentifier =
        storefront.storefront?.targets?.[target]?.stores?.['apple-app-store']?.['submission-info']?.['bundle-id']
        ?? app.id;
    }
    if (key === 'android' && app.id) entry.applicationId = app.id;
    // Live store listings (Day.toml `[store]`, docs/store.md "Listed apps"): the conventional
    // appindex channel keys, which the site turns into the store's localized badge.
    if (key === 'ios' && listing.apple) {
      entry.channels = { appleappstore: { id: listing.apple.id, url: listing.apple.url } };
    }
    if (key === 'android' && listing.google) {
      entry.channels = { googleplaystore: { id: listing.google.id, url: listing.google.url } };
    }
    // `screenshots` is the first row, for readers that know only the schema; `screenshotRows`
    // (a Day extension) is every device profile's own list, which the landing page shows as
    // one carousel each.
    const rows = screenshotRowsFor(target);
    const shots = rows[0]?.screenshots;
    if (iconLocation || iconVectorLocation || shots) {
      entry.assets = {
        ...(iconLocation ? { icon: { location: iconLocation } } : {}),
        ...(iconVectorLocation ? { iconVector: { location: iconVectorLocation } } : {}),
        ...(shots ? { screenshots: shots, screenshotRows: rows } : {}),
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

  const outPath = join(outDir, opts.out ?? 'appindex.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n');
  log(
    `${Object.keys(platforms).length} platform(s), ${locales.length} locale(s), ` +
      `${assetCount} ${opts.downloads ? 'staged package(s)' : 'release asset(s)'} → ${outPath}`,
  );
  return index;
}

// Standalone entry point.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const positional = [];
  const flags = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
    else positional.push(argv[i]);
  }
  const [projectRoot, outDir] = positional;
  if (!projectRoot || !outDir) {
    console.error(
      'usage: generate-appindex.mjs <project-root> <site-toml-dir> [--repo owner/name] ' +
        '[--release-assets FILE] [--tag vX.Y.Z] [--storefront FILE] [--out NAME] [--gallery NAME] ' +
        '[--downloads DIR] [--download-prefix PATH]',
    );
    process.exit(2);
  }
  await generateAppIndex(resolve(projectRoot), resolve(outDir), {
    repo: flags.repo,
    releaseAssets: flags['release-assets'],
    tag: flags.tag,
    storefront: flags.storefront,
    out: flags.out,
    gallery: flags.gallery,
    downloads: flags.downloads && resolve(flags.downloads),
    downloadPrefix: flags['download-prefix'],
  });
}
