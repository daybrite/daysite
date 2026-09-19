import { existsSync, readFileSync } from 'node:fs';
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
  IconEffect,
  LocaleInfo,
  PermissionView,
  PlatformEntry,
  PlatformView,
  SiteData,
  SiteInfo,
} from './types.ts';
import { ICON_EFFECTS } from './types.ts';
import {
  dedupeLocales,
  localeInfo,
  pickAsset,
  pickAssetList,
  pickText,
  sortLocales,
} from './i18n.ts';
import { DAY_TARGETS, dayTarget, orderKeys } from './day-targets.ts';
import {
  describePermission,
  shouldHideAndroidPermission,
  sortPermissions,
  type PermissionPlatform,
} from './permissions.ts';
import { lookupAndroidDescription, lookupPermissionLabel } from './permission-descriptions.ts';
import { loadGallery, type GalleryManifest } from './gallery.ts';
import {
  loadChannels,
  pickChannel,
  type ChannelRecord,
  type ChannelView,
} from './channels.ts';
import { siteHref } from './routes.ts';

// Where a project's site lands when its index names no locale at all: a piece's demo app, which
// has UI strings but no store listing to localize. `en` rather than `en-US` because that is the
// code the rest of the system already uses — every `store/<locale>/` listing in the ecosystem is
// `en`, and so is every app's `resource/locales/` directory — so a project with a listing and one
// without answer at the same path instead of differing by a region tag nobody wrote.
const FALLBACK_DEFAULT_LOCALE = 'en';

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

/**
 * site.toml, parsed once. Each channel gets its OWN copy (loadSite fills in a missing `title`
 * from that channel's appindex), so the memo holds the parse rather than the object.
 */
let siteInfoRaw: Promise<Record<string, unknown>> | undefined;

export async function loadSiteInfo(): Promise<SiteInfo> {
  const raw = await (siteInfoRaw ??= readFile(siteInfoPath(), 'utf8').then(
    (t) => parseTOML(t) as Record<string, unknown>,
  ));
  // TOML kebab-case keys are accepted alongside camelCase, so site.toml reads like Day.toml
  // (`accent-color`) while the code keeps appland's field names.
  const parsed: Partial<SiteInfo> = {};
  for (const [k, v] of Object.entries(raw)) {
    const camel = k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    (parsed as Record<string, unknown>)[camel] = v;
  }
  if (!parsed.host) throw new Error('site.toml: "host" is required');
  // A misspelled effect would otherwise ship as silence — the mark simply never moves, and
  // nothing in the build says why. `host` already fails the build when it is wrong; so does
  // this.
  if (parsed.iconEffect && !ICON_EFFECTS.includes(parsed.iconEffect)) {
    throw new Error(
      `site.toml: icon-effect = "${parsed.iconEffect}" is not one of ${ICON_EFFECTS.join(', ')}`,
    );
  }
  return {
    iconEffect: 'raise',
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

export async function loadAppIndex(siteInfo: SiteInfo, channel?: ChannelRecord): Promise<AppIndex> {
  const ref = channel?.appindex ?? siteInfo.appindex ?? 'appindex.json';
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
 * The SVG master's own markup, for inlining into the landing page.
 *
 * The mark is normally an `<img>`, and CSS cannot reach inside one — so an icon effect
 * (site.toml `icon-effect`) needs the master in the document. The generator has already
 * copied it to `public/app/icon.svg` and hidden the reserved layers there, so this reads that
 * copy rather than the project's.
 *
 * Returns nothing when the project ships no SVG master, or when the master marks no layers:
 * every effect moves `day:` layers against each other, and there is nothing to move in a flat
 * drawing. The page then renders the plain mark, which is what it did before effects existed.
 */
function vectorIconMarkup(): string | undefined {
  const path = resolve(projectRoot(), 'public', 'app', 'icon.svg');
  if (!existsSync(path)) return undefined;
  const svg = readFileSync(path, 'utf8');
  if (!/\bid="day:(background|foreground)/.test(svg)) return undefined;
  // The master carries its own pixel size; the page sizes the mark with CSS.
  return svg.replace(/<svg\b[^>]*>/, (open) => open.replace(/\s(width|height)="[^"]*"/g, ''));
}

/**
 * The raster favicon set, when the generator copied one into `public/app/` from the size-exact
 * icon family `day icon` renders (see generate-appindex.mjs). Without the family, the app mark
 * itself fills every slot — larger than needed, and still the app's own icon. The SVG master,
 * when there is one, is what browsers actually prefer; these cover the apple-touch and PWA
 * slots, which take no SVG. Nothing here rasterizes: the site build carries no image library.
 */
function rasterFavicons(): FaviconPaths | undefined {
  const pub = resolve(projectRoot(), 'public', 'app');
  const has = (name: string) => existsSync(resolve(pub, name));
  if (['favicon-64.png', 'apple-touch-icon.png', 'icon-512.png'].every(has)) {
    return {
      icon: '/app/favicon-64.png',
      appleTouchIcon: '/app/apple-touch-icon.png',
      ...(has('icon-192.png') ? { pwaIcon192: '/app/icon-192.png' } : {}),
      pwaIcon512: '/app/icon-512.png',
    };
  }
  if (has('icon.png')) {
    const one = '/app/icon.png';
    return { icon: one, appleTouchIcon: one, pwaIcon192: one, pwaIcon512: one };
  }
  return undefined;
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

/** The permission vocabulary an appindex platform key speaks; every other key takes iOS's
 *  (its rows are then whatever the index carries, labeled by their key). */
function permissionPlatform(platformId: string): PermissionPlatform {
  return platformId === 'android' || platformId === 'macos' || platformId === 'harmony'
    ? platformId
    : 'ios';
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

  // Permissions: filter Android plumbing, attach localized descriptions. A platform with no
  // permission gate of its own (the web, desktop Linux, Windows) lists none, which is true.
  const permissions: PermissionView[] = [];
  if (platform.permissions) {
    for (const p of platform.permissions) {
      if (platformId === 'android' && shouldHideAndroidPermission(p.key)) continue;
      let desc = pickText(p.description, locale).value;
      if (!desc && platformId === 'android') {
        desc = lookupAndroidDescription(p.key, locale);
      }
      const view = describePermission(p.key, permissionPlatform(platformId), desc);
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
    // A release channel's artifacts carry absolute releases/latest/download URLs; a development
    // channel's are staged on the site itself (`main/downloads/…`), because a branch build has no
    // release to link. `siteHref` passes the first through and puts the second under the
    // deployment base, so the card renders one kind of link either way.
    artifacts: (platform.artifacts ?? []).map((a) => ({ ...a, url: siteHref(a.url) })),
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
  /** True when this app's favicon set is the site's (false for every app in multi-app mode). */
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
      platformIds
        .map((k) => app.platforms[k])
        .find((p) => p?.assets?.icon || p?.assets?.iconVector) ??
      app.platforms[platformIds[0]!]!;
    const title = pickText(app.title ?? primary.title, locale).value ?? app.name;
    const subtitle = pickText(app.subtitle ?? primary.subtitle, locale).value ?? '';
    const description = pickText(app.description ?? primary.description, locale).value ?? '';
    // The SVG master, when the project ships one — crisp at any size; else the raster.
    const iconURL = resolveAssetURL(
      primary.assets?.iconVector?.location ?? primary.assets?.icon?.location,
      app,
    );
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

  // Single-app: the favicon set is this app's. Multi-app: the site's, taken once below.
  const favicons = opts.generateAppFavicons ? rasterFavicons() : undefined;

  // The SVG master, served raw: the preferred favicon and mark wherever a browser renders
  // it. The raster set above still covers apple-touch / PWA slots (no SVG there) and doubles
  // as the fallback for projects without a master.
  let vectorIconURL: string | undefined;
  for (const k of platformIds) {
    vectorIconURL = resolveAssetURL(app.platforms[k]?.assets?.iconVector?.location, app);
    if (vectorIconURL) break;
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
    vectorIconURL,
  };
}

// Public entry point ─────────────────────────────────────────────────────────

export interface LoadedSite extends SiteData {
  /** Screenshot gallery data, when scripts/assemble-gallery.mjs has produced any. */
  gallery?: GalleryManifest;
  /** The app's own CSS overrides (website/theme.css beside site.toml), inlined into every page. */
  themeCss?: string;
  /**
   * True when this channel's web-dom build is staged under `public/<channel.webapp>/` (the
   * workflow unzips it there). The landing page then links `site.webmanifest`, whose start URL
   * is that app, so "Add to Home Screen" from the site installs the app itself.
   */
  hasWebApp: boolean;
  /** The channel these pages describe (lib/channels.ts). */
  channel: ChannelView;
  /** The app mark's hover treatment, and the master's markup when one can carry it. */
  iconEffect: IconEffect;
  iconMarkup?: string;
  /** Every channel the site publishes, in picker order; one entry when there is only one. */
  channels: ChannelView[];
  /**
   * Convenience accessor that returns the first (and, in single-app mode,
   * only) AppView. Existing single-app callers use this in place of the old
   * top-level `appView` field.
   */
  appView: AppView;
}

/** One entry per channel: each has its own appindex, gallery, and staged web build. */
const cached = new Map<string, LoadedSite>();

/**
 * Every channel the site publishes, in picker order, with `current` set on none of them —
 * routes call {@link loadSite} for the one they render. Cheap enough to call per page: it
 * reads one small JSON.
 */
export async function siteChannels(): Promise<{ default: string; channels: ChannelRecord[] }> {
  const site = await loadSiteInfo();
  return loadChannels(siteInfoPath(), site.appindex ?? 'appindex.json', site.webapp ?? 'webapp');
}

export async function loadSite(channelId?: string): Promise<LoadedSite> {
  const channelFile = await siteChannels();
  const channel = pickChannel(channelFile, channelId);
  const hit = cached.get(channel.id);
  if (hit) return hit;
  const site = await loadSiteInfo();
  const index = await loadAppIndex(site, channel);

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
        generateAppFavicons: !multiApp,
      }),
    );
  }

  // Site-level social image / favicons
  let siteSocialImage = site.socialImage;
  if (!siteSocialImage) {
    siteSocialImage = apps[0]?.socialImage;
  }

  // The favicon set the generator copied into public/app/ is the primary app's either way.
  const siteFavicons: FaviconPaths | undefined = multiApp ? rasterFavicons() : apps[0]?.favicons;

  const hasWebApp = existsSync(
    resolve(projectRoot(), 'public', ...channel.webapp.split('/'), 'index.html'),
  );

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

  const gallery = await loadGallery(siteInfoPath(), channel.gallery);
  let themeCss: string | undefined;
  const themePath = resolve(dirname(siteInfoPath()), 'theme.css');
  if (existsSync(themePath)) themeCss = await readFile(themePath, 'utf8');

  const loaded: LoadedSite = {
    hasWebApp,
    site,
    gallery,
    themeCss,
    locales,
    defaultLocale,
    apps,
    multiApp,
    socialImage: siteSocialImage,
    favicons: siteFavicons,
    // The primary app's SVG master doubles as the site-wide favicon preference.
    vectorIcon: apps[0]?.vectorIconURL,
    iconEffect: site.iconEffect ?? 'raise',
    iconMarkup: site.iconEffect === 'none' ? undefined : vectorIconMarkup(),
    channel: { ...channel, current: true },
    channels: channelFile.channels.map((c) => ({ ...c, current: c.id === channel.id })),
    appView: apps[0]!,
  };
  cached.set(channel.id, loaded);
  return loaded;
}

export { resolveAssetURL };
