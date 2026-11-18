import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { loadSite } from '../lib/data.ts';
import { DEFAULT_RELEASES, feedXML, fetchReleases, githubRepository, releaseItems, type FeedItem } from '../lib/feed.ts';

/** `feed.blog` from daysite.config.mjs (integration.mjs defines it), or null. */
declare const __DAYSITE_FEED_BLOG__: { collection: string; path: string } | null;

/**
 * The site's feed: the newest releases of each app, with their GitHub release notes, and the
 * blog's posts in full when there is a blog. See lib/feed.ts.
 *
 * Release notes are read from GitHub when the site is built. A build that cannot reach GitHub
 * (a local preview offline, an exhausted quota) still publishes the feed, without them.
 */
export const GET: APIRoute = async () => {
  const data = await loadSite();
  const { site } = data;
  const locale = data.defaultLocale;
  const host = site.host.replace(/\/+$/, '');
  const home = `${host}/${locale}/`;
  const hero = data.apps[0]?.hero(locale);
  const title = (typeof site.title === 'string' ? site.title : site.title?.[locale]) ?? hero?.title ?? 'App';

  const items: FeedItem[] = [];
  const configured = site.feed?.releases;
  const count = typeof configured === 'number' && configured >= 0 ? Math.floor(configured) : DEFAULT_RELEASES;
  if (count > 0) {
    const releases: FeedItem[] = [];
    for (const app of data.apps) {
      const repository = githubRepository(app.app.source?.url);
      if (!repository) continue;
      const page = data.multiApp ? `${home}apps/${encodeURIComponent(app.slug)}/` : home;
      try {
        releases.push(...await releaseItems(app.hero(locale).title, page, await fetchReleases(repository, count)));
      } catch (error) {
        console.warn(`rss.xml: ${repository}'s releases are left out: ${error instanceof Error ? error.message : error}`);
      }
    }
    items.push(...releases.sort((a, b) => b.date.valueOf() - a.date.valueOf()).slice(0, count));
  }

  const blog = __DAYSITE_FEED_BLOG__;
  if (blog) {
    const base = `${host}/${blog.path.replace(/^\/+|\/+$/g, '')}/`;
    for (const post of await getCollection(blog.collection as never) as Array<{ id: string; data: Record<string, unknown>; rendered?: { html?: string } }>) {
      const date = new Date((post.data.published ?? post.data.pubDate ?? post.data.date) as string | Date);
      if (typeof post.data.title !== 'string' || Number.isNaN(date.valueOf())) continue;
      const summary = post.data.summary ?? post.data.description;
      const link = `${base}${post.id}/`;
      items.push({
        title: post.data.title, link, guid: link, date,
        ...(typeof summary === 'string' ? { summary } : {}),
        ...(post.rendered?.html ? { html: post.rendered.html } : {}),
      });
    }
  }

  const xml = feedXML({
    title,
    description: hero?.subtitle ?? title,
    link: home,
    self: `${host}/rss.xml`,
    language: locale,
    items,
  });
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
};
