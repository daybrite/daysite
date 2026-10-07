import type { LocaleInfo, LocaleLink, SiteInfo } from './types.ts';
import type { ChannelView } from './channels.ts';

/** Stable props for Header replacements. QR controls may be omitted by a replacement. */
export interface HeaderProps {
  site: SiteInfo;
  current: LocaleInfo;
  localeLinks: LocaleLink[];
  localeHomeHref: string;
  siteTitleText: string;
  showQr: boolean;
  qrTitle: string;
  qrIcon: string;
  channel?: ChannelView;
}

export interface FooterProps {
  site: SiteInfo;
  locale: LocaleInfo;
  sourceURL?: string;
  releaseURL?: string;
}

export interface DaysiteOptions {
  apiVersion?: 1;
  root?: string;
  siteConfig?: string;
  themeDir?: string;
  publicDir?: string;
  outDir?: string;
  srcDir?: string;
  components?: Partial<Record<string, string>>;
  customCss?: string[];
  publicDirs?: string[];
  routes?: { pattern: string; entrypoint: string; prerender?: boolean }[];
  disabledRoutes?: string[];
}
