import type {
  AssetFile,
  LocaleInfo,
  LocalizedAsset,
  LocalizedAssetList,
  LocalizedText,
} from './types.ts';

// Native names for the locales we expect to encounter in publication-format documents. The list
// is intentionally permissive — anything not present here just falls back to the locale code
// itself.
//
// ONE ENTRY PER NAME. A regional tag belongs here only when it is named differently from its
// language (`pt-BR` is "Português (Brasil)", `pt-PT` is not), because `localeName` walks the tag
// from most to least specific: `de-DE` finds `de`, `zh-Hans-CN` finds `zh-Hans`. Adding
// `de-DE: Deutsch` beside `de: Deutsch` changes nothing except how many places the name has to
// be corrected, and it is how `zh-CN` / `zh-Hans` / `zh-Hans-CN` ended up as three rows saying
// 简体中文.
const LOCALE_NAMES: Record<string, { native: string; english: string; rtl?: boolean }> = {
  ar: { native: 'العربية', english: 'Arabic', rtl: true },
  bn: { native: 'বাংলা', english: 'Bengali' },
  ca: { native: 'Català', english: 'Catalan' },
  cs: { native: 'Čeština', english: 'Czech' },
  da: { native: 'Dansk', english: 'Danish' },
  de: { native: 'Deutsch', english: 'German' },
  el: { native: 'Ελληνικά', english: 'Greek' },
  en: { native: 'English', english: 'English' },
  'en-GB': { native: 'English (UK)', english: 'English (UK)' },
  'en-US': { native: 'English (US)', english: 'English (US)' },
  es: { native: 'Español', english: 'Spanish' },
  'es-MX': { native: 'Español (México)', english: 'Spanish (Mexico)' },
  fa: { native: 'فارسی', english: 'Persian', rtl: true },
  fi: { native: 'Suomi', english: 'Finnish' },
  fr: { native: 'Français', english: 'French' },
  he: { native: 'עברית', english: 'Hebrew', rtl: true },
  hi: { native: 'हिन्दी', english: 'Hindi' },
  hu: { native: 'Magyar', english: 'Hungarian' },
  id: { native: 'Bahasa Indonesia', english: 'Indonesian' },
  it: { native: 'Italiano', english: 'Italian' },
  ja: { native: '日本語', english: 'Japanese' },
  ko: { native: '한국어', english: 'Korean' },
  ms: { native: 'Bahasa Melayu', english: 'Malay' },
  nl: { native: 'Nederlands', english: 'Dutch' },
  no: { native: 'Norsk', english: 'Norwegian' },
  pl: { native: 'Polski', english: 'Polish' },
  pt: { native: 'Português', english: 'Portuguese' },
  'pt-BR': { native: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  'pt-PT': { native: 'Português (Portugal)', english: 'Portuguese (Portugal)' },
  ro: { native: 'Română', english: 'Romanian' },
  ru: { native: 'Русский', english: 'Russian' },
  sv: { native: 'Svenska', english: 'Swedish' },
  th: { native: 'ไทย', english: 'Thai' },
  tr: { native: 'Türkçe', english: 'Turkish' },
  uk: { native: 'Українська', english: 'Ukrainian' },
  vi: { native: 'Tiếng Việt', english: 'Vietnamese' },
  zh: { native: '中文', english: 'Chinese' },
  'zh-Hans': { native: '简体中文', english: 'Chinese (Simplified)' },
  'zh-Hant': { native: '繁體中文', english: 'Chinese (Traditional)' },
};

/**
 * Chinese written with a region but no script. A site's locale codes arrive in two vocabularies:
 * store listings carry the app's Day tags (`zh-Hans-CN`) and screenshots carry the locale their
 * dayscript run was captured under (`zh-CN`). Every other language reconciles by subtag prefix,
 * but `zh-CN` and `zh-Hans-CN` share only `zh` — which `zh-TW` shares too — so the script has to
 * be filled in before the two can be recognized as one language.
 */
const CHINESE_SCRIPTS: Record<string, string> = {
  CN: 'Hans',
  SG: 'Hans',
  HK: 'Hant',
  MO: 'Hant',
  TW: 'Hant',
};

/** `zh-CN` → `zh-Hans-CN`, `zh-TW` → `zh-Hant-TW`. Every other tag is returned unchanged. */
export function expandLocale(code: string): string {
  const parts = code.split('-');
  if (parts[0] !== 'zh' || parts.length !== 2) return code;
  const script = CHINESE_SCRIPTS[parts[1]!.toUpperCase()];
  return script ? `zh-${script}-${parts[1]}` : code;
}

/** True when `a` is `b` or one of its ancestors: `zh-Hans` ⊐ `zh-Hans-CN`, `pt` ⊐ `pt-BR`. */
function covers(a: string, b: string): boolean {
  return b === a || b.startsWith(`${a}-`);
}

/**
 * Collapse locale codes that name the same language written two ways, keeping the more specific
 * spelling: `['zh-Hans-CN', 'zh-CN', 'fr-FR', 'fr']` → `['zh-Hans-CN', 'fr-FR']`. Genuinely
 * different variants survive, because neither covers the other — `pt-BR` and `pt-PT` both stay.
 *
 * Without this a picker offers 简体中文 twice, once per spelling, and the site builds two page
 * trees of the same content. Dropping the broader tag costs nothing: every lookup goes through
 * `resolveLocaleKey`, which finds a `zh-CN`-keyed screenshot list from a `zh-Hans-CN` page.
 */
export function dedupeLocales(codes: string[]): string[] {
  const uniq = Array.from(new Set(codes));
  const expanded = new Map(uniq.map((c) => [c, expandLocale(c)]));
  return uniq.filter((code) => {
    const mine = expanded.get(code)!;
    return !uniq.some((other) => {
      if (other === code) return false;
      const theirs = expanded.get(other)!;
      if (!covers(mine, theirs)) return false;
      if (theirs !== mine) return true; // the other is more specific
      // Same language spelled two ways: keep the one already written that way, so a project's
      // own Day tag survives rather than a capture-variant name.
      return other === theirs || (code !== mine && other < code);
    });
  });
}

/** The display metadata for a tag, from the most specific ancestor that has any. */
function localeName(code: string): { native: string; english: string; rtl?: boolean } | null {
  const parts = expandLocale(code).split('-');
  for (let i = parts.length; i > 0; i--) {
    const meta = LOCALE_NAMES[parts.slice(0, i).join('-')];
    if (meta) return meta;
  }
  return null;
}

/** Strip the region tag, e.g. "de-DE" → "de". */
export function languageOf(code: string): string {
  const dash = code.indexOf('-');
  return dash === -1 ? code : code.slice(0, dash);
}

/**
 * Generic locale-fallback resolver: exact → language-only → other regional
 * variant of the same language → en-US → en → first available.
 */
function resolveLocaleKey<V>(
  map: Record<string, V>,
  preferred: string,
): { value: V | undefined; localeUsed: string | undefined } {
  if (preferred in map) return { value: map[preferred], localeUsed: preferred };
  const lang = languageOf(preferred);
  if (lang !== preferred && lang in map) {
    return { value: map[lang], localeUsed: lang };
  }
  for (const k of Object.keys(map)) {
    if (languageOf(k) === lang) return { value: map[k], localeUsed: k };
  }
  if ('en-US' in map) return { value: map['en-US'], localeUsed: 'en-US' };
  if ('en' in map) return { value: map['en'], localeUsed: 'en' };
  const first = Object.keys(map)[0];
  if (first) return { value: map[first], localeUsed: first };
  return { value: undefined, localeUsed: undefined };
}

/**
 * Localized text fields in appindex.json may be either a localized map (object
 * keyed by locale) or, where the spec permits, a plain scalar string. We
 * accept both for ergonomic reasons.
 */
export function pickText(
  source: LocalizedText | string | undefined,
  preferred: string,
): { value: string | undefined; localeUsed: string | undefined } {
  if (source == null) return { value: undefined, localeUsed: undefined };
  if (typeof source === 'string') return { value: source, localeUsed: undefined };
  return resolveLocaleKey(source, preferred);
}

/** Same as pickText, but for localized maps of single assets. */
export function pickAsset(
  source: LocalizedAsset | undefined,
  preferred: string,
): { value: AssetFile | undefined; localeUsed: string | undefined } {
  if (source == null) return { value: undefined, localeUsed: undefined };
  return resolveLocaleKey<AssetFile>(source, preferred);
}

/** Same as pickText, but for localized lists of assets. */
export function pickAssetList(
  source: LocalizedAssetList | undefined,
  preferred: string,
): { value: AssetFile[] | undefined; localeUsed: string | undefined } {
  if (source == null) return { value: undefined, localeUsed: undefined };
  return resolveLocaleKey<AssetFile[]>(source, preferred);
}

/**
 * Display info for a locale code. The `href` always points to the locale's
 * own subpath (e.g. /en/, /ja/), even for the default locale: this lets the
 * bare / route function as a browser-language auto-detector that doesn't
 * loop back on itself when a user opts to view the default locale via the
 * picker.
 */
export function localeInfo(code: string, _defaultLocale: string): LocaleInfo {
  const meta = localeName(code);
  const native = meta?.native ?? code;
  const english = meta?.english ?? code;
  const rtl = !!meta?.rtl;
  const href = `/${code}/`;
  return { code, nativeName: native, englishName: english, rtl, href };
}

/**
 * Locale codes the template ships a store badge for, mirroring the
 * canonical destinations of skipstone's normalizeLocaleApple() and
 * normalizeLocaleGoogle() (Sources/SkipBuild/Commands/MetaCommand.swift).
 * Keep these sets in lockstep with scripts/download-badges.mjs.
 */
const APPLE_BADGE_LOCALES = new Set([
  'ar', 'ca', 'cs', 'da', 'de', 'el',
  'en', 'en-AU', 'en-CA', 'en-GB',
  'es', 'es-MX', 'fi', 'fr', 'fr-CA',
  'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'ms', 'nl', 'no',
  'pl', 'pt', 'pt-BR', 'ro', 'ru', 'sk', 'sv', 'th', 'tr', 'uk', 'vi',
  'zh-Hans', 'zh-Hant',
]);

const GOOGLE_BADGE_LOCALES = new Set([
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el',
  'en', 'en-AU', 'en-CA', 'en-GB', 'en-IN', 'en-SG', 'en-ZA',
  'es', 'es-419', 'es-US', 'et', 'eu', 'fa', 'fi', 'fil',
  'fr', 'fr-CA', 'gl', 'gu', 'he', 'hi', 'hr', 'hu', 'hy',
  'id', 'is', 'it', 'ja', 'ka', 'kk', 'km', 'kn', 'ko', 'ky',
  'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl', 'no',
  'pa', 'pl', 'pt', 'pt-BR', 'rm', 'ro', 'ru',
  'si', 'sk', 'sl', 'sq', 'sr', 'sv', 'sw',
  'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi',
  'zh-Hans', 'zh-Hant',
]);

/**
 * Resolve a locale to one for which `<store>` has a localized badge.
 * Walks exact → language-only → "en", so per-locale
 * /badges/<code>/<store>.svg URLs never 404.
 */
export function badgeLocale(code: string, store: 'apple' | 'google'): string {
  const set = store === 'apple' ? APPLE_BADGE_LOCALES : GOOGLE_BADGE_LOCALES;
  if (set.has(code)) return code;
  const lang = languageOf(code);
  if (set.has(lang)) return lang;
  return 'en';
}

/**
 * Sort locales: default first, then alphabetically by English name. This keeps
 * the language picker stable across builds.
 */
export function sortLocales(codes: string[], defaultLocale: string): string[] {
  const dedup = Array.from(new Set(codes));
  return dedup.sort((a, b) => {
    if (a === defaultLocale) return -1;
    if (b === defaultLocale) return 1;
    const an = localeName(a)?.english ?? a;
    const bn = localeName(b)?.english ?? b;
    return an.localeCompare(bn) || a.localeCompare(b);
  });
}
