// Local preview of an app's daysite: generate the data from the repo, then run astro dev.
//
//   cd <your-app>/website && node .daysite/scripts/preview.mjs
//
// (First: git clone https://github.com/daybrite/daysite .daysite && npm --prefix .daysite install)
//
// The plain run needs no network: one build channel, from this checkout — the appindex from
// Day.toml and store/, the gallery from your last local `day launch --script`, and no download
// cards, since only the workflow looks a release up.
//
//   node .daysite/scripts/preview.mjs --ci
//
// `--ci` assembles what the workflow publishes: BOTH build channels (src/lib/channels.ts), the
// release one from the newest GitHub release's own assets and the development one from the
// newest successful run of the default branch. It shells out to `gh` for both and caches the
// downloads under `build/day/daysite/`, so a second run is fast. `--run <id>` picks a specific
// workflow run; `--no-serve` generates the data and stops.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppIndex } from './generate-appindex.mjs';
import { assembleGallery } from './assemble-gallery.mjs';
import { generateSite } from './generate-site.mjs';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The conventional layout is a clone at <app>/website/.daysite/. `DAYSITE_CONFIG` points a bare
// template checkout at any app's site.toml instead — the same variable the Astro build reads, so
// one export drives generation and serving both.
const siteDir = process.env.DAYSITE_CONFIG
  ? dirname(resolve(process.env.DAYSITE_CONFIG))
  : resolve(TEMPLATE_ROOT, '..'); // <app>/website
const projectRoot = resolve(siteDir, '..'); // <app>

if (!existsSync(join(siteDir, 'site.toml'))) {
  console.error(`no site.toml in ${siteDir} — run from <app>/website/.daysite/`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
const gh = (...args) => sh('gh', args, { cwd: projectRoot, stdio: ['ignore', 'pipe', 'inherit'] });
const log = (m) => console.log(`[preview] ${m}`);

/** Unzip `zip` into `dir`, merging with whatever is already there. */
function unzipInto(zip, dir) {
  mkdirSync(dir, { recursive: true });
  sh('unzip', ['-qo', zip, '-d', dir]);
}

/**
 * Merge every per-target capture tree under `from` into one, then let the day CLI index it —
 * the same two steps the workflow's website job runs, so the preview's gallery is curated,
 * ordered, and captioned exactly like the published one. Without a CLI the assembler falls
 * back to a directory scan.
 */
function indexCaptures(tree) {
  const bin = process.env.DAY_BIN || 'day';
  try {
    sh(bin, ['--project', projectRoot, 'screenshot', 'index', '--screenshot-paths', tree, '--out', join(tree, 'gallery.json')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (e) {
    log(`\`${bin} screenshot index\` failed (${String(e.message).split('\n')[0]}) — the gallery falls back to a directory scan`);
  }
}

if (!flag('ci')) {
  // One channel, no channels.json: exactly the site this template built before channels existed.
  // The file is removed rather than left behind, so a plain run after a `--ci` one is not served
  // a stale second channel whose data this run did not refresh.
  rmSync(join(siteDir, 'channels.json'), { force: true });
  await generateAppIndex(projectRoot, siteDir);
  assembleGallery(join(projectRoot, 'build', 'day', 'screenshots'), siteDir);
} else {
  const cache = join(projectRoot, 'build', 'day', 'daysite');
  mkdirSync(cache, { recursive: true });
  const repo = gh('repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner').trim();
  const branch = gh(
    'repo', 'view', '--json', 'defaultBranchRef', '--jq', '.defaultBranchRef.name',
  ).trim();
  const specs = [];

  // --- the release channel: only what the release itself carries -----------------------------
  let release;
  try {
    release = JSON.parse(gh('api', `repos/${repo}/releases/latest`));
  } catch {
    log('no published release — the site will have the development channel only');
  }
  if (release) {
    const tag = release.tag_name;
    const dir = join(cache, tag);
    const shots = join(dir, 'screenshots');
    writeFileSync(
      join(cache, 'release-assets.json'),
      JSON.stringify(release.assets.map((a) => ({ name: a.name, size: a.size })), null, 2),
    );
    if (!existsSync(shots)) {
      mkdirSync(dir, { recursive: true });
      // One merged `screenshots.zip` when the release has it; otherwise the per-target zips,
      // which every Day release has carried since before it existed. Both unzip to the same
      // capture tree, so nothing downstream has to know which one arrived.
      const names = release.assets.map((a) => a.name);
      const merged = names.includes('screenshots.zip');
      log(`downloading ${tag} screenshots (${merged ? 'screenshots.zip' : `${names.filter((n) => n.startsWith('screenshots-')).length} per-target zips`})`);
      gh('release', 'download', tag, '--dir', dir, '--clobber', '--pattern',
        merged ? 'screenshots.zip' : 'screenshots-*.zip');
      for (const z of readdirSync(dir).filter((n) => n.endsWith('.zip'))) unzipInto(join(dir, z), shots);
      indexCaptures(shots);
    }
    // The released web build, hosted at the site root so `/webapp/` runs the version the
    // release channel's pages describe.
    const webZip = release.assets.find((a) => /-web-dom\.zip$/.test(a.name));
    const webOut = join(TEMPLATE_ROOT, 'public', 'webapp');
    if (webZip && !existsSync(join(webOut, 'index.html'))) {
      gh('release', 'download', tag, '--dir', dir, '--clobber', '--pattern', webZip.name);
      rmSync(webOut, { recursive: true, force: true });
      unzipInto(join(dir, webZip.name), webOut);
    }
    specs.push({
      id: 'release',
      label: tag.replace(/^v/, ''),
      tag,
      screenshots: shots,
      releaseAssets: join(cache, 'release-assets.json'),
    });
  }

  // --- the development channel: the newest successful run of the default branch --------------
  const runId =
    value('run') ??
    gh('run', 'list', '--branch', branch, '--status', 'success', '--limit', '1',
       '--json', 'databaseId', '--jq', '.[0].databaseId').trim();
  const run = JSON.parse(gh('api', `repos/${repo}/actions/runs/${runId}`));
  const runDir = join(cache, `run-${runId}`);
  if (!existsSync(runDir)) {
    log(`downloading artifacts from run ${runId} (${run.head_sha.slice(0, 7)})`);
    mkdirSync(runDir, { recursive: true });
    gh('run', 'download', String(runId), '--dir', runDir);
  }
  const mainShots = join(runDir, '_screenshots');
  if (!existsSync(mainShots)) {
    mkdirSync(mainShots, { recursive: true });
    for (const name of readdirSync(runDir).filter((n) => n.startsWith('screenshots-'))) {
      sh('cp', ['-R', `${join(runDir, name)}/.`, mainShots], { stdio: 'inherit' });
    }
    indexCaptures(mainShots);
  }
  const mainWeb = join(TEMPLATE_ROOT, 'public', 'main', 'webapp');
  const webDist = join(runDir, 'dist-web-dom');
  if (existsSync(webDist) && !existsSync(join(mainWeb, 'index.html'))) {
    const zip = readdirSync(webDist).find((n) => n.endsWith('.zip'));
    if (zip) {
      rmSync(mainWeb, { recursive: true, force: true });
      unzipInto(join(webDist, zip), mainWeb);
    }
  }
  specs.push({
    id: 'main',
    label: branch,
    ref: branch,
    commit: run.head_sha,
    development: true,
    screenshots: mainShots,
    downloads: runDir,
    runURL: run.html_url,
  });

  await generateSite(projectRoot, siteDir, specs, { repo });
}

if (!flag('no-serve')) {
  execFileSync('npx', ['astro', 'dev'], { cwd: TEMPLATE_ROOT, stdio: 'inherit' });
}
