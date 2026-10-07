// Install each customization's own dependencies before evaluating its Astro configuration.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'smol-toml';
import { siteConfigPath } from '../src/customization.mjs';

const siteDir = dirname(siteConfigPath());
const site = parse(readFileSync(siteConfigPath(), 'utf8'));
const themeDir = process.env.DAYSITE_THEME || (site.theme?.path ? resolve(siteDir, site.theme.path) : undefined);
for (const directory of new Set([themeDir, siteDir].filter(Boolean))) {
  const manifest = resolve(directory, 'package.json');
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  if (!existsSync(resolve(directory, 'package-lock.json'))) {
    if (Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length) {
      throw new Error(`Commit a package-lock.json for the website customization at ${directory}`);
    }
    continue;
  }
  const result = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status) process.exit(result.status);
}
