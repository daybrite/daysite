import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portableHTML, portableCSS, portableModule, relativeURL } from './portable-urls.mjs';

test('one document-relative URL works at root, project and nested mounts', () => {
  for (const file of ['index.html', 'en/index.html', 'fr/main/gallery/index.html']) {
    for (const target of ['app/icon.png', 'fr/', 'main/webapp/?locale=fr#open', '']) {
      const url = relativeURL('/Old-Project/' + target, file, '/Old-Project/');
      for (const mount of ['/', '/Old-Project/', '/preview/new-name/']) {
        const page = new URL(mount + file.replace(/index.html$/, ''), 'https://moved.test');
        assert.equal(new URL(url, page).href, 'https://moved.test' + mount + target);
      }
    }
  }
  assert.equal(relativeURL('/app/icon.png', 'en/index.html', '/Old-Project/'), '../app/icon.png');
  for (const url of ['https://other.test/a', '//cdn.test/a', '#section', 'data:image/svg+xml,x']) {
    assert.equal(relativeURL(url, 'en/index.html', '/Old-Project/'), url);
  }
});

test('HTML resources, navigation, redirects and hidden gallery variants are portable without JS', async () => {
  const html = await portableHTML(`<!doctype html><html><head>
    <link rel="canonical" href="https://original.test/Old/en/">
    <link rel="stylesheet" href="/Old/_astro/style.css">
    <meta name="daysite-root" content="/Old/">
    <meta http-equiv="refresh" content="0; url=/Old/fr/?x=1&amp;y=2#part">
    </head><body><a href="/Old/en/main/">Channel</a><img src="/Old/app/icon.png"
    srcset="/Old/app/a.png 1x, /Old/app/b.png 2x" data-v-dark="/Old/gallery/dark.png">
    <template><img src="/Old/gallery/light.png"></template>
    <p>Do not rewrite prose /Old/en/ or external https://original.test/Old/en/</p>
    <script type="module">import {x} from '/Old/_astro/shared.js'; import('/Old/_astro/lazy.js');</script>
    </body></html>`, 'en/main/gallery/index.html', '/Old/');
  assert.match(html, /href="https:\/\/original.test\/Old\/en\/"/);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/_astro\/style.css"/);
  assert.match(html, /name="daysite-root" content="\.\.\/\.\.\/\.\.\/"/);
  assert.match(html, /url=\.\.\/\.\.\/\.\.\/fr\/\?x=1&amp;y=2#part/);
  assert.match(html, /data-v-dark="\.\.\/\.\.\/\.\.\/gallery\/dark.png"/);
  assert.match(html, /<template><img src="\.\.\/\.\.\/\.\.\/gallery\/light.png"/);
  assert.match(html, /Do not rewrite prose \/Old\/en\//);
  assert.match(html, /from '\.\.\/\.\.\/\.\.\/_astro\/shared.js'/);
  assert.match(html, /import\("\.\.\/\.\.\/\.\.\/_astro\/lazy.js"\)/);
});

test('CSS keeps data, external and fragment URLs and resolves local fonts/images from its own file', () => {
  assert.equal(portableCSS(`@import "/Old/css/base.css"; a{background:url('/Old/art/a(b).svg');mask:url(#mask)}
    b{src:url(data:font/woff2;base64,AA==)} c{background:url(https://cdn.test/a.png)}`,
    '_astro/app.css', '/Old/'),
  `@import "../css/base.css"; a{background:url('../art/a(b).svg');mask:url(#mask)}
    b{src:url(data:font/woff2;base64,AA==)} c{background:url(https://cdn.test/a.png)}`);
});

test('module parsing changes only literal local import/export specifiers', async () => {
  assert.equal(await portableModule(`export {x} from '/Old/a.js'; const s='/Old/not-a-url';
    import('/Old/b.js'); import(variable); import('https://cdn.test/c.js');`, 'en/index.html', '/Old/'),
  `export {x} from '../a.js'; const s='/Old/not-a-url';
    import("../b.js"); import(variable); import('https://cdn.test/c.js');`);
});
