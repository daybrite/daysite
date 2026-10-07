// Use the same renderer selection in local previews and CI. This only builds; it never deploys.
import { existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TEMPLATE_ROOT, siteConfigPath, loadCustomization } from '../src/customization.mjs';

export async function renderer(options = {}) {
  const customization = await loadCustomization(options);
  const findConfig = (directory) => ['mjs', 'js', 'ts', 'mts', 'cjs', 'cts']
    .map((extension) => resolve(directory, `astro.config.${extension}`)).find((path) => existsSync(path));
  const projectConfig = findConfig(customization.siteDir);
  const themeDir = customization.themeDir;
  const themeConfig = themeDir ? findConfig(themeDir) : undefined;
  const config = projectConfig ?? themeConfig ?? resolve(TEMPLATE_ROOT, 'astro.config.mjs');
  return { config, root: dirname(config), customization };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = { siteConfig: process.env.DAYSITE_CONFIG ?? siteConfigPath() };
  const chosen = await renderer(options);
  const command = process.argv[2] ?? 'build';
  if (!['build', 'dev', 'preview', 'check'].includes(command)) throw new Error(`Unsupported Astro command: ${command}`);
  const result = spawnSync(process.execPath, [resolve(TEMPLATE_ROOT, 'node_modules/astro/astro.js'),
    command, '--root', chosen.root, '--config', relative(chosen.root, chosen.config), ...process.argv.slice(3)], {
    cwd: chosen.root, stdio: 'inherit', env: { ...process.env, DAYSITE_ROOT: TEMPLATE_ROOT,
      DAYSITE_CONFIG: chosen.customization.configPath,
      DAYSITE_THEME: chosen.customization.themeDir ?? '' },
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
