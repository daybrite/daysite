import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { optimizeLevel, optimizePNGs } from './optimize-png.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A site with one gallery capture, an icon, and a hosted web app; and an optimizer that
 *  halves every file it is given. */
function site() {
  const root = mkdtempSync(join(tmpdir(), 'daysite-png-'));
  const bin = join(root, 'oxipng');
  writeFileSync(bin, `#!/bin/sh
[ "$1" = --version ] && exit 0
for f in "$@"; do case "$f" in *.png) head -c 4 "$f" > "$f.tmp" && mv "$f.tmp" "$f";; esac; done
`);
  chmodSync(bin, 0o755);
  const dist = join(root, 'dist');
  for (const dir of ['gallery/ios-uikit/ipad/light', 'gallery/macos-appkit/dark', 'app', 'webapp']) {
    mkdirSync(join(dist, dir), { recursive: true });
  }
  writeFileSync(join(dist, 'gallery/ios-uikit/ipad/light/home.png'), '12345678');
  writeFileSync(join(dist, 'gallery/macos-appkit/dark/home.png'), 'abcdefgh');
  writeFileSync(join(dist, 'app/icon.png'), 'ICONICON');
  writeFileSync(join(dist, 'webapp/logo.png'), 'WEBAPPXX');
  const entry = (platform, device, variant, text) => ({
    platform, device, variant, file: 'home.png', bytes: 8, sha256: sha(text),
  });
  writeFileSync(join(dist, 'gallery/gallery.json'), JSON.stringify({
    screenshots: [entry('ios-uikit', 'ipad', 'light', '12345678'), entry('macos-appkit', null, 'dark', 'abcdefgh')],
  }));
  return { dist, bin };
}

test('every PNG outside the web app is optimized and the index describes the new files', async () => {
  const { dist, bin } = site();
  const result = await optimizePNGs(dist, { skips: [join(dist, 'webapp')], bin });
  assert.deepEqual(result, { files: 3, before: 24, after: 12 });
  assert.equal(readFileSync(join(dist, 'app/icon.png'), 'utf8'), 'ICON');
  assert.equal(readFileSync(join(dist, 'webapp/logo.png'), 'utf8'), 'WEBAPPXX');
  const index = JSON.parse(readFileSync(join(dist, 'gallery/gallery.json'), 'utf8'));
  assert.deepEqual(index.screenshots.map((e) => [e.bytes, e.sha256]), [[4, sha('1234')], [4, sha('abcd')]]);
});

test('a missing optimizer leaves the site as built', async () => {
  const { dist } = site();
  const warnings = [];
  const result = await optimizePNGs(dist, { bin: join(dist, 'no-such-oxipng'), warn: (m) => warnings.push(m) });
  assert.equal(result, null);
  assert.match(warnings[0], /is not installed/);
  assert.equal(readFileSync(join(dist, 'app/icon.png'), 'utf8'), 'ICONICON');
});

test('the setting is off unless it is true or an oxipng level', () => {
  assert.deepEqual([true, 0, 2, 6].map(optimizeLevel), [1, 0, 2, 6]);
  assert.deepEqual([undefined, false, 7, 'yes', 1.5].map(optimizeLevel), [null, null, null, null, null]);
});
