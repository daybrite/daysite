import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPONENTS, defaultComponent, TEMPLATE_ROOT } from './customization.mjs';

export const DEFAULT_ROUTES = {
  '/': 'index.astro',
  '/[locale]': '[locale]/index.astro',
  '/[locale]/[channel]': '[locale]/[channel]/index.astro',
  '/[locale]/gallery': '[locale]/gallery/index.astro',
  '/[locale]/[channel]/gallery': '[locale]/[channel]/gallery/index.astro',
  '/[locale]/apps/[app]': '[locale]/apps/[app]/index.astro',
  '/gallery': 'gallery/index.astro',
  '/robots.txt': 'robots.txt.ts',
  '/site.webmanifest': 'site.webmanifest.ts',
};

/** Astro integration used by both the managed template and project-owned Astro builds. */
export function daysiteIntegration(customization, options = {}) {
  return {
    name: 'daysite',
    hooks: {
      'astro:config:done': ({ injectTypes }) => {
        // Astro includes injected declarations in .astro/types.d.ts, including in theme-owned projects.
        if (options.injectDefaults) {
          const components = COMPONENTS.map((name) => `declare module '@daysite/components/${name}' { const component: typeof import(${JSON.stringify(defaultComponent(name))}).default; export default component; }`);
          const modules = ['data', 'routes', 'types', 'customization-types', 'i18n', 'uistrings', 'html'];
          injectTypes({ filename: 'daysite.d.ts', content: [
            'declare module "virtual:daysite/styles";', ...components,
            ...modules.map((name) => {
              const path = resolve(TEMPLATE_ROOT, 'src/lib', `${name}.ts`);
              // Ambient modules cannot use export * from an absolute path. Derive typed accessors
              // from our named public exports, keeping signatures attached to their source types.
              const declarations = [...readFileSync(path, 'utf8').matchAll(/^export (?:async )?(function|const|interface|type) (\w+)/gm)]
                .map(([, kind, symbol]) => kind === 'interface' || kind === 'type'
                  ? `export type ${symbol} = import(${JSON.stringify(path)}).${symbol};`
                  : `export const ${symbol}: typeof import(${JSON.stringify(path)}).${symbol};`);
              return `declare module 'daysite/${name}' { ${declarations.join('\n')} }`;
            }),
            ...COMPONENTS.filter((name) => name !== 'Layout').map((name) => `declare module 'daysite/components/${name}.astro' { const component: typeof import(${JSON.stringify(defaultComponent(name))}).default; export default component; }`),
            `declare module 'daysite/layouts/Layout.astro' { const component: typeof import(${JSON.stringify(defaultComponent('Layout'))}).default; export default component; }`,
          ].join('\n') });
        }
      },
      'astro:config:setup': ({ config, updateConfig, injectRoute, addWatchFile }) => {
        const publicDir = fileURLToPath(config.publicDir);
        // A project-owned Astro site still gets the default theme's store badges and icons.
        if (resolve(publicDir) !== resolve(TEMPLATE_ROOT, 'public')) {
          for (const directory of ['badges', 'icons']) {
            cpSync(resolve(TEMPLATE_ROOT, 'public', directory), join(publicDir, directory), { recursive: true });
          }
        }
        for (const source of customization.publicDirs) {
          if (!existsSync(source)) throw new Error(`daysite public directory does not exist: ${source}`);
          if (resolve(source) === resolve(publicDir)) continue;
          for (const name of readdirSync(source)) {
            if (['app', 'gallery', 'downloads', 'webapp', 'main', 'prerelease'].includes(name)) {
              throw new Error(`Theme public assets cannot replace generated publication assets: ${name}`);
            }
            mkdirSync(publicDir, { recursive: true });
            cpSync(join(source, name), join(publicDir, name), { recursive: true });
          }
        }
        const disabled = new Set(customization.disabledRoutes);
        const overrides = new Map(customization.routes.map((route) => [route.pattern, route]));
        if (overrides.size !== customization.routes.length) throw new Error('Duplicate daysite route patterns');
        if (options.injectDefaults) {
          for (const [pattern, page] of Object.entries(DEFAULT_ROUTES)) {
            if (!disabled.has(pattern) && !overrides.has(pattern)) {
              injectRoute({ pattern, entrypoint: resolve(TEMPLATE_ROOT, 'src/pages', page), prerender: true });
            }
          }
        } else if (disabled.size || [...overrides.keys()].some((key) => key in DEFAULT_ROUTES)) {
          throw new Error('Replacing default routes requires a custom srcDir; replace LandingPage or Layout for component overrides');
        }
        for (const route of overrides.values()) injectRoute(route);
        for (const file of [...customization.watchFiles, ...customization.customCss]) addWatchFile(file);
        const alias = COMPONENTS.map((name) => ({
          find: `@daysite/components/${name}`,
          replacement: customization.components[name] ?? defaultComponent(name),
        }));
        // Public imports always name the original component, so an override can wrap it safely.
        alias.push(
          { find: /^daysite\/components\/(.+)$/, replacement: resolve(TEMPLATE_ROOT, 'src/components') + '/$1' },
          { find: /^daysite\/layouts\/(.+)$/, replacement: resolve(TEMPLATE_ROOT, 'src/layouts') + '/$1' },
          ...['data', 'routes', 'types', 'customization-types', 'i18n', 'uistrings', 'html'].map((name) => ({
            find: `daysite/${name}`, replacement: resolve(TEMPLATE_ROOT, 'src/lib', `${name}.ts`),
          })),
        );
        updateConfig({ vite: { resolve: { alias }, plugins: [{
          // Astro 5 interprets absolute virtual style/script IDs outside root as browser paths.
          // Mark those queries as filesystem URLs; keep original source IDs for compilation/HMR.
          name: 'daysite-external-astro-queries', enforce: 'pre',
          resolveId(id, importer) {
            if (importer?.startsWith('/@fs/') && id.startsWith('.')) {
              return this.resolve(id, importer.slice('/@fs'.length), { skipSelf: true });
            }
            const filename = id.split('?')[0];
            if (!id.includes('?astro&') || !isAbsolute(filename) || id.startsWith('/@fs/')) return;
            const pathFromRoot = relative(fileURLToPath(config.root), filename);
            if ((pathFromRoot === '..' || pathFromRoot.startsWith('..' + sep) || isAbsolute(pathFromRoot)) && existsSync(filename)) {
              return '/@fs' + (id.startsWith('/') ? '' : '/') + id;
            }
          },
        }, {
          name: 'daysite-tailwind-sources', enforce: 'pre',
          transform: { order: 'pre', handler(code, id) {
            if (id.split('?')[0] !== resolve(TEMPLATE_ROOT, 'src/styles/global.css')) return;
            const sources = new Set([
              resolve(TEMPLATE_ROOT, 'src'),
              customization.srcDir,
              ...Object.values(customization.components).map((path) => resolve(path, '..')),
            ].filter(Boolean));
            if (sources.size) return code + '\n' + [...sources].map((path) => `@source ${JSON.stringify(path)};`).join('\n');
          } },
        }, {
          name: 'daysite-custom-styles',
          resolveId(id) { if (id === 'virtual:daysite/styles') return '\0virtual:daysite/styles'; },
          load(id) {
            if (id === '\0virtual:daysite/styles') {
              return customization.customCss.map((path) => `import ${JSON.stringify(path)};`).join('\n');
            }
          },
        }] } });
      },
    },
  };
}
