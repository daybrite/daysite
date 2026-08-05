# daysite

Astro template that turns a conventional [Day](https://daybrite.dev) project into a published
website: a localized landing page, a per-platform screenshot gallery, download links for every
packaged target, and the hosted web build — generated from data the repository already maintains,
so the site needs almost no metadata of its own.

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
[`daybrite/actions`](https://github.com/daybrite/actions) `build-day-app.yml` workflow checks out
this repository at build time (pin with its `daysite-version` input), synthesizes the site data,
builds, and deploys to the repository's GitHub Pages. Template fixes reach every site on its next
build; nothing but the two files above lives in the app repo.

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
show-gallery = true
show-permissions = true
show-store-badges = true
show-source-link = true
footer = "© {year} Daybrite"
pagefind = false               # site search index
```

## Where the content comes from

CI generates two data files next to `site.toml`; neither is committed:

| File | Written by | From |
| --- | --- | --- |
| `appindex.json` | `scripts/generate-appindex.mjs` | `Day.toml`, `store/app.toml`, `store/<locale>/`, the repo's `releases/latest` assets, `resource/icons/` |
| `gallery-manifest.json` | `scripts/assemble-gallery.mjs` | the `screenshots-<target>` artifacts the dayscript walkthroughs capture (`<target>/<variant>/<shot>.png`) |

`appindex.json` conforms to the appindex schema — `platforms.ios` / `platforms.android` mean what
they mean there — plus Day's additive extension: entries under `macos`, `windows`, `linux-gtk`,
`linux-qt`, `harmony`, and `web` keys, and a per-platform `artifacts` array carrying the stable
`releases/latest/download/` URLs (`src/lib/day-targets.ts` is the vocabulary). An appindex consumer
reads the subset it understands; the document doubles as the app's machine-readable publication
record.

## What renders

- `/<locale>/` — the landing page: hero (with an **Open the web app** button when a web build is
  hosted), platform picker across every built target, screenshot carousel, localized store
  description, per-platform download card, permissions, release notes. One page per store locale,
  with the same locale-fallback ladder as appland.
- `/<locale>/gallery/` — one row per captured screen, every platform side by side, phones in
  hardware bezels and desktops in their native window chrome (Adwaita, Breeze, traffic lights,
  caption buttons — `src/styles/shells.css`, shared with daybrite.dev), with theme and locale
  switchers when the capture matrix has them. Generated only when captures exist.
- `/<webapp>/` — the web-dom build itself, staged by the deploy workflow next to the site.

A repo with a `web-dom` target and **no** `website/` directory keeps the old behavior: the
workflow deploys the bare web app at the Pages root.

## Local preview

```sh
cd your-app/website
git clone https://github.com/daybrite/daysite .daysite   # add .daysite/ to your .gitignore
npm --prefix .daysite install
node .daysite/scripts/preview.mjs
```

The preview generates the same data CI does — minus release downloads when offline — and picks up
`build/day/screenshots/` from your last local `day launch --script` run for the gallery.

## Continuous integration

`.github/workflows/ci.yml` builds the bundled sample on every push and PR, and — on pushes to
`main` and version tags — scaffolds a **fresh Day project with the day CLI** (`day new app`,
whose default scaffold includes `website/`), builds its web-dom target, runs this checkout of
the template over the scaffold's own data, and deploys the result to this repository's GitHub
Pages with the web app under `/webapp/`. Template changes are thereby exercised against exactly
what the CLI generates, and the deployed artifact is browsable at
<https://daybrite.github.io/daysite/>.

## Template development

`npm install && npm run dev` in a bare checkout serves the bundled NetSkip sample
(`samples/site.toml`), which exercises the ios/android schema-compatibility path. Point
`DAYSITE_CONFIG` at any `site.toml` to build against real app data.
