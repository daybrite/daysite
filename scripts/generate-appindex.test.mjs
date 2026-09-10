// The `[store]` table (Day.toml, docs/store.md "Listed apps") → the listing URLs the site links.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readReleaseAssets, storeListing } from './generate-appindex.mjs';

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
