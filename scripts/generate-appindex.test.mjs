// The `[store]` table (Day.toml, docs/store.md "Listed apps") → the listing URLs the site links.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { aboutSource, generateAppIndex, localizedText, parseGithubRepo, permissionsByPlatform, readReleaseAssets, readStorefront, renderAbout, storeListing } from './generate-appindex.mjs';

test('an unlisted app has no store links', () => {
  assert.deepEqual(storeListing(undefined), {});
  assert.deepEqual(storeListing({}), {});
  assert.deepEqual(storeListing({ 'apple-app-id': '  ' }), {});
});

test('each store id resolves to its listing URL independently', () => {
  assert.deepEqual(storeListing({ 'apple-app-id': '6802801331' }), {
    apple: { id: '6802801331', url: 'https://apps.apple.com/app/id6802801331' },
  });
  assert.deepEqual(storeListing({ 'google-play-id': 'dev.daybrite.showcase' }), {
    google: {
      id: 'dev.daybrite.showcase',
      url: 'https://play.google.com/store/apps/details?id=dev.daybrite.showcase',
    },
  });
});

test('both stores at once, ids trimmed', () => {
  const both = storeListing({ 'apple-app-id': ' 1 ', 'google-play-id': ' a.b ' });
  assert.equal(both.apple.url, 'https://apps.apple.com/app/id1');
  assert.equal(both.google.url, 'https://play.google.com/store/apps/details?id=a.b');
});

test('release assets come from the file the workflow writes, in either shape', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daysite-assets-'));
  const list = join(dir, 'list.json');
  writeFileSync(list, JSON.stringify([{ name: 'App-macos-appkit.dmg', size: 12 }, { size: 1 }]));
  assert.deepEqual(readReleaseAssets(list), [{ name: 'App-macos-appkit.dmg', size: 12 }]);
  const release = join(dir, 'release.json');
  writeFileSync(release, JSON.stringify({ tag_name: 'v1', assets: [{ name: 'a.apk', size: '7' }] }));
  assert.deepEqual(readReleaseAssets(release), [{ name: 'a.apk', size: 7 }]);
});

test('no file, a missing file, or a non-JSON file means no release data, never a throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daysite-assets-'));
  const empty = join(dir, 'empty.json');
  writeFileSync(empty, '');
  const notes = [];
  assert.deepEqual(readReleaseAssets(undefined, (m) => notes.push(m)), []);
  assert.deepEqual(readReleaseAssets(join(dir, 'absent.json'), (m) => notes.push(m)), []);
  assert.deepEqual(readReleaseAssets(empty, (m) => notes.push(m)), []);
  assert.equal(notes.length, 2);
});

test('a GitHub remote in any spelling names the repository', () => {
  for (const url of [
    'https://github.com/daybrite/Day-Showcase.git\n',
    'git@github.com:daybrite/Day-Showcase.git',
    'ssh://git@github.com/daybrite/Day-Showcase',
    'https://github.com/daybrite/Day-Showcase/',
  ]) assert.equal(parseGithubRepo(url), 'daybrite/Day-Showcase', url);
  assert.equal(parseGithubRepo('https://gitlab.com/x/y.git'), undefined);
  assert.equal(parseGithubRepo(''), undefined);
});

test('permissions fan out to each platform with their reasons per locale', () => {
  const metadata = {
    project: {
      permissions: [
        {
          name: 'camera', android: ['android.permission.CAMERA'], ios: ['NSCameraUsageDescription'],
          macos: ['NSCameraUsageDescription'], ohos: ['ohos.permission.CAMERA'],
          reasons: { en: 'Scan.', fr: 'Scanner.' },
        },
        { name: 'notifications', android: ['android.permission.POST_NOTIFICATIONS'], ios: [], macos: [], ohos: [], reasons: {} },
      ],
      rawPermissions: {
        android: ['android.permission.READ_CONTACTS'],
        ios: { NSBluetoothAlwaysUsageDescription: { reasons: { en: 'Find your lock.' } } },
        macos: {},
        ohos: [{ name: 'ohos.permission.READ_CONTACTS', when: 'inuse', reasons: { en: 'Friends.' } }],
      },
    },
  };
  const by = permissionsByPlatform(metadata);
  assert.deepEqual(by.android.map((e) => e.key), ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS', 'android.permission.READ_CONTACTS']);
  assert.equal(by.android[0].description, undefined, 'Android takes no reason');
  assert.deepEqual(by.ios, [
    { key: 'NSBluetoothAlwaysUsageDescription', description: { en: 'Find your lock.' } },
    { key: 'NSCameraUsageDescription', description: { en: 'Scan.', fr: 'Scanner.' } },
  ]);
  assert.deepEqual(by.macos, [{ key: 'NSCameraUsageDescription', description: { en: 'Scan.', fr: 'Scanner.' } }]);
  assert.deepEqual(by.harmony.map((e) => e.key), ['ohos.permission.CAMERA', 'ohos.permission.READ_CONTACTS']);
  assert.deepEqual(permissionsByPlatform(undefined), {});
});

/** A `day store export` document, trimmed to what the generator reads. */
function storefrontDoc() {
  return {
    schema: 1,
    project: {
      name: 'demo', id: 'dev.example.demo', title: 'Demo', version: '1.2.3', build: 7,
      targets: ['ios-uikit', 'android-mdc', 'macos-appkit'],
      store: { 'apple-app-id': '42', 'google-play-id': 'dev.example.demo' },
    },
    'default-locale': 'en',
    locales: ['en', 'fr'],
    storefront: {
      file: 'store/storefront.toml',
      metadata: {
        en: { name: 'Demo', subtitle: 'A demo', description: 'What it does.', keywords: ['a', 'b'], 'release-notes': 'First.', 'privacy-url': 'https://x/p', 'support-url': 'https://x/s' },
        fr: { name: 'Démo', subtitle: 'A demo', description: 'Ce que ça fait.', keywords: ['a', 'b'], 'release-notes': 'First.', 'privacy-url': 'https://x/p', 'support-url': 'https://x/s' },
      },
      targets: {
        'ios-uikit': {
          stores: { 'apple-app-store': { 'submission-info': { 'bundle-id': 'com.example.store' }, metadata: {}, screenshots: {} } },
        },
      },
    },
    permissions: [{ name: 'camera', android: ['android.permission.CAMERA'], ios: ['NSCameraUsageDescription'], macos: [], ohos: [], reasons: { en: 'Scan.' } }],
    rawPermissions: {},
  };
}

test('the localized text comes from the storefront export, one map per field', () => {
  const text = localizedText(storefrontDoc());
  assert.deepEqual(text.title, { en: 'Demo', fr: 'Démo' });
  assert.deepEqual(text.description, { en: 'What it does.', fr: 'Ce que ça fait.' });
  assert.deepEqual(text.keywords.fr, ['a', 'b']);
  assert.deepEqual(text.links, { privacy: { en: 'https://x/p', fr: 'https://x/p' }, support: { en: 'https://x/s', fr: 'https://x/s' } });
  assert.deepEqual(localizedText({}).title, {});
});

test('the storefront document is read from a file, and anything else is refused by name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'daysite-storefront-'));
  const good = join(dir, 'storefront.json');
  writeFileSync(good, JSON.stringify(storefrontDoc()));
  assert.equal(readStorefront(dir, good).project.id, 'dev.example.demo');
  const metadata = join(dir, 'metadata.json');
  writeFileSync(metadata, JSON.stringify({ project: { permissions: [] } }));
  assert.throws(() => readStorefront(dir, metadata), /not a `day store export` document/);
  assert.throws(() => readStorefront(dir, join(dir, 'absent.json')), /could not be read/);
  // No file and no CLI: the site cannot be generated, and the message says what to set.
  const bin = process.env.DAY_BIN;
  process.env.DAY_BIN = join(dir, 'no-such-day');
  try {
    assert.throws(() => readStorefront(dir, undefined), /DAY_BIN|--storefront/);
  } finally {
    if (bin === undefined) delete process.env.DAY_BIN;
    else process.env.DAY_BIN = bin;
  }
});

test('the appindex is generated from the storefront export alone', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-appindex-'));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const doc = join(root, 'storefront.json');
  writeFileSync(doc, JSON.stringify(storefrontDoc()));
  const index = await generateAppIndex(project, site, { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true });
  const app = index.apps[0];
  assert.deepEqual(app.title, { en: 'Demo', fr: 'Démo' });
  assert.deepEqual(app.keywords, { en: ['a', 'b'], fr: ['a', 'b'] });
  assert.equal(app.links.privacy.fr, 'https://x/p');
  assert.equal(app.platforms.ios.bundleIdentifier, 'com.example.store', 'the store record\'s id');
  assert.equal(app.platforms.android.applicationId, 'dev.example.demo');
  assert.equal(app.platforms.ios.version, '1.2.3');
  assert.equal(app.platforms.ios.buildNumber, '7');
  assert.equal(app.platforms.ios.channels.appleappstore.url, 'https://apps.apple.com/app/id42');
  assert.deepEqual(app.platforms.ios.permissions, [{ key: 'NSCameraUsageDescription', description: { en: 'Scan.' } }]);
  assert.equal(app.platforms.macos.permissions, undefined);
  assert.equal(JSON.parse(readFileSync(join(site, 'appindex.json'), 'utf8')).apps[0].name, 'Demo');
  // A tag names the released version; the build number stays only while it is the source's.
  const tagged = await generateAppIndex(project, site, { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true, tag: 'v1.3.0' });
  assert.equal(tagged.apps[0].platforms.ios.version, '1.3.0');
  assert.equal(tagged.apps[0].platforms.ios.buildNumber, undefined);
});

test("a release's launchers are recorded pinned to its tag, and a release without them has none", async () => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-appindex-'));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const doc = join(root, 'storefront.json');
  writeFileSync(doc, JSON.stringify(storefrontDoc()));
  const assets = join(root, 'release-assets.json');
  writeFileSync(assets, JSON.stringify([
    { name: 'demo-macos-appkit.dmg', size: 1 },
    { name: 'launch.sh', size: 1 },
    { name: 'launch.ps1', size: 1 },
  ]));
  const opts = { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true, tag: 'v1.3.0' };
  const index = await generateAppIndex(project, site, { ...opts, releaseAssets: assets });
  assert.deepEqual(index.apps[0].launch, {
    sh: 'https://github.com/example/Demo/releases/download/v1.3.0/launch.sh',
    ps1: 'https://github.com/example/Demo/releases/download/v1.3.0/launch.ps1',
  });
  // The launchers are not packages: no platform lists them as a download.
  const listed = Object.values(index.apps[0].platforms).flatMap((p) => (p.artifacts ?? []).map((a) => a.name));
  assert.ok(!listed.some((n) => n.startsWith('launch.')), listed.join(', '));

  writeFileSync(assets, JSON.stringify([{ name: 'demo-macos-appkit.dmg', size: 1 }]));
  const without = await generateAppIndex(project, site, { ...opts, releaseAssets: assets });
  assert.equal(without.apps[0].launch, undefined);
});

test('a declaration whose lists are all empty is treated as none, so every capture shows', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-empty-listing-'));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const doc = join(root, 'storefront.json');
  writeFileSync(doc, JSON.stringify(storefrontDoc()));
  // What an older CLI wrote for a target with a submission table and no screenshot lists.
  const manifest = {
    listings: { 'ios-uikit': { website: { iphone: { en: [] } } } },
    themes: ['default'], locales: ['default'],
    platforms: ['ios-uikit'],
    shots: [{ id: 'home', title: { en: 'Home' }, byPlatform: { 'ios-uikit': { default: { src: 'gallery/ios-uikit/default/home.png', width: 10, height: 20 } } } }],
  };
  writeFileSync(join(site, 'gallery-manifest.json'), JSON.stringify(manifest));
  const index = await generateAppIndex(project, site, { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true });
  const shots = index.apps[0].platforms.ios.assets.screenshots;
  assert.deepEqual(Object.keys(shots), ['en']);
  assert.equal(shots.en[0].location, 'gallery/ios-uikit/default/home.png');
});

test('a target captured on two device panels gets one row per panel, the phone first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-harmony-rows-'));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const doc = join(root, 'storefront.json');
  const storefront = storefrontDoc();
  storefront.project.targets.push('harmony-arkui');
  writeFileSync(doc, JSON.stringify(storefront));
  // The HarmonyOS legs: one Oniro image on a phone panel and a landscape tablet panel, each its
  // own column (`harmony-arkui/<slug>`), arriving tablet first here on purpose.
  const shot = (device, w, h) => ({ src: `gallery/harmony-arkui/${device}/default/home.png`, width: w, height: h });
  const manifest = {
    themes: ['default'], locales: ['default'],
    platforms: ['harmony-arkui/tablet', 'harmony-arkui/phone'],
    shots: [{ id: 'home', title: { en: 'Home' }, byPlatform: {
      'harmony-arkui/tablet': { default: shot('tablet', 1280, 800) },
      'harmony-arkui/phone': { default: shot('phone', 360, 720) },
    } }],
  };
  writeFileSync(join(site, 'gallery-manifest.json'), JSON.stringify(manifest));
  const index = await generateAppIndex(project, site, { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true });
  const harmony = index.apps[0].platforms.harmony.assets;
  assert.deepEqual(harmony.screenshotRows.map((r) => r.device), ['phone', 'tablet']);
  assert.equal(harmony.screenshotRows[0].screenshots.en[0].location, 'gallery/harmony-arkui/phone/default/home.png');
  assert.equal(harmony.screenshotRows[1].screenshots.en[0].location, 'gallery/harmony-arkui/tablet/default/home.png');
  // `screenshots` stays the first row, for readers that know only the schema.
  assert.equal(harmony.screenshots.en[0].location, 'gallery/harmony-arkui/phone/default/home.png');
});

test('the two Windows targets are two platform entries, each with its own captures and packages', async () => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-windows-'));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const doc = join(root, 'storefront.json');
  const storefront = storefrontDoc();
  storefront.project.targets.push('windows-winui', 'windows-xaml');
  writeFileSync(doc, JSON.stringify(storefront));
  const shot = (target) => ({ src: `gallery/${target}/default/home.png`, width: 1280, height: 800 });
  const manifest = {
    themes: ['default'], locales: ['default'],
    platforms: ['windows-winui', 'windows-xaml'],
    shots: [{ id: 'home', title: { en: 'Home' }, byPlatform: {
      'windows-winui': { default: shot('windows-winui') },
      'windows-xaml': { default: shot('windows-xaml') },
    } }],
  };
  writeFileSync(join(site, 'gallery-manifest.json'), JSON.stringify(manifest));
  const assets = join(root, 'release-assets.json');
  writeFileSync(assets, JSON.stringify([
    { name: 'demo-windows-winui-setup.exe', size: 1 },
    { name: 'demo-windows-winui.msix', size: 2 },
    { name: 'demo-windows-xaml-setup.exe', size: 3 },
    { name: 'launch.ps1', size: 1 },
  ]));
  const opts = { storefront: doc, repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true, tag: 'v2.0.0' };
  const index = await generateAppIndex(project, site, { ...opts, releaseAssets: assets });
  const { windows, 'windows-xaml': xaml } = index.apps[0].platforms;
  // WinUI 3 holds the conventional `windows` key; the deprecated build has one of its own.
  assert.equal(windows.platform, 'windows-winui');
  assert.equal(xaml.platform, 'windows-xaml');
  assert.equal(windows.assets.screenshots.en[0].location, 'gallery/windows-winui/default/home.png');
  assert.equal(xaml.assets.screenshots.en[0].location, 'gallery/windows-xaml/default/home.png');
  assert.deepEqual(windows.artifacts.map((a) => a.name).sort(), ['demo-windows-winui-setup.exe', 'demo-windows-winui.msix']);
  assert.deepEqual(xaml.artifacts.map((a) => a.name), ['demo-windows-xaml-setup.exe']);

  // An app that still ships only the XAML build appears under `windows-xaml` alone.
  storefront.project.targets = ['windows-xaml'];
  writeFileSync(doc, JSON.stringify(storefront));
  const only = await generateAppIndex(project, site, { ...opts, releaseAssets: assets });
  assert.deepEqual(Object.keys(only.apps[0].platforms), ['windows-xaml']);
  assert.equal(only.apps[0].platforms['windows-xaml'].artifacts.length, 1);
});

/** A project whose listing text has no description in any locale, beside a storefront with one. */
function aboutFixture(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const project = join(root, 'app');
  const site = join(project, 'website');
  mkdirSync(site, { recursive: true });
  const withDescription = join(root, 'storefront.json');
  writeFileSync(withDescription, JSON.stringify(storefrontDoc()));
  const bare = storefrontDoc();
  for (const fields of Object.values(bare.storefront.metadata)) delete fields.description;
  const withoutDescription = join(root, 'storefront-bare.json');
  writeFileSync(withoutDescription, JSON.stringify(bare));
  const opts = { repo: 'example/Demo', publicDir: join(root, 'public'), quiet: true };
  return { root, project, site, withDescription, withoutDescription, opts };
}

test('an explicit about file is rendered under the default locale, H1 dropped, relative links on GitHub', async () => {
  const { root, project, site, withDescription, opts } = aboutFixture('daysite-about-');
  // A monorepo: the git repository is the temp root, the Day project a subdirectory, and the
  // about file climbs out of the project to the repository's own README.
  execFileSync('git', ['-C', root, 'init', '-q', '-b', 'trunk']);
  mkdirSync(join(root, '.github'));
  writeFileSync(join(root, '.github', 'README.md'), [
    '<p align="center"><a href="https://example.test/"><img src="docs/logo.png" alt="The logo"></a></p>',
    '',
    '# Demo',
    '',
    'What it does, at length. See the [guide](../docs/guide.md#start), the [root file](/LICENSE),',
    'the [site](https://example.test/) and [below](#details).',
    '',
    '## Details',
    '',
    '- one',
    '- two',
    '',
    '![A capture](shots/home.png) and <img src="https://cdn.example.test/x.png" alt="">',
    '',
    '```rust',
    'fn main() {}',
    '```',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n'));
  const index = await generateAppIndex(project, site, { ...opts, storefront: withDescription, about: '../.github/README.md' });
  const app = index.apps[0];
  assert.deepEqual(Object.keys(app.about), ['en'], 'the default locale alone');
  const html = app.about.en;
  assert.ok(!/<h1\b/.test(html), 'the leading H1 is dropped');
  assert.ok(html.includes('<h2 id="details">Details</h2>'), 'later headings stay');
  assert.ok(html.includes('<li>one</li>'));
  assert.ok(html.includes('<table>'), 'GFM tables render');
  assert.ok(html.includes('<pre><code class="language-rust">'), 'code blocks render, without inlined highlight colors');
  // Links: resolved against the file's directory in the repository, root-relative kept at the root.
  assert.ok(html.includes('href="https://github.com/example/Demo/blob/trunk/docs/guide.md#start"'), html);
  assert.ok(html.includes('href="https://github.com/example/Demo/blob/trunk/LICENSE"'), html);
  assert.ok(html.includes('href="https://example.test/"'), 'absolute links stay');
  assert.ok(html.includes('href="#details"'), 'anchors stay');
  // Images: the site loads nothing from another origin, so each becomes a link with its alt text.
  assert.ok(!/<img\b/.test(html), 'no image element survives');
  assert.ok(html.includes('<a href="https://raw.githubusercontent.com/example/Demo/trunk/.github/shots/home.png"><em>A capture</em></a>'), html);
  assert.ok(html.includes('<a href="https://cdn.example.test/x.png"><em>x.png</em></a>'), 'an empty alt falls back to the file name');
  assert.ok(html.includes('<a href="https://example.test/"><em>The logo</em></a>'), 'an image that is a link keeps the link');
  // The description still ships beside it; the page decides which to show.
  assert.equal(app.description.en, 'What it does.');
});

test('without an about file, a listing with no description text falls back to README.md', async () => {
  const { project, site, withDescription, withoutDescription, opts } = aboutFixture('daysite-about-readme-');
  writeFileSync(join(project, 'README.md'), '# Demo\n\nFrom the README.\n');
  const notes = [];
  const index = await generateAppIndex(project, site, { ...opts, storefront: withoutDescription });
  assert.equal(index.apps[0].description, undefined);
  assert.equal(index.apps[0].about.en, '<p>From the README.</p>');
  // The source says which file it chose, and why.
  assert.equal(aboutSource(project, undefined, false, (m) => notes.push(m)).path, join(project, 'README.md'));
  assert.match(notes[0], /README\.md .*no description/);
  // A listing with a description keeps it: no README fallback.
  const kept = await generateAppIndex(project, site, { ...opts, storefront: withDescription });
  assert.equal(kept.apps[0].about, undefined);
  assert.equal(kept.apps[0].description.en, 'What it does.');
  assert.equal(aboutSource(project, undefined, true, (m) => notes.push(m)), undefined);
  assert.equal(notes.length, 1, 'nothing to say when the listing has its description');
});

test('no description and no README is no About text, said in the log; a missing explicit file is an error', async () => {
  const { project, site, withoutDescription, opts } = aboutFixture('daysite-about-none-');
  const notes = [];
  assert.equal(aboutSource(project, undefined, false, (m) => notes.push(m)), undefined);
  assert.match(notes[0], /none/);
  const index = await generateAppIndex(project, site, { ...opts, storefront: withoutDescription });
  assert.equal(index.apps[0].about, undefined);
  await assert.rejects(
    generateAppIndex(project, site, { ...opts, storefront: withoutDescription, about: 'docs/about.md' }),
    /about file docs\/about\.md does not exist .*relative to the directory holding Day\.toml/,
  );
});

test('an about file outside any repository, or without a known repository, keeps its relative links', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'daysite-about-norepo-'));
  const file = join(dir, 'about.md');
  writeFileSync(file, '# T\n\nSee [docs](docs/x.md).\n');
  const notes = [];
  const html = await renderAbout(file, { repo: undefined, log: (m) => notes.push(m) });
  assert.equal(html, '<p>See <a href="docs/x.md">docs</a>.</p>');
  assert.match(notes[0], /relative links left as they are/);
});
