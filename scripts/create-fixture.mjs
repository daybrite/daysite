// Synthetic publication data for offline CI. These are fixtures, never shipped UI strings.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSite } from './generate-site.mjs';

export async function createFixture(root, options = {}) {
  root = resolve(root);
  const siteDir = join(root, 'website');
  const publicDir = join(root, 'public');
  mkdirSync(siteDir, { recursive: true });
  writeFileSync(join(siteDir, 'site.toml'), `host = ${JSON.stringify(options.host ?? 'https://example.test/Old-Project')}\npagefind = false\n`);
  const storefront = join(root, 'storefront.json');
  writeFileSync(storefront, JSON.stringify({
    schema: 1,
    project: { name: 'fixture', id: 'test.example.fixture', title: 'Fixture', version: '1.2.3', build: 7,
      targets: ['macos-appkit', 'ios-uikit', 'web-dom'], store: {} },
    'default-locale': 'en', locales: ['en', 'fr', 'ar'],
    storefront: { metadata: {
      en: { name: 'Fixture', description: 'Synthetic English publication.' },
      fr: { name: 'Exemple', description: 'Publication synthétique.' },
      ar: { name: 'مثال', description: 'بيانات اختبار.' },
    }, targets: {} }, permissions: [], rawPermissions: {},
  }));
  // A tiny, valid, synthetic screenshot keeps theme CI independent of network captures.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  for (const target of ['macos-appkit', 'ios-uikit', 'web-dom']) {
    const directory = join(root, 'screenshots', target, 'default');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'home.png'), png);
  }
  const assets = join(root, 'assets.json');
  writeFileSync(assets, JSON.stringify([{ name: 'fixture-macos-appkit.dmg', size: 100 }]));
  const channels = [
    { id: 'release', label: '1.2.3', tag: 'v1.2.3', screenshots: join(root, 'screenshots'), releaseAssets: assets },
    { id: 'prerelease', label: '1.3.0', tag: 'v1.3.0', prerelease: true, screenshots: join(root, 'screenshots'), releaseAssets: assets },
    { id: 'main', label: 'main', ref: 'main', commit: 'abcdef1234567890', development: true, screenshots: join(root, 'screenshots') },
  ];
  await generateSite(root, siteDir, channels, { repo: 'example/Fixture', publicDir, storefront, quiet: true, webp: false });
  // Store badges and permission vectors must resolve from staging in theme-owned Astro roots.
  for (const prefix of ['', 'main/', 'prerelease/']) {
    const indexPath = join(siteDir, prefix, 'appindex.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    index.apps[0].platforms.ios.channels = { appleappstore: { url: 'https://apps.apple.com/app/id000000000' } };
    index.apps[0].platforms.ios.permissions = [{ key: 'NSCameraUsageDescription', description: {en:'Synthetic camera permission.'} }];
    writeFileSync(indexPath, JSON.stringify(index));
  }
  for (const prefix of ['', 'main/', 'prerelease/']) {
    mkdirSync(join(publicDir, prefix, 'webapp'), { recursive: true });
    writeFileSync(join(publicDir, prefix, 'webapp/index.html'), '<!doctype html><title>Synthetic web app fixture</title>');
  }
  return { root, siteDir, publicDir, configPath: join(siteDir, 'site.toml'), storefront };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: create-fixture.mjs <output-directory>');
  const fixture = await createFixture(process.argv[2]);
  console.log(`Synthetic fixture: ${fixture.configPath}`);
}
