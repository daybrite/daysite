// The site feed (src/lib/feed.ts): which GitHub releases it lists, what an item links to, and
// that the XML survives whatever release notes contain.
//
//   node --test scripts/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedXML, fetchReleases, githubRepository, releaseItems } from '../src/lib/feed.ts';

const release = (tag, published, extra = {}) => ({ tag_name: tag, name: tag, body: `Notes for **${tag}**`, published_at: published, ...extra });

test('only a GitHub repository has releases to list', () => {
  assert.equal(githubRepository('https://github.com/Example/Some-App'), 'Example/Some-App');
  assert.equal(githubRepository('https://github.com/Example/Some-App.git'), 'Example/Some-App');
  assert.equal(githubRepository('https://example.org/Example/Some-App'), undefined);
  assert.equal(githubRepository(undefined), undefined);
});

test('the newest published releases are kept; drafts and pre-releases are not', async () => {
  let asked;
  const fetcher = async (url) => {
    asked = url;
    return new Response(JSON.stringify([
      release('v1.0.0', '2026-01-01T00:00:00Z'),
      release('v1.3.0', '2026-04-01T00:00:00Z', { prerelease: true }),
      release('v1.2.0', '2026-03-01T00:00:00Z'),
      release('v1.4.0', null, { draft: true }),
      release('v1.1.0', '2026-02-01T00:00:00Z'),
    ]));
  };
  const kept = await fetchReleases('Example/Some-App', 2, fetcher);
  assert.match(asked, /repos\/Example\/Some-App\/releases\?per_page=6$/);
  assert.deepEqual(kept.map((r) => r.tag_name), ['v1.2.0', 'v1.1.0']);
  await assert.rejects(fetchReleases('Example/Some-App', 2, async () => new Response('', { status: 403 })), /403/);
});

test('a release item carries its notes as HTML and links to the site', async () => {
  const [plain, named, bare] = await releaseItems('Some App', 'https://example.test/en/', [
    release('v1.2.0', '2026-03-01T00:00:00Z'),
    release('v1.1.0', '2026-02-01T00:00:00Z', { name: 'Spring cleaning' }),
    release('v1.0.0', '2026-01-01T00:00:00Z', { body: '' }),
  ]);
  assert.equal(plain.title, 'Some App 1.2.0');
  assert.equal(plain.link, 'https://example.test/en/#v1.2.0');
  assert.match(plain.html, /<strong>v1\.2\.0<\/strong>/);
  assert.equal(named.title, 'Some App 1.1.0: Spring cleaning');
  assert.equal(bare.html, undefined);
  assert.ok(!JSON.stringify([plain, named, bare]).includes('github.com'));
});

test('the feed is newest first and escapes what it is given', () => {
  const xml = feedXML({
    title: 'Fish & Chips', description: 'A <feed>', link: 'https://example.test/en/', self: 'https://example.test/rss.xml', language: 'en',
    items: [
      { title: 'Older', link: 'https://example.test/a/', guid: 'a', date: new Date('2026-01-01T00:00:00Z'), summary: 'x < y', html: '<p>one ]]> two</p>' },
      { title: 'Newer', link: 'https://example.test/b/', guid: 'b', date: new Date('2026-02-01T00:00:00Z') },
    ],
  });
  assert.ok(xml.indexOf('Newer') < xml.indexOf('Older'));
  assert.match(xml, /<title>Fish &#38; Chips<\/title>/);
  assert.match(xml, /<description>x &#60; y<\/description>/);
  assert.match(xml, /<lastBuildDate>Sun, 01 Feb 2026 00:00:00 GMT<\/lastBuildDate>/);
  assert.ok(xml.includes('<content:encoded><![CDATA[<p>one ]]]]><![CDATA[> two</p>]]></content:encoded>'));
  assert.equal(xml.match(/<item>/g).length, 2);
});
