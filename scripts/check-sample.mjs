// Check the site built from the sample (`npm run sample && npx astro build`) against the data it
// was built from.
//
// Every expectation is read from what `npm run sample` wrote — the Day Showcase export, the app
// index, the source it cloned — rather than written here, since the sample is whatever the
// Showcase's main branch says today. Pages are compared as text with their HTML entities decoded,
// so how the page happens to escape an apostrophe is not the test's business.
//
// Every check runs, and each failure says what was expected, where, and what the page has
// instead. Under GitHub Actions a failure is also an `::error` annotation, and the whole result
// is written to the job summary.
//
// Usage: node scripts/check-sample.mjs            (from the template root, after a build)

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const WORK = join(ROOT, 'samples', '.showcase');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The page's text with every entity decoded, so a check can match what a reader sees. */
export function decodeEntities(html) {
  return html.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Up to `max` windows of `text` around matches of `near`, tags dropped and whitespace folded —
 *  what a failure shows of the page, so the log says what is there instead. */
export function excerpts(text, near, max = 3, width = 160) {
  const out = [];
  const re = new RegExp(near.source, near.flags.includes('g') ? near.flags : `${near.flags}g`);
  for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
    const from = Math.max(0, m.index - width);
    const clip = text
      .slice(from, m.index + m[0].length + width)
      // A window can open or close inside a tag; drop the part of it that is cut off.
      .replace(/^[^<]*?>/, (t) => (from > 0 ? ' ' : t))
      .replace(/<[^>]*$/, ' ');
    const x = clip.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!out.includes(x)) out.push(x);
  }
  return out;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

function main() {
  const results = [];
  const pages = new Map();
  const page = (rel) => {
    if (!pages.has(rel)) {
      const path = join(DIST, rel);
      pages.set(rel, existsSync(path) ? decodeEntities(readFileSync(path, 'utf8')) : null);
    }
    return pages.get(rel);
  };
  const fileCheck = (what, rel) =>
    results.push({ what, file: `dist/${rel}`, ok: existsSync(join(DIST, rel)), detail: ['the file does not exist'] });
  /** The page contains `text`; on failure, show the page around `near`. */
  const textCheck = (what, rel, text, near) => {
    const body = page(rel);
    if (body === null) return results.push({ what, file: `dist/${rel}`, ok: false, detail: ['the page does not exist'] });
    if (body.includes(text)) return results.push({ what, file: `dist/${rel}`, ok: true });
    const around = near ? excerpts(body, near) : [];
    results.push({
      what,
      file: `dist/${rel}`,
      ok: false,
      detail: [
        `expected: ${JSON.stringify(text)}`,
        ...(around.length
          ? around.map((x) => `page has: …${x}…`)
          : [near ? `nothing in the page matches ${near}` : `the page is ${body.length} characters`]),
      ],
    });
  };

  // What the sample was built from. Without these there is nothing to check against.
  const inputs = { storefront: join(WORK, 'storefront.json'), source: join(WORK, 'source.json'), appindex: join(ROOT, 'samples', 'appindex.json') };
  const missing = Object.values(inputs).filter((p) => !existsSync(p));
  if (missing.length) {
    report([{ what: 'the sample was generated', file: missing[0], ok: false, detail: missing.map((p) => `missing ${p} — run \`npm run sample\` first`) }], {});
    return 1;
  }
  const storefront = readJson(inputs.storefront);
  const source = readJson(inputs.source);
  const app = readJson(inputs.appindex).apps?.[0] ?? {};

  fileCheck('the landing page built', 'index.html');
  // The title is per locale; the root page is the default locale's.
  const title = typeof app.title === 'string' ? app.title : app.title?.[storefront['default-locale']] ?? app.title?.en;
  textCheck('the landing page names the app', 'index.html', String(title), /<title>|<h1/i);
  textCheck('the App Store badge', 'en/index.html', 'badges/en/apple-app-store.svg', /badges\//);
  textCheck('the Google Play badge', 'en/index.html', 'badges/en/google-play-store.svg', /badges\//);
  fileCheck('the favicon set, from the icon family', 'app/apple-touch-icon.png');
  fileCheck('the gallery page', 'en/gallery/index.html');

  // The source links name the app's own repository, not the one CI runs in.
  textCheck('the source link names the Showcase repository', 'en/index.html', `https://github.com/${source.repo}`, /github\.com\/[^"'\s<]+/);

  // The permissions card: the camera row, with its French reason on the French page.
  textCheck('the camera permission row', 'en/index.html', 'NSCameraUsageDescription', /UsageDescription/);
  const camera = storefront.permissions?.find((p) => p.name === 'camera');
  if (!camera?.reasons?.fr) {
    results.push({
      what: "the camera permission's French reason",
      file: inputs.storefront,
      ok: false,
      detail: [
        camera ? `the export's camera entry has reasons for: ${Object.keys(camera.reasons ?? {}).join(', ') || 'no locale'}` : 'the export declares no camera permission',
        `declared: ${(storefront.permissions ?? []).map((p) => p.name).join(', ') || 'nothing'}`,
      ],
    });
  } else {
    textCheck("the camera permission's French reason", 'fr/index.html', camera.reasons.fr, /NSCameraUsageDescription/);
  }

  return report(results, source) ? 0 : 1;
}

/** Print the results, annotate failures under GitHub Actions, and write the job summary. */
function report(results, source) {
  const failed = results.filter((r) => !r.ok);
  const from = source.repo ? `${source.repo} at ${source.rev}` : 'an unknown source';
  console.log(`Checked the site built from ${from}: ${results.length - failed.length} of ${results.length} passed.`);
  for (const r of results) {
    console.log(`${r.ok ? '  ok  ' : '  FAIL'} ${r.what} (${r.file})`);
    if (!r.ok) for (const d of r.detail) console.log(`         ${d}`);
  }
  if (process.env.GITHUB_ACTIONS) {
    // An annotation is one line; `%0A` is how the workflow command spells a newline in it.
    // A property (the title) must also escape the `:` and `,` that delimit properties.
    const esc = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
    const prop = (s) => esc(s).replace(/:/g, '%3A').replace(/,/g, '%2C');
    for (const r of failed) {
      console.log(`::error title=${prop(`Sample check failed: ${r.what}`)}::${esc(`${r.file}\n${r.detail.join('\n')}`)}`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      const cell = (s) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const lines = [
        `### Sample site checks: ${failed.length ? `${failed.length} failed` : 'all passed'}`,
        '',
        `Built from ${from}.`,
        '',
        '| | check | file | detail |',
        '|---|---|---|---|',
        ...results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${cell(r.what)} | \`${cell(r.file)}\` | ${r.ok ? '' : r.detail.map(cell).join('<br>')} |`),
        '',
      ];
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n'));
    }
  }
  return failed.length === 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
