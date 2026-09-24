// Generate the bundled sample's data from the current Day Showcase.
//
// The template builds against samples/site.toml when no other site.toml is configured, and the
// app that config describes is Day Showcase as it is on its main branch right now — nothing
// about the app is committed here, so the sample can never drift from the app it shows:
//
//   1. a shallow clone of Day-Showcase at main (or the checkout SHOWCASE_DIR names), into
//      samples/.showcase/, which is ignored and rebuilt on every run;
//   2. `day store export` over that clone — the identity, the listing text, the store records
//      and the permission reasons the generator reads — and `day icon build`, for the png
//      family the favicon set is copied from;
//   3. a few of the screenshots the Showcase's own site publishes for its main build: its
//      gallery.json, cut down to the first SAMPLE_SHOTS titled screens (2 by default) in every
//      locale and theme, and just those images, each checked against the index's sha-256;
//   4. the same two generators CI runs for a real repository, which write appindex.json and
//      gallery-manifest.json beside samples/site.toml.
//
// Needs git, network access, and a day CLI: DAY_BIN, else `day` on PATH.
//
// Usage: node scripts/sample.mjs
//        SHOWCASE_DIR=../Day-Showcase node scripts/sample.mjs   (a local checkout, no clone)

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseToml } from 'smol-toml';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(TEMPLATE_ROOT, 'samples');
const WORK = join(SAMPLES, '.showcase');
const REPO = process.env.SHOWCASE_REPO || 'https://github.com/daybrite/Day-Showcase.git';
const REF = process.env.SHOWCASE_REF || 'main';
const SHOTS = Number(process.env.SAMPLE_SHOTS || 2);
const DAY = process.env.DAY_BIN || 'day';

const log = (m) => console.log(`[sample] ${m}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

// 1. The app.
const project = process.env.SHOWCASE_DIR ? resolve(process.env.SHOWCASE_DIR) : join(WORK, 'app');
if (!process.env.SHOWCASE_DIR) {
  run('git', ['clone', '--quiet', '--depth', '1', '--branch', REF, REPO, project]);
}
const rev = execFileSync('git', ['-C', project, 'rev-parse', '--short', 'HEAD']).toString().trim();
log(`Day Showcase at ${rev} (${process.env.SHOWCASE_DIR ? project : `${REPO} ${REF}`})`);

// 2. What the CLI knows about it.
const storefront = join(WORK, 'storefront.json');
run(DAY, ['--project', project, 'store', 'export', '--out', storefront]);
run(DAY, ['--project', project, 'icon', 'build']);

// 3. A few of its published screenshots. The gallery lives on the Showcase's own site, whose
// host its website/site.toml names; `main/` is that site's development channel, the captures of
// the newest main build.
const site = parseToml(readFileSync(join(project, 'website', 'site.toml'), 'utf8'));
const indexUrl = `${String(site.host).replace(/\/+$/, '')}/main/gallery/gallery.json`;
const res = await fetch(indexUrl);
if (!res.ok) throw new Error(`${indexUrl}: HTTP ${res.status}`);
const index = await res.json();
const keep = new Set(index.shots.filter((s) => s.title).slice(0, SHOTS).map((s) => s.id));
index.shots = index.shots.filter((s) => keep.has(s.id));
index.screenshots = index.screenshots.filter((e) => keep.has(e.shot));

// assemble-gallery.mjs reads `<dir>/<platform>[/<device>]/<variant>/<file>` beside the index.
const shotsDir = join(WORK, 'screenshots');
const queue = [...index.screenshots];
const fetchOne = async (e) => {
  const r = await fetch(e.url);
  if (!r.ok) throw new Error(`${e.url}: HTTP ${r.status}`);
  const bytes = Buffer.from(await r.arrayBuffer());
  const sum = createHash('sha256').update(bytes).digest('hex');
  if (e.sha256 && sum !== e.sha256) throw new Error(`${e.url}: sha-256 ${sum}, index says ${e.sha256}`);
  const dir = join(shotsDir, e.platform, ...(e.device ? [e.device] : []), e.variant);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, e.file), bytes);
};
await Promise.all(
  Array.from({ length: 8 }, async () => {
    for (let e = queue.shift(); e; e = queue.shift()) await fetchOne(e);
  }),
);
writeFileSync(join(shotsDir, 'gallery.json'), JSON.stringify(index, null, 2));
log(`${index.screenshots.length} screenshot(s) of ${[...keep].join(', ')} from ${indexUrl}`);

// 4. The generators, as CI runs them for a real repository.
run('node', [join(TEMPLATE_ROOT, 'scripts', 'generate-appindex.mjs'), project, SAMPLES, '--storefront', storefront]);
run('node', [join(TEMPLATE_ROOT, 'scripts', 'assemble-gallery.mjs'), shotsDir, SAMPLES]);
