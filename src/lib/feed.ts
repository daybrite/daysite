// The site's RSS feed (`/rss.xml`): the app's newest GitHub releases, each with its release
// notes as the body, and the site's blog posts in full when a theme or project declares a blog
// (`feed.blog` in daysite.config.mjs). Every item links to this site, not to GitHub.
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

export interface FeedItem {
  title: string;
  /** Absolute URL of the page on this site. */
  link: string;
  /** Stable identity, so a reader never shows an item twice. */
  guid: string;
  date: Date;
  /** Plain-text summary. */
  summary?: string;
  /** The whole item as HTML. */
  html?: string;
}

/** Release items in the feed unless site.toml says otherwise (`[feed] releases = N`). */
export const DEFAULT_RELEASES = 5;

interface GitHubRelease {
  tag_name: string;
  name?: string | null;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
}

/** `https://github.com/owner/name(.git)` → `owner/name`; anything else has no releases to list. */
export function githubRepository(url: string | undefined): string | undefined {
  const match = url?.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

/**
 * The published releases GitHub lists for `repository`, newest first: no drafts, and no
 * pre-releases, which the site keeps on a channel of their own. The request is authenticated
 * when the build has a token (`GH_TOKEN` or `GITHUB_TOKEN`), since a CI runner shares its
 * address, and the anonymous quota with it, with every other build.
 */
export async function fetchReleases(
  repository: string,
  count: number,
  fetcher: typeof fetch = fetch,
): Promise<GitHubRelease[]> {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  // Drafts and pre-releases come back in the same list, so ask for more than will be kept.
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases?per_page=${Math.min(100, count * 3)}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'daysite',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${repository}'s releases`);
  const releases = (await response.json()) as GitHubRelease[];
  return releases
    .filter((r) => !r.draft && !r.prerelease && r.published_at)
    .sort((a, b) => Date.parse(b.published_at!) - Date.parse(a.published_at!))
    .slice(0, count);
}

/**
 * One feed item per release. `page` is the app's page on this site; the tag rides along as a
 * fragment so that each item has an address of its own, which some readers key on.
 */
export async function releaseItems(appName: string, page: string, releases: GitHubRelease[]): Promise<FeedItem[]> {
  const markdown = await createMarkdownProcessor();
  return Promise.all(releases.map(async (release) => {
    const version = release.tag_name.replace(/^v(?=\d)/, '');
    const name = release.name?.trim();
    // GitHub names a release after its tag unless the publisher wrote something else.
    const title = name && name !== release.tag_name && name !== version ? `${appName} ${version}: ${name}` : `${appName} ${version}`;
    const link = `${page}#${encodeURIComponent(release.tag_name)}`;
    const body = release.body?.trim();
    return {
      title, link, guid: link,
      date: new Date(release.published_at!),
      ...(body ? { html: (await markdown.render(body)).code } : {}),
    };
  }));
}

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// A CDATA section ends at the first `]]>`, so one inside the content is split across two.
const cdata = (html: string) => `<![CDATA[${html.replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;

/** RSS 2.0, newest item first, with each item's whole body in `content:encoded`. */
export function feedXML(feed: { title: string; description: string; link: string; self: string; language: string; items: FeedItem[] }): string {
  const items = [...feed.items].sort((a, b) => b.date.valueOf() - a.date.valueOf());
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    `<title>${escape(feed.title)}</title>`,
    `<link>${escape(feed.link)}</link>`,
    `<description>${escape(feed.description)}</description>`,
    `<language>${escape(feed.language)}</language>`,
    `<atom:link href="${escape(feed.self)}" rel="self" type="application/rss+xml"/>`,
    ...(items[0] ? [`<lastBuildDate>${items[0].date.toUTCString()}</lastBuildDate>`] : []),
    ...items.flatMap((item) => [
      '<item>',
      `<title>${escape(item.title)}</title>`,
      `<link>${escape(item.link)}</link>`,
      `<guid isPermaLink="false">${escape(item.guid)}</guid>`,
      `<pubDate>${item.date.toUTCString()}</pubDate>`,
      ...(item.summary ? [`<description>${escape(item.summary)}</description>`] : []),
      ...(item.html ? [`<content:encoded>${cdata(item.html)}</content:encoded>`] : []),
      '</item>',
    ]),
    '</channel>',
    '</rss>',
    '',
  ];
  return lines.join('\n');
}
