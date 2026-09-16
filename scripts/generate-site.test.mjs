// Tests for scripts/generate-site.mjs and the per-channel options it drives — `npm test`.
//
// What is under test is the split between the two build channels (src/lib/channels.ts): each one
// has to write its own appindex, its own gallery manifest, and its own copies of the served
// files, under its own URL prefix. Get the prefix wrong in one of the three and the channels
// overwrite each other's data — a failure that shows up as the release pages quietly serving the
// development build's screenshots, which no page render would flag.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateSite } from './generate-site.mjs';
import { releaseAssetName } from './generate-appindex.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/**
 * A minimal Day project plus two capture trees and a directory of packed artifacts, so a run
 * exercises both channels' inputs. `publicDir` is a temp directory rather than the template's
 * own `public/`, so a test run cannot clobber a working preview's generated files.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'daysite-channels-'));
  const pub = join(root, 'public');
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  writeFileSync(
    join(project, 'Day.toml'),
    '[app]\nid = "dev.example.demo"\ntitle = "Demo"\ntargets = ["macos-appkit", "ios-uikit"]\n',
  );
  writeFileSync(join(project, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "1.2.3"\n');
  writeFileSync(join(site, 'site.toml'), 'host = "https://example.test/Demo"\n');

  const shot = (tree, target, name) => {
    mkdirSync(join(root, tree, target, 'default'), { recursive: true });
    writeFileSync(join(root, tree, target, 'default', `${name}.png`), PNG);
  };
  shot('rel-shots', 'macos-appkit', 'home');
  shot('main-shots', 'macos-appkit', 'home');
  shot('main-shots', 'ios-uikit', 'scratch');

  // What `actions/download-artifact` leaves behind: one directory per artifact, packages beside
  // the provenance sidecars that describe them.
  const dist = join(root, 'dist-in', 'dist-macos-appkit');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'demo-macos-appkit.dmg'), 'dmg');
  writeFileSync(join(dist, 'demo-macos-appkit.dmg.sbom-cdx.json'), '{}');
  const ipa = join(root, 'dist-in', 'dist-ios-uikit');
  mkdirSync(ipa, { recursive: true });
  // What a run without signing secrets packs, spelled the way `day pack` spells it.
  writeFileSync(join(ipa, 'Demo-ios-uikit-unsigned.ipa'), 'ipa');

  writeFileSync(
    join(root, 'release-assets.json'),
    JSON.stringify([{ name: 'demo-macos-appkit.dmg', size: 10 }]),
  );

  return {
    root,
    project,
    site,
    pub,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const bothChannels = (f) => [
  {
    id: 'release',
    label: '1.2.3',
    tag: 'v1.2.3',
    screenshots: join(f.root, 'rel-shots'),
    releaseAssets: join(f.root, 'release-assets.json'),
  },
  {
    id: 'main',
    label: 'main',
    ref: 'main',
    commit: 'abcdef1234567890',
    development: true,
    screenshots: join(f.root, 'main-shots'),
    downloads: join(f.root, 'dist-in'),
  },
];

test('the release owns the locale root and main lives one segment deeper', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const out = await generateSite(f.project, f.site, bothChannels(f), {
    repo: 'example/Demo',
    publicDir: f.pub,
    quiet: true,
  });
  assert.equal(out.default, 'release');
  assert.deepEqual(out.channels.map((c) => c.path), ['', 'main']);
  assert.deepEqual(out.channels.map((c) => c.webapp), ['webapp', 'main/webapp']);
  assert.equal(out.channels[0].releaseURL, 'https://github.com/example/Demo/releases/tag/v1.2.3');
  // A full sha is recorded short, and linked whole.
  assert.equal(out.channels[1].commit, 'abcdef1');
  assert.equal(out.channels[1].commitURL, 'https://github.com/example/Demo/commit/abcdef1234567890');
  // Neither channel claims an alias: `/en/main/` is a real page here, not a redirect.
  assert.ok(out.channels.every((c) => !c.alias));
});

test("each channel's data files and served images stay under its own prefix", async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  await generateSite(f.project, f.site, bothChannels(f), { repo: 'example/Demo', publicDir: f.pub, quiet: true });

  for (const name of ['appindex.json', 'gallery-manifest.json']) {
    assert.ok(existsSync(join(f.site, name)), `the release channel must write ${name}`);
    assert.ok(existsSync(join(f.site, 'main', name)), `the development channel must write main/${name}`);
  }
  assert.ok(existsSync(join(f.pub, 'gallery/macos-appkit/default/home.png')));
  assert.ok(existsSync(join(f.pub, 'main/gallery/macos-appkit/default/home.png')));

  // The manifests point at their own copies, and the second channel's capture that the release
  // never had appears only there.
  const rel = JSON.parse(readFileSync(join(f.site, 'gallery-manifest.json'), 'utf8'));
  const main = JSON.parse(readFileSync(join(f.site, 'main', 'gallery-manifest.json'), 'utf8'));
  const srcs = (m) => m.shots.flatMap((s) => Object.values(s.byPlatform).flatMap((v) => Object.values(v).map((c) => c.src)));
  assert.ok(srcs(rel).every((s) => s.startsWith('gallery/')), srcs(rel).join(', '));
  assert.ok(srcs(main).every((s) => s.startsWith('main/gallery/')), srcs(main).join(', '));
  assert.deepEqual(rel.shots.map((s) => s.id), ['home']);
  assert.deepEqual(main.shots.map((s) => s.id).sort(), ['home', 'scratch']);
});

test('a release links its assets on GitHub; a branch build serves packages from the site', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  await generateSite(f.project, f.site, bothChannels(f), { repo: 'example/Demo', publicDir: f.pub, quiet: true });

  const arts = (file) => {
    const idx = JSON.parse(readFileSync(join(f.site, file), 'utf8'));
    return Object.fromEntries(
      Object.entries(idx.apps[0].platforms).map(([k, v]) => [k, (v.artifacts ?? []).map((a) => a.url)]),
    );
  };
  assert.deepEqual(arts('appindex.json').macos, [
    'https://github.com/example/Demo/releases/latest/download/demo-macos-appkit.dmg',
  ]);
  const dev = arts('main/appindex.json');
  assert.deepEqual(dev.macos, ['main/downloads/demo-macos-appkit.dmg']);
  // Packed by a run with no signing secrets, and named the way the release asset would be: the
  // `-unsigned` marker is gone, so the link is the one a signed run would produce.
  assert.deepEqual(dev.ios, ['main/downloads/demo-ios-uikit.ipa']);
  assert.ok(existsSync(join(f.pub, 'main/downloads/demo-macos-appkit.dmg')));
  // A provenance sidecar describes a download; it is not one, so it is not served.
  assert.ok(!existsSync(join(f.pub, 'main/downloads/demo-macos-appkit.dmg.sbom-cdx.json')));
});

test('with no release, main owns the locale root and keeps its segment as an alias', async (t) => {
  const f = fixture();
  t.after(f.cleanup);
  const out = await generateSite(f.project, f.site, [bothChannels(f)[1]], {
    repo: 'example/Demo',
    publicDir: f.pub,
    quiet: true,
  });
  assert.equal(out.default, 'main');
  assert.deepEqual(out.channels.map((c) => [c.path, c.alias]), [['', 'main']]);
  assert.equal(out.channels[0].webapp, 'webapp');
  assert.equal(out.channels[0].appindex, 'appindex.json');
  // The site is one channel, so its downloads sit at the root prefix too.
  assert.ok(existsSync(join(f.pub, 'downloads/demo-macos-appkit.dmg')));
});

test('the first release moves the branch build, and its old prefix stops being served', async (t) => {
  // Before a project's first release the branch build owns the locale root, so its packages and
  // screenshots sit at `downloads/` and `gallery/`. The release then takes that root and pushes
  // the branch build down to `main/`. Whatever the old layout left behind is copied into every
  // later deploy unless this run removes it.
  const f = fixture();
  t.after(f.cleanup);
  await generateSite(f.project, f.site, [bothChannels(f)[1]], {
    repo: 'example/Demo',
    publicDir: f.pub,
    quiet: true,
  });
  assert.ok(existsSync(join(f.pub, 'downloads/demo-macos-appkit.dmg')));

  await generateSite(f.project, f.site, bothChannels(f), {
    repo: 'example/Demo',
    publicDir: f.pub,
    quiet: true,
  });
  assert.ok(existsSync(join(f.pub, 'main/downloads/demo-macos-appkit.dmg')));
  assert.ok(!existsSync(join(f.pub, 'downloads')), 'the vacated prefix must not still be served');
});

test('a packed name becomes the name the release asset would have', () => {
  assert.equal(releaseAssetName('Day Skies.dmg'), 'day-skies.dmg');
  assert.equal(releaseAssetName('Demo-unsigned.ipa'), 'demo.ipa');
  assert.equal(releaseAssetName('demo-android-mdc.aab'), 'demo-android-mdc.aab');
});
