// Tests for scripts/assemble-gallery.mjs — `node --test scripts/`.
//
// The invariant under test: the gallery.json this template publishes describes EXACTLY the images
// it published. It was broken once in a way no build could notice — the copy loop followed the
// page's curation rule (titled shots only) while the index was passed through verbatim, so 679 of
// the Day Showcase's 2,624 indexed URLs pointed at bytes that were never uploaded, and every site
// reading the index (daybrite.dev among them) rendered them as broken images.
//
// Node's own runner and assertions, no dependency — the same rule the scripts themselves follow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleGallery } from './assemble-gallery.mjs';

/** A 1×1 PNG, with a real IHDR so `pngSize` reads it the way it reads a capture. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** One `screenshots[]` entry, shaped the way `day screenshot index` writes them. */
function entry(platform, device, variant, shot, { theme = null, locale = null } = {}) {
  const rel = device ? `${platform}/${device}` : platform;
  const path = `gallery/${rel}/${variant}/${shot}.png`;
  return {
    file: `${shot}.png`,
    path,
    url: `https://example.test/${path}`,
    shot,
    title: shot,
    caption: null,
    platform,
    device,
    os: platform.split('-')[0],
    toolkit: platform.split('-')[1],
    variant,
    theme,
    locale,
    width: 1,
    height: 1,
    bytes: PNG.length,
    sha256: 'x'.repeat(64),
  };
}

/**
 * A capture tree plus the index describing it. `ghost` entries are named by the index but have no
 * file on disk — the artifact that failed to upload.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'daysite-gallery-'));
  const shots = join(root, 'shots');
  const site = join(root, 'site');
  const out = join(root, 'out');
  mkdirSync(site, { recursive: true });

  const screenshots = [
    // A titled (curated) shot, two themes, plus a second target and a device level.
    entry('linux-gtk', null, 'light', 'home', { theme: 'light', locale: 'en' }),
    entry('linux-gtk', null, 'dark', 'home', { theme: 'dark', locale: 'en' }),
    entry('ios-uikit', 'ipad', 'light', 'home', { theme: 'light', locale: 'en' }),
    // An UNTITLED shot: no page row, but its bytes and its index entry must still be published.
    entry('linux-gtk', null, 'light', 'scratch', { theme: 'light', locale: 'en' }),
    // Named by the index, absent from the tree. Must reach neither the site nor the index.
    entry('linux-gtk', null, 'light', 'ghost', { theme: 'light', locale: 'en' }),
    // The only capture of an otherwise-fine target — dropping it must drop the target too.
    entry('windows-xaml', null, 'light', 'ghost', { theme: 'light', locale: 'en' }),
    // The only capture in the `fr` locale, likewise.
    entry('linux-gtk', null, 'light-fr', 'ghost', { theme: 'light', locale: 'fr' }),
  ];
  for (const e of screenshots) {
    if (e.shot === 'ghost') continue; // the point of the fixture
    const dir = join(shots, ...(e.device ? [e.platform, e.device] : [e.platform]), e.variant);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, e.file), PNG);
  }
  writeFileSync(
    join(shots, 'gallery.json'),
    JSON.stringify({
      generator: 'day screenshot index',
      generated: '2026-09-01T00:00:00Z',
      site: 'https://example.test',
      themes: ['light', 'dark'],
      locales: ['en', 'fr'],
      platforms: ['linux-gtk', 'ios-uikit', 'windows-xaml'],
      shots: [
        { id: 'home', title: { en: 'Home' }, caption: null, source: 'src/lib.rs' },
        { id: 'scratch', title: null, caption: null, source: null },
        { id: 'ghost', title: { en: 'Ghost' }, caption: null, source: null },
      ],
      screenshots,
    }),
  );
  return { root, shots, site, out };
}

/** Run the assembly over a fresh fixture and hand back everything it produced. */
function assemble() {
  const f = fixture();
  const manifest = assembleGallery(f.shots, f.site, { quiet: true, outImages: f.out });
  const index = JSON.parse(readFileSync(join(f.out, 'gallery.json'), 'utf8'));
  return { ...f, manifest, index, cleanup: () => rmSync(f.root, { recursive: true, force: true }) };
}

test('every URL in the published index has a published file behind it', (t) => {
  const a = assemble();
  t.after(a.cleanup);
  assert.ok(a.index.screenshots.length > 0, 'the index must not be empty');
  for (const e of a.index.screenshots) {
    // `path` is site-relative and starts with the gallery/ prefix the images are served under.
    const rel = e.path.replace(/^gallery\//, '');
    assert.ok(existsSync(join(a.out, rel)), `index names ${e.path}, which was never published`);
    assert.ok(e.url.endsWith(e.path), `${e.url} and ${e.path} disagree`);
  }
});

test('a capture the index names but the tree lacks is dropped from the index', (t) => {
  const a = assemble();
  t.after(a.cleanup);
  assert.equal(
    a.index.screenshots.filter((e) => e.shot === 'ghost').length,
    0,
    'an entry with no file must not be republished',
  );
  assert.equal(
    a.index.shots.filter((s) => s.id === 'ghost').length,
    0,
    'a shot with no surviving capture must not stay in shots[]',
  );
});

test('the vocabularies are pruned to what survived', (t) => {
  const a = assemble();
  t.after(a.cleanup);
  // windows-xaml and `fr` existed only on dropped captures.
  assert.deepEqual(a.index.platforms, ['linux-gtk', 'ios-uikit']);
  assert.deepEqual(a.index.locales, ['en']);
  // Both themes survive, in the source index's order.
  assert.deepEqual(a.index.themes, ['light', 'dark']);
});

test('an untitled shot is published and indexed, but gets no page row', (t) => {
  const a = assemble();
  t.after(a.cleanup);
  assert.ok(
    existsSync(join(a.out, 'linux-gtk/light/scratch.png')),
    'an untitled capture must still be published — the index is what other sites read',
  );
  assert.ok(
    a.index.screenshots.some((e) => e.shot === 'scratch'),
    'an untitled capture must still be indexed',
  );
  assert.deepEqual(
    a.manifest.shots.map((s) => s.id),
    ['home'],
    'the PAGE stays curated: only titled shots get a row',
  );
});

test('the page manifest keeps device columns and the index metadata', (t) => {
  const a = assemble();
  t.after(a.cleanup);
  const home = a.manifest.shots.find((s) => s.id === 'home');
  assert.deepEqual(Object.keys(home.byPlatform).sort(), ['ios-uikit/ipad', 'linux-gtk']);
  assert.deepEqual(Object.keys(home.byPlatform['linux-gtk']).sort(), ['dark', 'light']);
  assert.equal(home.source, 'src/lib.rs');
  assert.deepEqual(a.manifest.platforms, ['linux-gtk', 'ios-uikit/ipad']);
});

test('an all-untitled index publishes every shot as a row', (t) => {
  // No shot carries a title, so nothing is curated and the page shows everything — the shape
  // every app that has not written `title:` metadata yet produces.
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const src = JSON.parse(readFileSync(join(f.shots, 'gallery.json'), 'utf8'));
  src.shots = src.shots.map((s) => ({ ...s, title: null }));
  writeFileSync(join(f.shots, 'gallery.json'), JSON.stringify(src));
  const manifest = assembleGallery(f.shots, f.site, { quiet: true, outImages: f.out });
  assert.deepEqual(manifest.shots.map((s) => s.id).sort(), ['home', 'scratch']);
});

test('a second build channel republishes an index that links its own copies', (t) => {
  // The main channel serves its images from main/gallery/, and the index it publishes there is
  // what daybrite.dev reads. An index still spelling `gallery/…` links the release channel's
  // images, which do not exist for a screen only the branch build captured.
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  assembleGallery(f.shots, f.site, {
    quiet: true,
    outImages: f.out,
    prefix: 'main/gallery',
    manifest: 'main/gallery-manifest.json',
  });
  const index = JSON.parse(readFileSync(join(f.out, 'gallery.json'), 'utf8'));
  assert.ok(index.screenshots.length > 0, 'the index must not be empty');
  for (const e of index.screenshots) {
    assert.ok(e.path.startsWith('main/gallery/'), `${e.path} is not under the channel's prefix`);
    assert.ok(e.url.endsWith(`/${e.path}`), `${e.url} does not link ${e.path}`);
    const rel = e.path.replace(/^main\/gallery\//, '');
    assert.ok(existsSync(join(f.out, rel)), `index names ${e.path}, which was never published`);
  }
});
