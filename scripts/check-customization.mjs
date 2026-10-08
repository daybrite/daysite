// Real-browser contracts for default, overridden, and project-owned Astro websites.
// Run after a synthetic fixture build: check-customization.mjs <dist> [default|theme|appfair]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const root = resolve(process.argv[2]);
const kind = process.argv[3] ?? 'default';
assert.ok(['default','theme','appfair'].includes(kind));
const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml',
  '.png':'image/png', '.webp':'image/webp', '.json':'application/json', '.webmanifest':'application/manifest+json' };
const browser = await chromium.launch();
try {
  for (const mount of ['/', '/preview/renamed/']) {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url,'http://local');
        if (!url.pathname.startsWith(mount)) { res.writeHead(404).end();return; }
        let path = resolve(root, './'+decodeURIComponent(url.pathname.slice(mount.length)));
        if (path !== root && !path.startsWith(root+sep)) {res.writeHead(403).end();return;}
        if ((await stat(path)).isDirectory()) path=join(path,'index.html');
        res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'}).end(await readFile(path));
      } catch {res.writeHead(404).end();}
    });
    await new Promise((ok)=>server.listen(0,'127.0.0.1',ok));
    const base=`http://127.0.0.1:${server.address().port}${mount}`;
    try {
      for (const width of [1440,390]) {
        const context=await browser.newContext({viewport:{width,height:1000},locale:'en'});
        try {
          // Exercise the lazy badge with a delayed response so local caches cannot hide
          // the same image-loading race seen on a fresh CI runner.
          await context.route('**/badges/en/apple-app-store.svg', async (route) => {
            await new Promise((done) => setTimeout(done, 250));
            await route.continue();
          });
          const page=await context.newPage();const errors=[];
          page.on('pageerror',(e)=>errors.push(e.message));
          page.on('response',(r)=>{if(r.url().startsWith(base)&&r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
          await page.goto(base+'en/');
          await page.locator('[data-platform-tab="macos"]').click();
          assert.equal(await page.locator('[data-platform-tab="macos"]').getAttribute('aria-selected'),'true');
          assert.ok(page.url().endsWith('#macos-appkit'));
          assert.ok(await page.locator('a[href*="releases/download/v1.2.3/"]').count());
          await page.locator('[data-platform-tab="ios"]').click();
          // Store artwork is lazy-loaded after its platform becomes visible. Wait for the
          // selected section and image, rather than sampling before layout/network settle.
          await expect(page.locator('[data-platform-tab="ios"]')).toHaveAttribute('aria-selected', 'true');
          const storeBadge = page.locator('.store-badge-apple img');
          await page.locator('[data-platform-section="ios"]').filter({ has: storeBadge }).scrollIntoViewIfNeeded();
          await expect(storeBadge).toBeVisible();
          await expect.poll(() => storeBadge.evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
          assert.ok(await page.locator('[data-platform-section="ios"] svg[aria-hidden="true"]').count());
          await page.locator('[data-theme-set="dark"]').click();
          assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
          if (kind==='default') {
            assert.equal(await page.locator('[data-appfair-brand], [data-theme-fixture]').count(),0);
            assert.ok(await page.locator('footer a[href="https://daybrite.dev"]').count());
          } else if(kind==='theme') {
            assert.equal(await page.locator('[data-theme-fixture]').count(),1);
            assert.equal(await page.locator('[data-theme-hero]').count(),1);
            const style=await page.locator('[data-theme-hero]').evaluate((el)=>({
              token:getComputedStyle(document.documentElement).getPropertyValue('--theme-fixture').trim(),
              outline:getComputedStyle(el).outlineWidth,
            }));
            assert.equal(style.token,'42');assert.equal(style.outline,'3px','external theme Tailwind utilities must be generated');
          } else {
            assert.equal(await page.locator('[data-appfair-brand] svg').count(),1);
            assert.equal(await page.locator('[data-appfair-catalog]').getAttribute('href'),'https://appfair.net');
            assert.equal(await page.locator('[data-appfair-footer]').count(),1);
            assert.equal(await page.locator('footer a[href="https://daybrite.dev"]').count(),0);
            await page.locator('[data-appfair-journal]').click();
            await page.waitForURL(base+'en/blog/');
            assert.equal(await page.locator('[data-appfair-blog]').count(),1);
            await page.locator('[data-appfair-blog] article a').first().click();
            assert.equal(await page.locator('[data-appfair-post]').count(),1);
            assert.ok(await page.locator('time').getAttribute('datetime'));
          }
          for(const route of ['ar/','fr/','en/gallery/','en/prerelease/','en/main/','en/main/gallery/']) {
            await page.goto(base+route);
            assert.equal(await page.locator('h1').count(),1,route);
            if(route==='ar/') assert.equal(await page.locator('html').getAttribute('dir'),'rtl');
            if(route==='en/main/') assert.match(await page.locator('body').innerText(),/Development build/);
            if(kind==='appfair') assert.equal(await page.locator('[data-appfair-footer]').count(),1,route);
            assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${kind} ${width} ${route}: horizontal overflow`);
          }
          if(kind==='theme') {
            await page.goto(base+'scopes/');
            const first=page.locator('[data-platform-scope="first"]');
            const second=page.locator('[data-platform-scope="second"]');
            await first.locator('[data-platform-tab="ios"]').click();
            await second.locator('[data-platform-tab="macos"]').click();
            assert.equal(await first.locator('[data-platform-tab="ios"]').getAttribute('aria-selected'),'true');
            assert.ok(await first.locator('[data-platform-section="ios"]').isVisible());
            assert.ok(await second.locator('[data-platform-section="macos"]').isVisible());
            assert.equal(new URL(page.url()).hash,'','embedded independent pickers do not own the URL');
            await page.reload();
            assert.equal(await first.locator('[data-platform-tab="ios"]').getAttribute('aria-selected'),'true');
            assert.equal(await second.locator('[data-platform-tab="macos"]').getAttribute('aria-selected'),'true');
          }
          assert.deepEqual(errors,[],`${kind} ${width} ${mount}: runtime/resource errors`);
        } finally {await context.close();}
      }
    } finally {await new Promise((ok)=>server.close(ok));}
  }
  console.log(`${kind}: desktop/mobile, RTL, channels, gallery, controls, custom content, and relocation passed`);
} finally {await browser.close();}
