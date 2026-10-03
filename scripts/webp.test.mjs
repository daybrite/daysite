import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { webpTree } from './webp.mjs';

test('every PNG gets a WebP beside it with the same name, once', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-webp-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sharp = (await import('sharp')).default;
  for (const rel of ['ios-uikit/light/home.png', 'ios-uikit/dark-fr/tabs-one.png']) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    await sharp({ create: { width: 8, height: 6, channels: 3, background: '#4080c0' } }).png().toFile(join(root, rel));
  }
  const first = await webpTree(root, { concurrency: 2 });
  assert.equal(first.made, 2);
  assert.ok(existsSync(join(root, 'ios-uikit/dark-fr/tabs-one.webp')));
  assert.ok(first.webp > 0 && first.png > 0);
  const webp = join(root, 'ios-uikit/light/home.webp');
  const earlier = new Date(Date.now() - 60_000);
  utimesSync(webp, earlier, earlier);
  const second = await webpTree(root);
  assert.equal(second.made, 0);
  assert.ok(statSync(webp).mtimeMs < Date.now() - 30_000, 'an existing WebP is left alone');
});

test('a tree that was never assembled is no error', async () => {
  const r = await webpTree(join(tmpdir(), 'daysite-webp-nowhere-' + process.pid));
  assert.deepEqual(r, { made: 0, png: 0, webp: 0 });
});
