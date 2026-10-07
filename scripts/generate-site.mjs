// Generate every build channel's site data, and the channels.json that ties them together.
//
// A Day project's site publishes the app up to three times (src/lib/channels.ts): the newest
// RELEASE and a newer PRE-RELEASE, each built only from assets that release already carries, and
// the newest build of the default branch, built from the artifacts the CI run just produced. Each
// channel has its own appindex, gallery manifest, served screenshots, hosted web build, and
// downloads; the default channel owns the locale root and the others live one URL segment
// deeper.
//
// This script is the one entry point for that: it runs assemble-gallery.mjs and
// generate-appindex.mjs once per channel with the right prefixes, then writes channels.json.
// The CI workflow (daybrite/actions dayapp.yml) and `preview.mjs --release` both call it, so
// what a developer previews locally is assembled by the same code that publishes.
//
//   node scripts/generate-site.mjs <project-root> <site-toml-dir> --channels SPEC.json \
//        [--repo owner/name] [--storefront FILE]
//
// SPEC.json is an array of channels, in picker order:
//
//   [
//     { "id": "release", "label": "0.4.1", "tag": "v0.4.1",
//       "screenshots": "rel-shots", "releaseAssets": "release-assets.json" },
//     { "id": "prerelease", "label": "0.4.2", "tag": "v0.4.2", "prerelease": true,
//       "screenshots": "pre-shots", "releaseAssets": "prerelease-assets.json" },
//     { "id": "main", "label": "main", "ref": "main", "commit": "0d1f2ab",
//       "development": true, "screenshots": "shots", "downloads": "dist-in",
//       "runURL": "https://github.com/owner/name/actions/runs/123" }
//   ]
//
// Keys: `id` and `label` are required. `published` is when a release was published (GitHub's
// `published_at`), which the release channel's pages show under the version picker. `development` marks a branch build — its pages carry the
// notice, and its packages are staged on the site from `downloads` instead of linked from a
// release. `prerelease` marks a published pre-release, linked from its release like the release
// channel, whose pages carry a pre-release notice. `segment` overrides the URL segment (default:
// the branch name for a development channel, `prerelease` for a pre-release, `release`
// otherwise); the DEFAULT channel's segment is always empty, and a default
// development channel keeps its natural segment as a redirect so `/en/main/` resolves before
// the project's first release too.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseTOML } from 'smol-toml';
import { generateAppIndex } from './generate-appindex.mjs';
import { assembleGallery } from './assemble-gallery.mjs';
import { webpTree } from './webp.mjs';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} projectRoot the Day project (holds Day.toml)
 * @param {string} siteDir     the directory holding site.toml
 * @param {object[]} specs     the channels, in picker order (see the header)
 * @param {{ repo?: string, storefront?: string, publicDir?: string, quiet?: boolean, webp?: boolean }} [opts]
 *        `webp: false` skips the WebP pass over each channel's captures (scripts/webp.mjs)
 * @returns the channels.json document that was written
 */
export async function generateSite(projectRoot, siteDir, specs, opts = {}) {
  const log = (m) => opts.quiet || console.log(`[site] ${m}`);
  if (!specs.length) throw new Error('generate-site: no channels');

  const site = parseTOML(readFileSync(join(siteDir, 'site.toml'), 'utf8'));
  const webapp = String(site.webapp ?? 'webapp').replace(/^\/+|\/+$/g, '');

  // The release channel owns the locale root; without one, a pre-release does, and a project with
  // neither publishes main there, which is also what makes its version picker a single entry and
  // therefore invisible.
  const defaultSpec =
    specs.find((s) => !s.development && !s.prerelease) ??
    specs.find((s) => !s.development) ??
    specs[0];

  // Clear what the last run served, because which channel owns which prefix can change: a
  // project's first release moves the branch build from `downloads/` to `main/downloads/`, and
  // the directory it vacated would otherwise be copied into the next deploy and served forever.
  // Only the two directories a channel owns are removed — its staged web build is put there by
  // the caller, before or after this runs, and is not ours to delete.
  const publicDir = opts.publicDir ?? join(TEMPLATE_ROOT, 'public');
  try {
    const previous = JSON.parse(readFileSync(join(siteDir, 'channels.json'), 'utf8'));
    for (const c of previous.channels ?? []) {
      const p = c.path ? `${c.path}/` : '';
      for (const owned of [`${p}gallery`, `${p}downloads`]) {
        rmSync(join(publicDir, ...owned.split('/')), { recursive: true, force: true });
      }
    }
  } catch {
    // No previous run, or an unreadable record: there is nothing this run can be sure it owns.
  }

  const channels = [];
  for (const spec of specs) {
    if (!spec.id || !spec.label) throw new Error(`generate-site: a channel needs id and label`);
    const natural =
      spec.segment ??
      (spec.development ? spec.ref || 'main' : spec.prerelease ? 'prerelease' : 'release');
    const isDefault = spec === defaultSpec;
    const path = isDefault ? '' : natural;
    const p = path ? `${path}/` : '';

    // Gallery first, then the appindex: the appindex READS the manifest to fill each platform's
    // landing-page carousel, so the other order ships every carousel empty on a fresh checkout.
    if (spec.screenshots) {
      assembleGallery(resolve(spec.screenshots), siteDir, {
        prefix: `${p}gallery`,
        manifest: `${p}gallery-manifest.json`,
        publicDir,
        quiet: opts.quiet,
      });
      // The WebP beside each published capture (scripts/webp.mjs), unless the caller skips it.
      if (opts.webp !== false) {
        const r = await webpTree(join(publicDir, ...`${p}gallery`.split('/')));
        if (!opts.quiet) console.log(`[webp] ${r.made} file(s) encoded for ${p || 'the root'} channel: ${(r.png / 1e6).toFixed(1)} MB of PNG, ${(r.webp / 1e6).toFixed(1)} MB of WebP`);
      }
    }
    await generateAppIndex(projectRoot, siteDir, {
      repo: opts.repo,
      storefront: opts.storefront,
      out: `${p}appindex.json`,
      gallery: `${p}gallery-manifest.json`,
      releaseAssets: spec.releaseAssets ? resolve(spec.releaseAssets) : undefined,
      // The released version, which the appindex reports and links its downloads to.
      tag: spec.tag,
      downloads: spec.downloads ? resolve(spec.downloads) : undefined,
      downloadPrefix: `${p}downloads`,
      publicDir,
      quiet: opts.quiet,
    });

    channels.push({
      id: spec.id,
      label: spec.label,
      path,
      // A default development channel keeps `/en/main/` reachable as a redirect, so a link made
      // before the project's first release still lands on the development pages after it.
      ...(isDefault && natural && spec.development ? { alias: natural } : {}),
      development: !!spec.development,
      ...(spec.prerelease ? { prerelease: true } : {}),
      appindex: `${p}appindex.json`,
      gallery: `${p}gallery-manifest.json`,
      webapp: `${p}${webapp}`,
      ...(spec.tag ? { tag: spec.tag } : {}),
      ...(spec.published ? { published: spec.published } : {}),
      ...(spec.tag && opts.repo
        ? { releaseURL: `https://github.com/${opts.repo}/releases/tag/${spec.tag}` }
        : {}),
      ...(spec.ref ? { ref: spec.ref } : {}),
      ...(spec.commit ? { commit: spec.commit.slice(0, 7) } : {}),
      ...(spec.commit && opts.repo
        ? { commitURL: `https://github.com/${opts.repo}/commit/${spec.commit}` }
        : {}),
      ...(spec.runURL ? { runURL: spec.runURL } : {}),
    });
  }

  const file = { default: defaultSpec.id, channels };
  mkdirSync(siteDir, { recursive: true });
  const outPath = join(siteDir, 'channels.json');
  writeFileSync(outPath, JSON.stringify(file, null, 2) + '\n');
  log(
    `${channels.length} channel(s): ` +
      channels.map((c) => `${c.label} → /${c.path || ''}`).join(', ') +
      ` → ${outPath}`,
  );
  return file;
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
  const [projectRoot, siteDir] = positional;
  if (!projectRoot || !siteDir || !flags.channels) {
    console.error(
      'usage: generate-site.mjs <project-root> <site-toml-dir> --channels SPEC.json ' +
        '[--repo owner/name] [--storefront FILE] [--public-dir DIR]',
    );
    process.exit(2);
  }
  if (!existsSync(flags.channels)) {
    console.error(`generate-site: no such channel spec: ${flags.channels}`);
    process.exit(2);
  }
  await generateSite(
    resolve(projectRoot),
    resolve(siteDir),
    JSON.parse(readFileSync(flags.channels, 'utf8')),
    { repo: flags.repo, storefront: flags.storefront,
      ...(flags['public-dir'] ? { publicDir: resolve(flags['public-dir']) } : {}) },
  );
}
