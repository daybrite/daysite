// @ts-check
import { defineConfig } from 'astro/config';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { loadSite } from './src/lib/data.ts';

const data = await loadSite();

const localeCodes = data.locales.map((l) => l.code);

// Split site.host into an origin (passed to `site`) and a pathname (passed
// to `base`). Supports project-page deployments like
// `https://example.github.io/Fair-Skies` where every route must be served
// under `/Fair-Skies/...`. When the host has no path component, `base`
// resolves to `'/'` and behavior is unchanged from before.
const hostURL = new URL(data.site.host);
const basePath = hostURL.pathname || '/';

/**
 * Run Pagefind over the built `dist/` directory once Astro is done. Only
 * activated when siteinfo.yaml has `pagefind: true` — opted-out sites
 * never spawn the indexer or ship the index files.
 *
 * @param {boolean} enabled
 * @returns {import('astro').AstroIntegration}
 */
function pagefindIntegration(enabled) {
  return {
    name: 'pagefind',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        if (!enabled) return;
        const sitePath = fileURLToPath(dir);
        logger.info(`indexing ${sitePath}`);
        const { createIndex } = await import('pagefind');
        const { index } = await createIndex({});
        if (!index) throw new Error('pagefind: createIndex returned no handle');
        await index.addDirectory({ path: sitePath });
        await index.writeFiles({ outputPath: `${sitePath}/pagefind` });
      },
    },
  };
}

/**
 * GitHub Pages custom domains are declared by a CNAME file at the site root; without it a
 * Pages deploy silently resets the domain binding. Emitted only for non-github.io hosts —
 * project pages under <owner>.github.io need none.
 *
 * @returns {import('astro').AstroIntegration}
 */
function cnameIntegration() {
  return {
    name: 'cname',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        if (hostURL.hostname.endsWith('.github.io')) return;
        // `writeFile` is imported at the top rather than here: a dynamic import inside
        // `astro:build:done` goes through Vite's module runner, which another hook (pagefind's
        // indexing) can close first — the build then dies with "Vite module runner has been
        // closed" and the site deploys without its CNAME, silently dropping the custom domain.
        await writeFile(new URL('CNAME', dir), hostURL.hostname + '\n');
      },
    },
  };
}

export default defineConfig({
  site: data.site.host,
  base: basePath,
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  integrations: [
    sitemap({
      i18n: {
        defaultLocale: data.defaultLocale,
        locales: Object.fromEntries(
          localeCodes.map((c) => [c, c]),
        ),
      },
    }),
    pagefindIntegration(data.site.pagefind === true),
    cnameIntegration(),
  ],
  vite: {
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
