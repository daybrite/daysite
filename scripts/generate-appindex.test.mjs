// The `[store]` table (Day.toml, docs/store.md "Listed apps") → the listing URLs the site links.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseGithubRepo, permissionsByPlatform, readReleaseAssets, storeListing } from './generate-appindex.mjs';

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

// Day app scaffolds share one version across all workspace crates.
test('inherited package versions render as a version string, never an object', async () => {
  const { cargoVersion } = await import('./generate-appindex.mjs');
  assert.equal(cargoVersion({ package: { version: '1.2.3' } }), '1.2.3');
  assert.equal(cargoVersion({ package: { version: { workspace: true } }, workspace: { package: { version: '2.0.1' } } }), '2.0.1');
  assert.equal(cargoVersion({ package: { version: { workspace: true } } }), undefined);
});
