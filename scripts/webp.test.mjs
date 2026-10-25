import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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
  assert.deepEqual(r, { made: 0, png: 0, webp: 0, unreadable: [] });
});

test('an unreadable PNG is named and skipped, and the rest still get their WebP', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'daysite-webp-bad-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sharp = (await import('sharp')).default;
  mkdirSync(join(root, 'android-material/dark'), { recursive: true });
  for (const name of ['home.png', 'solitaire-flight.png']) {
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#c04080' } })
      .png({ compressionLevel: 0 })
      .toFile(join(root, 'android-material/dark', name));
  }
  // What CI's capture held: one flipped byte inside the image data, so its chunk's CRC fails.
  const bad = join(root, 'android-material/dark/solitaire-flight.png');
  const bytes = readFileSync(bad);
  const idat = bytes.indexOf('IDAT');
  bytes[idat + 40] ^= 0xff;
  writeFileSync(bad, bytes);
  const warned = [];
  t.mock.method(console, 'warn', (line) => warned.push(line));

  const r = await webpTree(root, { concurrency: 2 });
  assert.equal(r.made, 1);
  assert.ok(existsSync(join(root, 'android-material/dark/home.webp')));
  assert.ok(!existsSync(join(root, 'android-material/dark/solitaire-flight.webp')));
  assert.deepEqual(r.unreadable.map((u) => u.file), ['android-material/dark/solitaire-flight.png']);
  assert.ok(r.unreadable[0].reason.length > 0);
  assert.equal(warned.length, 1);
  assert.match(warned[0], /^::warning::android-material\/dark\/solitaire-flight\.png: /);
});
