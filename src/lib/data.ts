import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseTOML } from 'smol-toml';

import type {
  AppEntry,
  AppIndex,
  AppView,
  AssetView,
  FaviconPaths,
  HeroView,
  LocaleInfo,
  PermissionView,
  PlatformEntry,
  PlatformView,
  SiteData,
  SiteInfo,
} from './types.ts';
import {
  dedupeLocales,
  localeInfo,
  pickAsset,
  pickAssetList,
  pickText,
  sortLocales,
} from './i18n.ts';
import { DAY_TARGETS, dayTarget, orderKeys } from './day-targets.ts';
import { describePermission, shouldHideAndroidPermission, sortPermissions } from './permissions.ts';
import { lookupAndroidDescription, lookupPermissionLabel } from './permission-descriptions.ts';
import { generateFavicons } from './favicon.ts';
import { loadGallery, type GalleryManifest } from './gallery.ts';

const FALLBACK_DEFAULT_LOCALE = 'en-US';

/** Resolve `website/site.toml` starting from the daysite template root. */
function projectRoot(): string {
  // This module lives at <template>/src/lib/data.ts; the Astro build runs with cwd at the
  // template root. In CI that is a checkout of daybrite/daysite; locally it is the clone the
  // preview script makes inside the app's website/ directory.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..');
}

function siteInfoPath(): string {
  // `DAYSITE_CONFIG` points at the app's site.toml. Without it, the conventional location: the
  // template is cloned into <app>/website/.daysite/, so the config is one level up. A bare
  // template checkout (neither present) falls back to the bundled sample, so `npm run dev`
  // still shows something real.
  const env = process.env.DAYSITE_CONFIG;
  if (env) return isAbsolute(env) ? env : resolve(process.cwd(), env);
  const conventional = resolve(projectRoot(), '..', 'site.toml');
  if (existsSync(conventional)) return conventional;
  return resolve(projectRoot(), 'samples', 'site.toml');
}

export async function loadSiteInfo(): Promise<SiteInfo> {
  const raw = await readFile(siteInfoPath(), 'utf8');
  // TOML kebab-case keys are accepted alongside camelCase, so site.toml reads like Day.toml
  // (`accent-color`) while the code keeps appland's field names.
  const table = parseTOML(raw) as Record<string, unknown>;
  const parsed: Partial<SiteInfo> = {};
  for (const [k, v] of Object.entries(table)) {
    const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    (parsed as Record<string, unknown>)[camel] = v;
  }
  if (!parsed.host) throw new Error('site.toml: "host" is required');
  return {
    showSourceLink: true,
    showStoreBadges: true,
    showPermissions: true,
    showDependencyCount: true,
    defaultTheme: 'system',
    accentColor: '#3B82F6',
    appindex: 'appindex.json',
    ...parsed,
  } as SiteInfo;
}

export async function loadAppIndex(siteInfo: SiteInfo): Promise<AppIndex> {
  const ref = siteInfo.appindex ?? 'appindex.json';
  const baseDir = dirname(siteInfoPath());
  const path = isAbsolute(ref) ? ref : resolve(baseDir, ref);
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as AppIndex;
  if (!parsed.apps || !parsed.apps.length) {
    throw new Error(`appindex.json at ${path} contains no apps`);
  }
  return parsed;
}

// Asset URL resolution ────────────────────────────────────────────────────────

function resolveAssetURL(
  location: string | undefined,
  app: AppEntry,
): string | undefined {
  if (!location) return undefined;
  if (/^https?:\/\//i.test(location)) return location;
  const base = app.source?.assets;
  if (!base) {
    // Site-relative asset (the generator writes gallery/… and app/icon.png): serve it under
    // the deployment base, which for a GitHub project page is /<repo>/, not /.
    const siteBase = import.meta.env.BASE_URL ?? '/';
    return location.startsWith('/')
      ? location
      : `${siteBase}${siteBase.endsWith('/') ? '' : '/'}${location}`;
  }
  const trimmedBase = base.endsWith('/') ? base : `${base}/`;
  const trimmedLoc = location.startsWith('/') ? location.slice(1) : location;
  return trimmedBase + trimmedLoc;
}

/**
 * The icon as something the favicon generator can READ, which is not the same thing as the URL a
 * page links to.
 *
 * `resolveAssetURL` returns a browser path for a site-relative asset (`/<base>/app/icon.png`).
 * That looks like an absolute filesystem path and is not one, so handing it to the generator ends
 * in ENOENT — swallowed as "could not fetch the icon", leaving the site with no favicon and no
 * error. A site-relative location is a file under `public/`, so resolve it there.
 */
function resolveIconSource(
  location: string | undefined,
  app: AppEntry,
): string | undefined {
  if (!location) return undefined;
  if (/^https?:\/\//i.test(location)) return location;
  if (app.source?.assets) return resolveAssetURL(location, app);
  return resolve(projectRoot(), 'public', location.replace(/^\/+/, ''));
}

// Locale collection ──────────────────────────────────────────────────────────

function collectLocales(app: AppEntry): string[] {
  const seen = new Set<string>();
  const visit = (obj: Record<string, unknown> | undefined) => {
    if (!obj) return;
    for (const k of Object.keys(obj)) seen.add(k);
  };
  // Collect from app-level promoted fields
  for (const fld of ['title', 'subtitle', 'description', 'keywords', 'releaseNotes'] as const) {
    const v = app[fld];
    if (v && typeof v === 'object') visit(v as Record<string, unknown>);
  }
  // Collect from per-platform fields
  for (const platform of Object.values(app.platforms)) {
    if (!platform) continue;
    for (const fld of ['title', 'subtitle', 'description', 'keywords', 'releaseNotes'] as const) {
      const v = platform[fld];
      if (v && typeof v === 'object') visit(v as Record<string, unknown>);
    }
    visit(platform.assets?.featureGraphic as Record<string, unknown> | undefined);
    visit(platform.assets?.screenshots as Record<string, unknown> | undefined);
    if (platform.permissions) {
      for (const p of platform.permissions) {
        if (p.description) visit(p.description);
      }
    }
  }
  return Array.from(seen);
}

function pickDefaultLocale(locales: string[]): string {
  if (locales.includes('en-US')) return 'en-US';
  if (locales.includes('en')) return 'en';
  return locales[0]!;
}

// Per-platform view ──────────────────────────────────────────────────────────

function buildPlatformView(
  app: AppEntry,
  platform: PlatformEntry,
  platformId: string,
  locale: string,
  defaultLocale: string,
): PlatformView {

  // Localized fields: platform overrides app-level
  const title = pickText(platform.title ?? app.title, locale);
  const subtitle = pickText(platform.subtitle ?? app.subtitle, locale);
  const description = pickText(platform.description ?? app.description, locale);
  const releaseNotes = pickText(platform.releaseNotes ?? app.releaseNotes, locale);

  // Assets are now in platform.assets
  const iconURL = resolveAssetURL(platform.assets?.icon?.location, app);

  const fg = pickAsset(platform.assets?.featureGraphic, locale);
  const featureGraphicURL = resolveAssetURL(fg.value?.location, app);

  const ssRequested = pickAssetList(platform.assets?.screenshots, locale);
  const ssFallback = ssRequested.value
    ? ssRequested
    : pickAssetList(platform.assets?.screenshots, defaultLocale);
  const screenshotsList = ssFallback.value ?? [];
  const screenshotsLocale = ssFallback.localeUsed ?? locale;
  const screenshots: AssetView[] = screenshotsList.map((s, i) => ({
    url: resolveAssetURL(s.location, app) ?? '',
    width: s.width,
    height: s.height,
    alt: `${title.value ?? app.name} screenshot ${i + 1} (${screenshotsLocale})`,
  }));

  // Permissions: filter Android plumbing, attach localized descriptions.
  const permissions: PermissionView[] = [];
  if (platform.permissions) {
    for (const p of platform.permissions) {
      if (platformId === 'android' && shouldHideAndroidPermission(p.key)) continue;
      let desc = pickText(p.description, locale).value;
      if (!desc && platformId === 'android') {
        desc = lookupAndroidDescription(p.key, locale);
      }
      const view = describePermission(p.key, platformId, desc);
      view.label = lookupPermissionLabel(view.label, locale);
      permissions.push(view);
    }
  }
  const sortedPerms = sortPermissions(permissions);

  const privacyURL = pickText(app.links?.['privacy'], locale).value;
  const supportURL = pickText(app.links?.['support'], locale).value;

  const dists = platform.channels ?? {};
  let storeURL: string | undefined;
  let storeBadge: PlatformView['storeBadge'];
  const apple = dists['appleappstore'];
  const google = dists['googleplaystore'];
  if (platformId === 'ios' && apple?.url) {
    storeURL = apple.url;
    storeBadge = 'apple-app-store';
  } else if (platformId === 'android' && google?.url) {
    storeURL = google.url;
    storeBadge = 'google-play-store';
  } else {
    const anyDist = Object.values(dists).find((d) => !!d?.url);
    if (anyDist?.url) storeURL = anyDist.url;
  }

  const day = dayTarget(platformId);
  return {
    id: platformId,
    displayName: day?.name ?? platformId,
    target: platform.platform ?? day?.target,
    artifacts: platform.artifacts ?? [],
    version: platform.version,
    buildNumber: platform.buildNumber,
    storeURL,
    storeBadge,
    title: title.value ?? app.name,
    subtitle: subtitle.value ?? '',
    description: description.value ?? '',
    releaseNotes: releaseNotes.value,
    iconURL,
    featureGraphicURL,
    screenshots,
    permissions: sortedPerms,
    privacyURL,
    supportURL,
    dependencyCount: countSbomDependencies(platform),
    rawTitleLocaleUsed: title.localeUsed ?? locale,
    rawDescriptionLocaleUsed: description.localeUsed ?? locale,
  };
}

function countSbomDependencies(platform: PlatformEntry): number {
  const pkgs = platform.sbom?.packages;
  if (!pkgs) return 0;
  return pkgs.filter((p) => {
    const v = p.versionInfo ?? '';
    return v && v !== 'source';
  }).length;
}

// Per-app view ────────────────────────────────────────────────────────────────

interface BuildAppViewOpts {
  /** Locale list shared across the whole site (union over apps in multi-app mode). */
  locales: LocaleInfo[];
  defaultLocale: string;
  /** True when generating favicons for this app (skipped for non-primary apps in multi-app mode). */
  generateAppFavicons: boolean;
}

async function buildAppView(
  app: AppEntry,
  opts: BuildAppViewOpts,
): Promise<AppView> {
  const platformIds = orderKeys(
    Object.keys(app.platforms).filter((k) => !!app.platforms[k]),
  );

  const view = (locale: string, platform: string): PlatformView | null => {
    const p = app.platforms[platform];
    if (!p) return null;
    return buildPlatformView(app, p, platform, locale, opts.defaultLocale);
  };

  const hero = (locale: string): HeroView => {
    const primary =
      platformIds.map((k) => app.platforms[k]).find((p) => p?.assets?.icon) ??
      app.platforms[platformIds[0]!]!;
    const title = pickText(app.title ?? primary.title, locale).value ?? app.name;
    const subtitle = pickText(app.subtitle ?? primary.subtitle, locale).value ?? '';
    const description = pickText(app.description ?? primary.description, locale).value ?? '';
    const iconURL = resolveAssetURL(primary.assets?.icon?.location, app);
    const fg = pickAsset(primary.assets?.featureGraphic, locale);
    const featureGraphicURL = resolveAssetURL(fg.value?.location, app);
    return { title, subtitle, description, iconURL, featureGraphicURL };
  };

  // Social card image: explicit override (site-level) is handled outside.
  let socialImage: string | undefined;
  for (const k of platformIds) {
    const fgMap = app.platforms[k]?.assets?.featureGraphic;
    if (!fgMap) continue;
    const fg = pickAsset(fgMap, opts.defaultLocale);
    socialImage = resolveAssetURL(fg.value?.location, app);
    if (socialImage) break;
  }
  if (!socialImage) {
    for (const k of platformIds) {
      socialImage = resolveAssetURL(app.platforms[k]?.assets?.icon?.location, app);
      if (socialImage) break;
    }
  }

  let favicons: AppView['favicons'];
  if (opts.generateAppFavicons) {
    let iconSource: string | undefined;
    for (const k of platformIds) {
      iconSource = resolveIconSource(app.platforms[k]?.assets?.icon?.location, app);
      if (iconSource) break;
    }
    if (iconSource) {
      try {
        favicons = await generateFavicons({
          iconSource,
          projectRoot: projectRoot(),
        });
      } catch (err) {
        console.warn(
          `[appland] favicon generation failed for ${app.name} (${(err as Error).message})`,
        );
      }
    }
  }

  return {
    app,
    slug: app.name,
    defaultLocale: opts.defaultLocale,
    locales: opts.locales,
    platforms: platformIds,
    view,
    hero,
    sourceURL: app.source?.url,
    releaseURL: app.source?.release,
    socialImage,
    favicons,
  };
}

// Public entry point ─────────────────────────────────────────────────────────

export interface LoadedSite extends SiteData {
  /** Screenshot gallery data, when scripts/assemble-gallery.mjs has produced any. */
  gallery?: GalleryManifest;
  /** The app's own CSS overrides (website/theme.css beside site.toml), inlined into every page. */
  themeCss?: string;
  /**
   * Convenience accessor that returns the first (and, in single-app mode,
   * only) AppView. Existing single-app callers use this in place of the old
   * top-level `appView` field.
   */
  appView: AppView;
}

let cached: LoadedSite | undefined;

export async function loadSite(): Promise<LoadedSite> {
  if (cached) return cached;
  const site = await loadSiteInfo();
  const index = await loadAppIndex(site);

  // Locale union across every app in the index
  const localeUnion = new Set<string>();
  for (const app of index.apps) {
    for (const c of collectLocales(app)) localeUnion.add(c);
  }
  if (localeUnion.size === 0) localeUnion.add(FALLBACK_DEFAULT_LOCALE);

  // The union mixes vocabularies (store tags, capture-variant names), so collapse the codes that
  // name one language twice before anything routes or renders off them.
  const localesRaw = dedupeLocales(Array.from(localeUnion));
  const defaultLocale = pickDefaultLocale(localesRaw);
  const orderedCodes = sortLocales(localesRaw, defaultLocale);
  const locales: LocaleInfo[] = orderedCodes.map((c) => localeInfo(c, defaultLocale));

  const multiApp = index.apps.length > 1;

  const apps: AppView[] = [];
  for (let i = 0; i < index.apps.length; i++) {
    const app = index.apps[i]!;
    apps.push(
      await buildAppView(app, {
        locales,
        defaultLocale,
        // Single-app: generate favicons from the app's icon (existing behaviour).
        // Multi-app: site-level favicons are produced separately below.
        generateAppFavicons: !multiApp,
      }),
    );
  }

  // Site-level social image / favicons
  let siteSocialImage = site.socialImage;
  if (!siteSocialImage) {
    siteSocialImage = apps[0]?.socialImage;
  }

  let siteFavicons: FaviconPaths | undefined;
  if (multiApp) {
    // Use the first app's icon as the site favicon source for now. The
    // aggregate site can override by placing files under public/.
    const firstApp = apps[0];
    const iconSource = firstApp
      ? firstApp.platforms
          .map((k) =>
            resolveAssetURL(firstApp.app.platforms[k]?.assets?.icon?.location, firstApp.app),
          )
          .find((u) => !!u)
      : undefined;
    if (iconSource) {
      try {
        siteFavicons = await generateFavicons({
          iconSource,
          projectRoot: projectRoot(),
        });
      } catch (err) {
        console.warn(
          `[appland] site favicon generation failed (${(err as Error).message})`,
        );
      }
    }
  } else {
    siteFavicons = apps[0]?.favicons;
  }

  // site.toml's `title` is optional for a Day app: the store listing already names the app in
  // every locale, so an absent value inherits from the (first) app.
  if (!site.title) {
    const first = index.apps[0]!;
    site.title = first.title ?? first.name;
  }
  // `footer` stays whatever site.toml says, including nothing. A synthesized "© <year> <app>"
  // used to fill the slot, which put a copyright notice nobody had written under every page of
  // every scaffold — and in one language, whatever the page's own. The footer instead carries
  // the Day attribution, which is localized; an author who wants a copyright writes one.

  const gallery = await loadGallery(siteInfoPath());
  let themeCss: string | undefined;
  const themePath = resolve(dirname(siteInfoPath()), 'theme.css');
  if (existsSync(themePath)) themeCss = await readFile(themePath, 'utf8');

  cached = {
    site,
    gallery,
    themeCss,
    locales,
    defaultLocale,
    apps,
    multiApp,
    socialImage: siteSocialImage,
    favicons: siteFavicons,
    appView: apps[0]!,
  };
  return cached;
}

export { resolveAssetURL };
