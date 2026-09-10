// The `[store]` table (Day.toml, docs/store.md "Listed apps") → the listing URLs the site links.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeListing } from './generate-appindex.mjs';

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
