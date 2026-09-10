import type { APIRoute } from 'astro';
import { loadSite } from '../lib/data.ts';
import type { AssetView } from '../lib/types.ts';

/**
 * The site's web app manifest (W3C Web Application Manifest), so that "Add to Home Screen"
 * from the landing page installs the hosted web app rather than the landing page: `start_url`
 * is the app under `<base>/<webapp>/`, and `id` names the same URL the app's own manifest
 * resolves to (its `start_url: "./"`), so a browser sees one app whichever page it was
 * installed from. The scope is the whole site, which is what lets a page outside `webapp/`
 * carry this manifest at all. Icons are the favicon set the generator copied from the icon
 * family; screenshots, when the gallery has captures with known sizes, are what an install
 * dialog shows — phones as the narrow form factor, desktops and the web as the wide one.
 *
 * Built once, at every site build; Layout.astro links it only when a web build is staged.
 */
export const GET: APIRoute = async () => {
  const data = await loadSite();
  const { site } = data;
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const app = data.apps[0];
  const locale = data.defaultLocale;
  const hero = app?.hero(locale);
  const webapp = site.webapp ?? 'webapp';
  const startURL = data.hasWebApp ? `${base}${webapp}/` : base;
  const rebase = (p: string) => base + p.replace(/^\/+/, '');

  const icons: Array<Record<string, string>> = [];
  const favicons = data.favicons;
  if (favicons) {
    if (favicons.pwaIcon192) {
      icons.push({ src: rebase(favicons.pwaIcon192), sizes: '192x192', type: 'image/png', purpose: 'any' });
    }
    icons.push({ src: rebase(favicons.appleTouchIcon), sizes: '256x256', type: 'image/png', purpose: 'any' });
    icons.push({ src: rebase(favicons.pwaIcon512), sizes: '512x512', type: 'image/png', purpose: 'any' });
    icons.push({ src: rebase(favicons.pwaIcon512), sizes: '512x512', type: 'image/png', purpose: 'maskable' });
  }

  // Up to three captures per form factor, each with its size known (the manifest requires it)
  // and all of one form factor sharing the first's aspect ratio (Chrome's rule for showing them).
  const screenshots: Array<Record<string, string>> = [];
  const ratio: Partial<Record<'narrow' | 'wide', [number, number]>> = {};
  const take = (shots: AssetView[] | undefined, form: 'narrow' | 'wide') => {
    for (const s of shots ?? []) {
      if (!s.width || !s.height) continue;
      if (screenshots.filter((x) => x.form_factor === form).length >= 3) break;
      if ((form === 'narrow') !== s.height > s.width) continue;
      // Exact, by cross-multiplication: a near miss (an iPhone 16 next to a 15) is still a
      // different shape to the install dialog.
      const first = (ratio[form] ??= [s.width, s.height]);
      if (s.width * first[1] !== s.height * first[0]) continue;
      screenshots.push({
        src: s.url.startsWith('/') && !s.url.startsWith(base) ? rebase(s.url) : s.url,
        sizes: `${s.width}x${s.height}`,
        type: 'image/png',
        form_factor: form,
        label: s.alt,
      });
    }
  };
  if (app) {
    for (const p of ['ios', 'android']) take(app.view(locale, p)?.screenshots, 'narrow');
    for (const p of ['web', 'macos', 'windows', 'linux-gtk', 'linux-qt']) take(app.view(locale, p)?.screenshots, 'wide');
  }

  const manifest: Record<string, unknown> = {
    id: startURL,
    name: hero?.title ?? site.title ?? 'App',
    short_name: hero?.title ?? site.title ?? 'App',
    ...(hero?.subtitle ? { description: hero.subtitle } : {}),
    lang: locale,
    dir: 'auto',
    start_url: startURL,
    scope: base,
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: site.accentColor ?? '#3B82F6',
    icons,
    ...(screenshots.length ? { screenshots } : {}),
  };
  return new Response(JSON.stringify(manifest, null, 2) + '\n', {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8' },
  });
};
