// The landing-page QR helper (src/lib/qr.mjs): the SVG is one crisp path with a quiet zone and
// an accessible name, and the grid behind it is a real code of the expected size.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encode, svg } from '../src/lib/qr.mjs';

test('a short URL is a small code with finder patterns in three corners', () => {
  const { size, isDark } = encode('https://showcase.daybrite.dev/');
  assert.equal(size, 29, 'version 3 at level M');
  for (const [r, c] of [[0, 0], [0, size - 1], [size - 1, 0]]) {
    assert.equal(isDark(r, c), true);
    assert.equal(isDark(r === 0 ? 1 : size - 2, c === 0 ? 1 : size - 2), false);
  }
});

test('the SVG carries the quiet zone, the title, and escapes it', () => {
  const out = svg('https://showcase.daybrite.dev/', 'Landing page for the <Day> app');
  assert.match(out, /viewBox="0 0 37 37"/, '29 modules plus four on each side');
  assert.match(out, /<title>Landing page for the &lt;Day&gt; app<\/title>/);
  assert.match(out, /aria-label="Landing page for the &lt;Day&gt; app"/);
  assert.match(out, /<path d="M4 4h7v1h-7z/, 'the first finder row starts at the quiet zone');
  assert.ok(!svg('x').includes('<title>'), 'no title, no element');
});

test('the inline variant has no plate, no quiet zone, and takes the page color', () => {
  const out = svg('https://showcase.daybrite.dev/', '', { quiet: 0, color: 'currentColor', background: 'none' });
  assert.match(out, /viewBox="0 0 29 29"/);
  assert.ok(!out.includes('<rect'));
  assert.match(out, /fill="currentColor"/);
  assert.match(out, /aria-hidden="true"/, 'untitled, the icon is decoration beside its button label');
});
