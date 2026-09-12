# daysite

Astro template that turns a conventional [Day](https://daybrite.dev) project into a published
website: a localized landing page, a per-platform screenshot gallery, download links for every
packaged target, and the hosted web build — generated from data the repository already maintains,
so the site needs almost no metadata of its own. It publishes two versions of the app side by
side, the newest release and the newest build of the default branch; see
[Build channels](#build-channels).

## How an app uses it

An app repository adds a `website/` directory holding only its site-specific choices:

```
your-app/
├── Day.toml               # already there — id, title, targets
├── store/                 # already there — localized store listings
│   ├── app.toml
│   └── <locale>/…         # name.txt, subtitle.txt, description.txt, *-url.txt, …
└── website/
    ├── site.toml          # host + styling knobs (see below)
    └── theme.css          # optional CSS overrides
```

The template is **fetched, not vendored**: the shared
[`daybrite/actions`](https://github.com/daybrite/actions) `dayapp.yml` workflow checks out
this repository at build time, synthesizes the site data, builds, and deploys to the repository's
GitHub Pages. Nothing but the two files above lives in the app repo. Template fixes reach every
site on its next build (the workflow's `daysite-version` input, default `main`, selects the
revision; the Day apps build against `main` on purpose).

The published site is self-contained: every script, stylesheet, image, and font it loads is
served from the site itself (system fonts; the store badges, platform icons, and permission
icons are vendored under `public/` with their provenance beside them). The build enforces this:
an `astro:build:done` hook scans the output for a resource loaded from another origin and fails
the build on the first one. Plain links out, such as the store listings and the privacy page,
are fine, and so are images an app index keeps on the app's own repository (`source.assets`,
which an appindex-driven site may declare): that is the data's choice, named in the build log,
not something the template loads. Build time still needs the npm registry for the packages in
`package-lock.json`, and the workflow reads GitHub for what the newest release carries — its
asset list, its screenshots, its web build — and hands each to the generator as a file or a
directory, so the generator itself never touches the network.

## Build channels

The site publishes the app twice, and a version picker above the platform picker switches between
them. The two are assembled from deliberately different sources.

| | `/<locale>/` — the release | `/<locale>/main/` — the branch |
| --- | --- | --- |
| picker label | the release's version, `1.2.3` | the default branch, `main` |
| downloads | the release's own packages, at their `releases/latest/download/` URLs | this run's packages, served from the site under `main/downloads/` |
| screenshots | the release's `screenshots.zip` (or its per-target `screenshots-<target>.zip` assets) | the captures this run's dayscripts took |
| web app | the release's own `web-dom` dist, at `/webapp/` | this run's, at `/main/webapp/` |
| page | as published | carries a development-build notice and a link to the release |

The point of the split is that the release channel is built from **assets the release already
carries** and nothing else, so what a visitor downloads is the version the page names. The
development channel is built from the artifacts of the CI run that published the site, and says
so on every page. Its packages are copied onto the site because a GitHub Actions artifact needs a
signed-in account and expires with the run's retention window; that adds the size of one full
package set (Day Rise's is 117 MB) to each Pages deploy.

A repository with no release publishes main at the locale root instead, the picker has one entry
and is not drawn, and `/<locale>/main/` redirects there — so a link made before the first release
still resolves after it.

The development notice is one line rather than a banner, and it is placed in layout the page
already has: inside the hero's text block, which from `sm` up is shorter than the app mark beside
it, and under the gallery's version picker. Both channels' pages are then the same height, so the
picker a visitor just clicked, and everything below it, stays exactly where it was. Give the
notice a block of its own and the release and development pages differ by its height, which is a
jump on every switch.

`scripts/generate-site.mjs` assembles all of this and writes `channels.json` beside `site.toml`;
`src/lib/channels.ts` is what the pages read. Without a `channels.json` the site has exactly one
channel, which is the layout every daysite had before channels existed.

## site.toml

```toml
# Required — the canonical URL. A path component becomes the Astro base,
# so a GitHub project page just works:
host = "https://daybrite.github.io/Day-Skies"

# Everything below is optional.
title = "Day Skies"            # default: the localized store name
tagline = "Weather, beautifully native"
accent-color = "#4A90D9"
default-theme = "system"       # light | dark | system
default-platform = "web"       # platforms key preselected in the picker
webapp = "webapp"              # subdirectory hosting the web-dom build (default "webapp")
screenshot-placement = "below-about"  # below-about (default) | above-about: the carousel under the description, or first after the hero
show-gallery = true
show-permissions = true
show-store-badges = true
show-qr-code = true            # the toolbar QR code of the landing page, full screen when tapped
show-source-link = true
footer = "© {year} Daybrite" # optional, prints under the Day attribution; {year} interpolates
pagefind = false               # site search index
```

Gallery curation lives in the app's dayscripts, not here: a `screenshot:` step with a
localized `title:` (and optionally `caption:` and `source:`) becomes a curated gallery row, in
the script's own order — `day screenshot index` carries the metadata into the gallery.json
this template consumes. See the day repository's DESIGN.md §14.7.

## Where the content comes from

CI generates these files next to `site.toml`; none is committed. `scripts/generate-site.mjs` runs
the two generators once per build channel and writes `channels.json` last, so a second channel's
copies land under its own segment (`main/appindex.json`, `main/gallery-manifest.json`,
`public/main/gallery/`).

| File | Written by | From |
| --- | --- | --- |
| `channels.json` | `scripts/generate-site.mjs` | the channel list the workflow hands it: which build each channel describes, its label, its URL segment, and where its data and web build live |
| `appindex.json` | `scripts/generate-appindex.mjs` | `Day.toml` (`[app]`, and `[store]` for the live App Store / Google Play listings), `store/app.toml`, `store/<locale>/`, the latest release's asset list (`--release-assets FILE`, written by the workflow with `gh api`) or a directory of packed artifacts to serve from the site (`--downloads DIR`), `day metadata --json` (`--metadata FILE`, or run through `DAY_BIN`) for the declared permissions with their native keys per platform and reasons per locale, the icon family under `build/day/host/png/` or `resource/icons/` |
| `gallery-manifest.json` | `scripts/assemble-gallery.mjs` | `day screenshot index`'s gallery.json in the capture tree (falling back to scanning the `<target>/<variant>/<shot>.png` trees directly) |
| `public/gallery/gallery.json` | rebuilt by `scripts/assemble-gallery.mjs` | `day screenshot index`, filtered to the captures this run actually published (see "What renders") |

### The app icon

The site's identity is the project's own icon, copied rather than rendered. The generator looks
first for the size-exact `day-icon-<N>.png` family that `day icon` writes under
`build/day/host/png/` (the workflow runs `day icon -p web-dom` for exactly this; a `day new`
scaffold also ships a copy under `resource/icons/png/`), copies its largest size to
`public/app/icon.png` for the landing page's app mark and the Open Graph image, and its 64, 256,
and 512 px sizes to `public/app/` as the favicon, apple-touch-icon, and PWA tile. The build then
links them from every page's `<head>`; no image library is involved, and the SVG master, when
the project ships one, is served raw beside them and is what browsers prefer.

Without the family, the largest PNG under `resource/icons/` (directory preference `png/`, then
`ios/`, `linux/`, `windows/`, `android/`, the `icons/` root, and `macos/` last, whose art is
pre-rounded) is the app mark and fills every favicon slot at its own size. A project with no
PNG at all gets the SVG master alone, or no app mark; the generator says so.

### Home screen

A site that hosts the web build (`public/<webapp>/`, staged by the workflow) is installable from
its landing page: `src/pages/site.webmanifest.ts` emits a web app manifest whose `start_url` and
`id` are the hosted app, whose scope is the whole site, whose icons are the favicon set above,
and whose screenshots are the gallery's phone captures (narrow) and desktop captures (wide), and
`Layout.astro` links it from every page. "Add to Home Screen" from the site then installs the
app itself, with the same name and icon the app's own manifest declares (`day build -p web-dom`
writes that one, plus the offline service worker; see the day repository's docs/web.md, "Home
screen and offline"). Without a staged web build the manifest is still emitted but not linked,
so the site never installs as an app of its own.

`appindex.json` conforms to the appindex schema — `platforms.ios` / `platforms.android` mean what
they mean there — plus Day's additive extension: entries under `macos`, `windows`, `linux-gtk`,
`linux-qt`, `harmony`, and `web` keys, and a per-platform `artifacts` array carrying the stable
`releases/latest/download/` URLs (`src/lib/day-targets.ts` is the vocabulary). An appindex consumer
reads the subset it understands; the document doubles as the app's machine-readable publication
record.

## What renders

- `/<locale>/` — the landing page: version picker and platform picker (first, since between them
  they select what everything below shows), hero, screenshot carousel, localized store description,
  per-platform download card, and an About card carrying that platform's way to get the app — the
  **Open the web app** button when a web build is hosted, the App Store or Google Play badge for a
  listed app (badges vendored under `public/badges/<locale>/`, see the README there), otherwise
  the lead package from the latest GitHub release — then permissions and release notes. One page per store locale, with the same locale-fallback ladder as appland.

  The chosen platform is bookmarkable as a fragment — `/<locale>/#macos-appkit`, spelled with the
  Day target id (the shorter appindex key, `#macos`, resolves too and rewrites itself to the
  canonical form). It outranks both automatic choices, the visitor's own OS and their last pick,
  and the version picker's links carry it, so switching 1.2.3 ↔ main stays on the platform being
  read about. A fragment rather than a per-platform page because the page already holds every
  platform's content — the picker only hides sections — so splitting it would turn one indexable
  page into eight near-duplicates without revealing anything new. A visitor who was auto-selected
  keeps the clean URL; only an explicit choice writes one, with `replaceState`, so clicking
  through platforms leaves no history to back out of.
- `/<locale>/gallery/` — one row per captured screen, every platform side by side, phones and
  tablets in hardware bezels and desktops in their native window chrome (Adwaita, Breeze, traffic lights,
  caption buttons — `src/styles/shells.css`, shared with daybrite.dev), with theme and locale
  switchers when the capture matrix has them. Row headings and captions come from the
  dayscript metadata, in the page's own locale (missing locales fall back to English).
  Clicking a screenshot opens a full-size viewer with two-axis navigation: ←/→ walk platforms
  across one screen, ↑/↓ walk screens on one platform. Generated only when captures exist.
- `/gallery/gallery.json` — the machine-readable index of every published screenshot, written
  by `day screenshot index`: file name, absolute URL, shot id, localized title and caption,
  platform-toolkit, theme, locale, pixel dimensions, byte size, and sha-256. Other sites
  reference the gallery through it — daybrite.dev builds its Day Showcase gallery from this
  site's copy — and any tool can enumerate the screenshots without scraping pages.

  Two rules keep it honest, and they are deliberately different from the page's:

  1. **Every capture is published**, curated or not. Curation (a `title:`) decides which shots get
     a row on the gallery PAGE; it does not decide which bytes go on the site. An index entry
     naming an image nobody uploaded is worse than no entry.
  2. **The index is rebuilt from what was published**, not copied through. An entry whose file is
     missing from the capture tree — an artifact that failed to upload, a trimmed download — is
     dropped from the index (and named in the build log) rather than shipped as a dead URL. The
     invariant is covered by `scripts/assemble-gallery.test.mjs` (`npm test`).
- `/<locale>/main/` and `/<locale>/main/gallery/` — the same two pages for the development
  channel, from that channel's own data (see [Build channels](#build-channels)).
- `/<webapp>/` and `/main/<webapp>/` — each channel's web-dom build, staged by the deploy
  workflow next to the site.
- `/main/downloads/` — the development channel's packages, as the CI run packed them.

A repo with a `web-dom` target and **no** `website/` directory keeps the old behavior: the
workflow deploys the bare web app at the Pages root.

## Local preview

```sh
cd your-app/website
git clone https://github.com/daybrite/daysite .daysite   # add .daysite/ to your .gitignore
npm --prefix .daysite install
node .daysite/scripts/preview.mjs
```

The plain run needs no network: one channel, from this checkout, with `build/day/screenshots/`
from your last local `day launch --script` run as the gallery and no download cards, since only
the workflow looks a release up.

`--ci` assembles what the workflow publishes — both channels, the release one from the newest
GitHub release's assets and the development one from the newest successful run of the default
branch. It shells out to `gh` for both and caches the downloads under `build/day/daysite/`, so a
second run is fast. `--run <id>` picks a specific workflow run and `--no-serve` generates the data
and stops.

```sh
node .daysite/scripts/preview.mjs --ci
```

Point `DAYSITE_CONFIG` at any `site.toml` to drive a bare template checkout against another app's
data; both the generator and the Astro build read it.

## Continuous integration

`.github/workflows/ci.yml` builds the bundled sample on every push and PR, and — on pushes to
`main` and version tags — scaffolds a **fresh Day project with the day CLI** (`day new app`,
whose default scaffold includes `website/`), builds its web-dom target, runs this checkout of
the template over the scaffold's own data, and deploys the result to this repository's GitHub
Pages with the web app under `/webapp/`. Template changes are thereby exercised against exactly
what the CLI generates, and the deployed artifact is browsable at
<https://daybrite.github.io/daysite/>.

## Template development

`npm install && npm run sample && npm run dev` in a bare checkout serves the bundled sample
(`samples/`, a trimmed copy of Day Showcase: `Day.toml`, `store/`, the icon master, a few
screenshots; `npm run sample` generates its data the way CI does for a real repository). Point
`DAYSITE_CONFIG` at any `site.toml` to build against real app data.
