// The `[store]` table (Day.toml, docs/store.md "Listed apps") → the listing URLs the site links.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateAppIndex, localizedText, parseGithubRepo, permissionsByPlatform, readReleaseAssets, readStorefront, storeListing } from './generate-appindex.mjs';

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
