/**
 * URL helpers for the localized routes. The single-app site only renders the locale-index
 * routes, so it never invokes appPageHref().
 *
 * Every href is prefixed with `import.meta.env.BASE_URL`, which Astro derives
 * from the `base:` config. For a root-deployed site this is `/`; for a
 * subpath deployment such as `https://example.github.io/Fair-Skies/` it is
 * `/Fair-Skies/`, so `localeIndexHref('en')` yields `/Fair-Skies/en/`.
 *
 * A non-default build channel adds one segment after the locale (lib/channels.ts): the release
 * channel owns `/en/`, the development channel lives at `/en/main/`, and every route below takes
 * that segment as its `channel` argument. The default channel passes '' and the URLs are the
 * ones the site has always had.
 */

import type { LocaleInfo, LocaleLink } from './types.ts';

// Astro always normalizes BASE_URL to end with a slash. The fallback is for the Node side:
// astro.config.mjs imports lib/data.ts, which imports this module before a base is resolved.
const BASE = import.meta.env.BASE_URL ?? '/';

/** `main` → `main/`; '' or undefined → ''. */
function seg(channel?: string): string {
  return channel ? `${channel}/` : '';
}

/** Locale index page: {base}{locale}/{channel}/ */
export function localeIndexHref(locale: string, channel?: string): string {
  return `${BASE}${locale}/${seg(channel)}`;
}

/** Gallery page: {base}{locale}/{channel}/gallery/ */
export function galleryHref(locale: string, channel?: string): string {
  return `${BASE}${locale}/${seg(channel)}gallery/`;
}

/** Per-app sub-page: {base}{locale}/{channel}/apps/{slug}/ */
export function appPageHref(locale: string, slug: string, channel?: string): string {
  return `${BASE}${locale}/${seg(channel)}apps/${encodeURIComponent(slug)}/`;
}

/** A site-root-relative path (`main/downloads/app.dmg`) under the deployment base. */
export function siteHref(path: string): string {
  return /^https?:\/\//i.test(path) ? path : `${BASE}${path.replace(/^\/+/, '')}`;
}

/** Build the per-page LocaleLink list pointing every locale at the same path-template. */
export function localeLinksFor(
  locales: LocaleInfo[],
  hrefFor: (code: string) => string,
): LocaleLink[] {
  return locales.map((l) => ({ ...l, href: hrefFor(l.code) }));
}
