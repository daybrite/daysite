import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeEntities, excerpts } from './check-sample.mjs';

test('a page is matched as its reader sees it, whatever escaping it chose', () => {
  const reason = "Afficher l'aperçu & prendre une photo";
  for (const html of [
    'Afficher l&#39;aperçu &amp; prendre une photo',
    'Afficher l&#x27;aperçu &amp; prendre une photo',
    'Afficher l&apos;aperçu &#38; prendre une photo',
    "Afficher l'aperçu &amp; prendre une photo",
  ]) {
    assert.ok(decodeEntities(`<p>${html}</p>`).includes(reason), html);
  }
  // An unknown entity is left alone rather than dropped.
  assert.equal(decodeEntities('a &bogus; b'), 'a &bogus; b');
});

test('a failure shows the page around what it looked for, without markup', () => {
  const page = '<div><span>NSCameraUsageDescription</span> <p>Un   autre texte</p></div>';
  assert.deepEqual(excerpts(page, /NSCamera\w+/, 3, 40), ['NSCameraUsageDescription Un autre texte']);
  assert.deepEqual(excerpts(page, /absent/), []);
  // A window that opens inside a tag shows none of its attributes, and a repeat shows once.
  const cut = '<p class="soft leading-relaxed">Texte</p> Clé: NSCameraUsageDescription';
  assert.deepEqual(excerpts(cut, /NSCamera\w+/, 3, 38), ['Texte Clé: NSCameraUsageDescription']);
  assert.equal(excerpts('<b>x</b> k <b>x</b>', /x/, 3, 40).length, 1);
});
