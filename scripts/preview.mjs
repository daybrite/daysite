// Local preview of an app's daysite: generate the data from the repo, then run astro dev.
//
//   cd <your-app>/website && node .daysite/scripts/preview.mjs
//
// (First: git clone https://github.com/daybrite/daysite .daysite && npm --prefix .daysite install)
//
// The generator runs without network access too — release download cards are simply absent —
// and the gallery assembles from your last local `day launch --script` run's screenshots.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateAppIndex } from './generate-appindex.mjs';
import { assembleGallery } from './assemble-gallery.mjs';

const TEMPLATE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = resolve(TEMPLATE_ROOT, '..');           // <app>/website
const projectRoot = resolve(siteDir, '..');             // <app>

if (!existsSync(join(siteDir, 'site.toml'))) {
  console.error(`no site.toml in ${siteDir} — run from <app>/website/.daysite/`);
  process.exit(2);
}

await generateAppIndex(projectRoot, siteDir);
assembleGallery(join(projectRoot, 'build', 'day', 'screenshots'), siteDir);
execFileSync('npx', ['astro', 'dev'], { cwd: TEMPLATE_ROOT, stdio: 'inherit' });
