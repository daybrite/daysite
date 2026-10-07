import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPONENTS, defaultComponent, loadCustomization, TEMPLATE_ROOT } from '../src/customization.mjs';
import { daysiteIntegration, DEFAULT_ROUTES } from '../src/integration.mjs';
import { renderer } from './build-site.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'daysite-theme-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const siteConfig = join(root, 'website/site.toml');
  mkdirSync(join(root, 'website'), { recursive: true });
  writeFileSync(siteConfig, 'host = "https://example.test"\n');
  const put = (name, text = '<p>synthetic fixture</p>') => {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); return path;
  };
  return { root, siteConfig, put };
}

test('an existing project uses every original component and the original renderer', async (t) => {
  const f = fixture(t);
  const { config, root, customization } = await renderer({ siteConfig: f.siteConfig });
  assert.equal(config, join(TEMPLATE_ROOT, 'astro.config.mjs'));
  assert.equal(root, TEMPLATE_ROOT.replace(/\/$/, ''));
  assert.deepEqual(customization.components, {});
  for (const name of COMPONENTS) assert.match(readFileSync(defaultComponent(name), 'utf8'), /./);
});

test('theme, project, and caller precedence; paths belong to each configuration', async (t) => {
  const f = fixture(t);
  const themeHeader = f.put('theme/header.astro');
  const projectHeader = f.put('website/header.astro');
  const callerHeader = f.put('caller/header.astro');
  f.put('theme/theme.css', 'body {}'); f.put('website/theme-extra.css', 'p {}');
  f.put('theme/daysite.config.mjs', 'export default {apiVersion:1, components:{Header:"./header.astro"},customCss:["./theme.css"],srcDir:"./src"}');
  f.put('website/daysite.config.mjs', 'export default {components:{Header:"./header.astro"},customCss:["./theme-extra.css"]}');
  writeFileSync(f.siteConfig, 'host="https://example.test"\n[theme]\npath="../theme"\n');
  const selected = await loadCustomization({ siteConfig: f.siteConfig });
  assert.equal(selected.components.Header, projectHeader);
  assert.notEqual(selected.components.Header, themeHeader);
  assert.equal(selected.srcDir, join(f.root, 'theme/src'));
  assert.deepEqual(selected.customCss, [join(f.root, 'theme/theme.css'), join(f.root, 'website/theme-extra.css')]);
  const final = await loadCustomization({ siteConfig: f.siteConfig, root: join(f.root, 'caller'), components: { Header: './header.astro' } });
  assert.equal(final.components.Header, callerHeader);
});

test('project Astro configuration takes precedence over a theme renderer', async (t) => {
  const f = fixture(t);
  f.put('theme/daysite.config.mjs', 'export default {}');
  const themeConfig = f.put('theme/astro.config.mjs', 'export default {}');
  assert.equal((await renderer({ siteConfig: f.siteConfig, themeDir: join(f.root, 'theme') })).config, themeConfig);
  const projectConfig = f.put('website/astro.config.mjs', 'export default {}');
  assert.equal((await renderer({ siteConfig: f.siteConfig, themeDir: join(f.root, 'theme') })).config, projectConfig);
});

test('renderer selection accepts the standard Astro TypeScript configuration extension', async (t) => {
  const f = fixture(t);
  const projectConfig = f.put('website/astro.config.ts', 'export default {}');
  assert.equal((await renderer({siteConfig:f.siteConfig})).config,projectConfig);
});

test('configuration errors report the broken contract before Astro runs', async (t) => {
  const f = fixture(t); f.put('not-astro.js', 'export default {}');
  for (const [options, message] of [
    [{apiVersion:2}, /apiVersion/], [{components:['Header']}, /components/],
    [{components:{Typo:'./missing.astro'}}, /Unknown.*Typo/],
    [{components:{Header:'./missing.astro'}}, /no such file/],
    [{components:{Header:'../not-astro.js'}}, /\.astro/],
    [{customCss:'./style.css'}, /array/], [{publicDirs:[null]}, /array/],
    [{srcDir:42}, /srcDir/], [{routes:{}}, /routes/],
    [{routes:[{pattern:'blog',entrypoint:'./missing'}]}, /begin with/],
    [{routes:[{pattern:'/blog'}]}, /entrypoint/],
  ]) await assert.rejects(loadCustomization({siteConfig:f.siteConfig, ...options}), message);
  writeFileSync(f.siteConfig, 'host="https://example.test"\n[theme]\nrepository="example/theme"\n');
  await assert.rejects(loadCustomization({siteConfig:f.siteConfig}), /DAYSITE_THEME/);
  writeFileSync(f.siteConfig, 'host="https://example.test"\n[theme]\nrepository="bad"\n');
  await assert.rejects(loadCustomization({siteConfig:f.siteConfig}), /owner\/name/);
  writeFileSync(f.siteConfig, 'host="https://example.test"\n[theme]\nrepository="example/theme"\npath="../theme"\n');
  await assert.rejects(loadCustomization({siteConfig:f.siteConfig}), /not both/);
});

function setup(customization, root, injectDefaults = true) {
  const routes = []; let vite; const types = [];
  const integration = daysiteIntegration(customization, { injectDefaults });
  integration.hooks['astro:config:setup']({
    config: {root:pathToFileURL(root+'/'),publicDir:pathToFileURL(join(root,'public')+'/')},
    injectRoute(route) {routes.push(route);}, addWatchFile() {},
    injectTypes(value) {types.push(value);}, updateConfig(value) {vite=value.vite;},
  });
  integration.hooks['astro:config:done']({injectTypes(value) {types.push(value);}});
  return {routes, vite, types};
}

test('custom Astro projects retain app routes, replace selected routes, and can disable defaults', async (t) => {
  const f = fixture(t); f.put('blog.astro'); f.put('home.astro');
  const selected = await loadCustomization({siteConfig:f.siteConfig, root:f.root,
    disabledRoutes:['/gallery'], routes:[{pattern:'/blog',entrypoint:'./blog.astro'}, {pattern:'/',entrypoint:'./home.astro'}]});
  const out = setup(selected, f.root);
  assert.equal(out.routes.find((r) => r.pattern === '/').entrypoint, join(f.root,'home.astro'));
  assert.ok(out.routes.some((r) => r.pattern === '/[locale]/[channel]/gallery'));
  assert.ok(out.routes.some((r) => r.pattern === '/blog'));
  assert.ok(!out.routes.some((r) => r.pattern === '/gallery'));
  assert.equal(out.routes.length, Object.keys(DEFAULT_ROUTES).length);
  assert.match(out.types[0].content, /daysite\/data/);
  assert.throws(() => setup(selected, f.root, false), /custom srcDir/);
});

test('wrapper imports always address the original, while composition uses the overridden component', async (t) => {
  const f = fixture(t); const header = f.put('header.astro');
  const selected = await loadCustomization({siteConfig:f.siteConfig, root:f.root, components:{Header:'./header.astro'}});
  const {vite} = setup(selected, f.root);
  assert.equal(vite.resolve.alias.find((a) => a.find === '@daysite/components/Header').replacement, header);
  const originals = vite.resolve.alias.find((a) => a.find instanceof RegExp && a.find.test('daysite/components/Header.astro'));
  assert.equal('daysite/components/Header.astro'.replace(originals.find, originals.replacement), defaultComponent('Header'));
});

test('theme assets merge into staging but cannot clobber generated publications', async (t) => {
  const f = fixture(t); f.put('assets/logo.svg', '<svg/>');
  const selected = await loadCustomization({siteConfig:f.siteConfig, root:f.root, publicDirs:['./assets']});
  setup(selected,f.root);
  assert.equal(readFileSync(join(f.root,'public/logo.svg'),'utf8'), '<svg/>');
  f.put('assets/main/overwrite.txt');
  assert.throws(() => setup(selected,f.root), /cannot replace generated/);
});

test('projects can override theme routes; duplicate routes in one layer fail', async (t) => {
  const f=fixture(t); f.put('theme/blog.astro');f.put('website/blog.astro');
  f.put('theme/daysite.config.mjs', 'export default {routes:[{pattern:"/blog",entrypoint:"./blog.astro"}]}');
  f.put('website/daysite.config.mjs', 'export default {routes:[{pattern:"/blog",entrypoint:"./blog.astro"}]}');
  const selected=await loadCustomization({siteConfig:f.siteConfig,themeDir:join(f.root,'theme')});
  assert.deepEqual(selected.routes,[{pattern:'/blog',entrypoint:join(f.root,'website/blog.astro')}]);
  await assert.rejects(loadCustomization({siteConfig:f.siteConfig,routes:[
    {pattern:'/blog',entrypoint:'./blog.astro'},{pattern:'/blog',entrypoint:'./blog.astro'},
  ]}), /Duplicate/);
});
