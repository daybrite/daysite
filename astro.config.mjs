// @ts-check
import { defineConfig } from 'astro/config';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
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
 * The published site loads nothing from another origin (README, "self-contained"). This hook
 * walks the built output and fails the build on the first resource fetched from elsewhere:
 * a script, stylesheet, image, frame, media, font, or manifest whose `src`/`href` names another
 * host, or a `url(http…)` in CSS. Navigational links (`<a href>`, canonical, alternate) are
 * fine — they go somewhere, they load nothing. The hosted web app (site.toml `webapp`) is the
 * app's own build, not the template's, and is left out of the walk.
 *
 * @param {string} webappDir
 * @returns {import('astro').AstroIntegration}
 */
function selfContainedIntegration(webappDir) {
  const LOADING_LINK_RELS = new Set([
    'stylesheet', 'preload', 'modulepreload', 'prefetch', 'icon', 'apple-touch-icon', 'manifest',
  ]);
  /** @param {string} value */
  const external = (value) => /^(https?:)?\/\//i.test(value.trim());
  /** @param {string} html */
  function offendersInHTML(html) {
    const out = [];
    const tags = html.matchAll(/<(script|link|img|iframe|video|audio|source|track|embed|object)\b([^>]*)>/gi);
    for (const [, tag, attrs] of tags) {
      /** @param {string} name */
      const attr = (name) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
      const url = attr(tag === 'link' ? 'href' : tag === 'object' ? 'data' : 'src');
      const value = url && (url[2] ?? url[3] ?? url[4]);
      if (!value || !external(value)) continue;
      if (tag === 'link') {
        const rel = attr('rel');
        const rels = ((rel && (rel[2] ?? rel[3] ?? rel[4])) ?? '').toLowerCase().split(/\s+/);
        if (!rels.some((r) => LOADING_LINK_RELS.has(r))) continue;
      }
      out.push(`<${tag} … ${value}>`);
    }
    for (const [, value] of html.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi)) out.push(`url(${value})`);
    return out;
  }
  return {
    name: 'self-contained',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const skip = resolve(root, webappDir);
        const found = [];
        let files = 0;
        for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const path = resolve(entry.parentPath, entry.name);
          if (path === skip || path.startsWith(skip + sep)) continue;
          const isHTML = path.endsWith('.html');
          if (!isHTML && !path.endsWith('.css')) continue;
          files++;
          const text = await readFile(path, 'utf8');
          const hits = isHTML ? offendersInHTML(text) : Array.from(text.matchAll(/url\(\s*['"]?((?:https?:)?\/\/[^'")\s]+)/gi), (m) => `url(${m[1]})`);
          for (const hit of hits) found.push(`${relative(root, path)}: ${hit}`);
        }
        if (found.length) {
          throw new Error(
            `the site must load nothing from another origin, but ${found.length} reference(s) do:\n  ` +
              found.slice(0, 20).join('\n  '),
          );
        }
        logger.info(`self-contained: ${files} file(s) load nothing from another origin`);
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
    selfContainedIntegration(data.site.webapp ?? 'webapp'),
    cnameIntegration(),
  ],
  vite: {
    plugins: [/** @type {any} */ (tailwindcss())],
  },
});
