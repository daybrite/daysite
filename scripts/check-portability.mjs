// Serve ONE built artifact at three unrelated roots. A prefix-only server rejects requests
// outside its mount, so an accidentally origin-relative URL cannot pass via a fallback route.
// Run after astro build: node scripts/check-portability.mjs [dist]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
import { chromium } from 'playwright';
import { parse } from 'parse5';

const root = resolve(process.argv[2] ?? 'dist');
const exists = async (file) => stat(join(root, file)).then(() => true, () => false);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.wasm': 'application/wasm' };

// Check every local page/asset link, including pages not visited by the interactive tour.
let links = 0;
for (const entry of await readdir(root, { recursive: true })) {
  if (!entry.endsWith('.html') || entry.split(sep).includes('webapp')) continue;
  const tree = parse(await readFile(join(root, entry), 'utf8'));
  async function walk(node) {
    for (const a of node.attrs ?? []) {
      if (!['href', 'src', 'srcset', 'data-site-url'].includes(a.name)
          && !a.name.startsWith('data-v-') && !a.name.startsWith('data-w-')) continue;
      // A srcset is URLs with optional descriptors; the WebP sources carry one URL each.
      const values = a.name === 'srcset'
        ? a.value.split(',').map((c) => c.trim().split(/\s+/)[0]).filter(Boolean)
        : [a.value];
      for (const value of values) {
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)) continue;
        assert.ok(!value.startsWith('/'), `${entry}: nonportable ${a.name}=${value}`);
        const url = new URL(value, 'https://test.invalid/' + entry);
        assert.ok(await exists(decodeURIComponent(url.pathname).slice(1)), `${entry}: missing ${url.pathname}`);
        links++;
      }
    }
    for (const child of node.childNodes ?? []) await walk(child);
    if (node.content) await walk(node.content);
  }
  await walk(tree);
}

const browser = await chromium.launch();
try {
  for (const mount of ['/', '/Old-Project/', '/preview/renamed/']) {
    const server = createServer(async (req, res) => {
      try {
        const path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
        if (!path.startsWith(mount)) { res.writeHead(404).end(); return; }
        let file = resolve(root, './' + path.slice(mount.length));
        if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
        if ((await stat(file)).isDirectory()) {
          if (!path.endsWith('/')) { res.writeHead(302, { Location: path + '/' }).end(); return; }
          file = join(file, 'index.html');
        }
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
        res.end(await readFile(file));
      } catch { res.writeHead(404).end(); }
    });
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const base = origin + mount;
    const context = await browser.newContext({ locale: 'en', viewport: { width: 1400, height: 1000 } });
    try {
      const page = await context.newPage();
      const failures = [];
      page.on('pageerror', (e) => failures.push(e.message));
      page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
      await page.goto(base);
      await page.waitForURL(base + 'en/');
      await page.locator('[data-theme-set="dark"]').click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      if (await page.locator('[data-qr-open]').count()) {
        await page.locator('[data-qr-open]').click();
        assert.equal(await page.locator('[data-qr-url]').innerText(), base);
        await page.keyboard.press('Escape');
      }
      for (const input of await page.locator('[data-site-url]').all()) {
        assert.ok((await input.inputValue()).startsWith(base), 'copyable web-app URL follows mount');
      }
      // Search imports JS/WASM lazily and must return links under the actual mount.
      if (await exists('pagefind/pagefind.js')) {
        const term = (await page.locator('h1').innerText()).trim().split(/\s+/)[0];
        await page.locator('[data-search-input]').fill(term);
        await page.locator('[data-search-list] a').first().waitFor({ state: 'visible' });
        for (const link of await page.locator('[data-search-list] a').all()) {
          assert.ok((await link.evaluate((el) => el.href)).startsWith(base), 'search result follows mount');
        }
        await page.keyboard.press('Escape');
      }
      await page.locator('[data-language-picker] summary').click();
      await page.locator('[data-language-picker] a[lang="fr"]').click();
      await page.waitForURL(base + 'fr/');
      for (const route of ['en/gallery/', 'en/main/', 'en/main/gallery/', 'en/prerelease/', 'en/prerelease/gallery/']) {
        if (!await exists(route + 'index.html')) continue;
        await page.goto(base + route);
        await page.waitForFunction(() => [...document.styleSheets].some((s) => s.cssRules.length > 0));
        if (route.endsWith('gallery/')) {
          const image = page.locator('img.gal-img').first();
          await image.scrollIntoViewIfNeeded();
          await image.evaluate((img) => img.decode());
          const variants = page.locator('[data-seg="slocale"] [data-value]');
          if (await variants.count() > 1) {
            await page.locator('[data-seg="slocale"] summary').click();
            await variants.nth(1).click();
            await image.evaluate((img) => img.decode());
          }
          await page.locator('.gal-frame').first().click();
          await page.locator('.lb-close').waitFor({ state: 'visible' });
          // The viewer may use a device-shell clone rather than the fallback image.
          for (const img of await page.locator('[role="dialog"] img:visible').all()) {
            await img.evaluate((el) => el.decode());
          }
          await page.keyboard.press('Escape');
        }
      }
      for (const alias of ['gallery/', 'en/release/']) {
        if (!await exists(alias + 'index.html')) continue;
        await page.goto(base + alias);
        await page.waitForURL(base + (alias === 'gallery/' ? 'en/gallery/' : 'en/'));
      }
      const manifestURL = base + 'site.webmanifest';
      if (await exists('site.webmanifest')) {
        const manifest = await (await fetch(manifestURL)).json();
        assert.ok(new URL(manifest.start_url, manifestURL).href.startsWith(base));
        assert.equal(new URL(manifest.scope, manifestURL).href, base);
        for (const icon of manifest.icons) assert.equal((await fetch(new URL(icon.src, manifestURL))).status, 200);
      }
      // No-JS visitors still get usable styles, images, and language/gallery navigation.
      const plain = await browser.newContext({ javaScriptEnabled: false });
      try {
        const p = await plain.newPage();
        await p.goto(base + 'en/');
        await p.locator('[data-language-picker] summary').click();
        await p.locator('[data-language-picker] a[lang="fr"]').click();
        assert.equal(p.url(), base + 'fr/');
      } finally { await plain.close(); }
      assert.deepEqual(failures, [], `${mount}: browser/resource errors`);
      console.log(`PASS ${mount}: navigation, CSS/JS, images, gallery, redirects, QR, manifest, search, no-JS`);
    } finally {
      await context.close();
      await new Promise((ok) => server.close(ok));
    }
  }
} finally { await browser.close(); }
console.log(`${links} generated local URL references checked`);
