# Customizing daysite

Existing apps need no changes. Without a theme or a customization module, daysite uses the same
pages, components, CSS, generated app metadata, and publication paths as before. `day new` still
needs only `website/site.toml` and optional `website/theme.css`.

The design follows [Starlight's component overrides](https://starlight.astro.build/guides/overriding-components/):
keep a default, replace a named component, or wrap the original. It uses ordinary Astro
components, slots, integrations, routing, and content collections. Starlight is inspiration,
not a dependency or a restriction on page content.

## CSS only

Keep using `website/theme.css`. It is included after the theme's styles, so the project has the
final say. Existing `site.toml` settings such as `accent-color`, `default-theme`, `icon-effect`,
and `screenshot-placement` work unchanged.

## Select a reusable theme

In `website/site.toml`, after the existing top-level settings:

```toml
[theme]
repository = "appfair/appsite"
ref = "main" # Prefer a tested tag or commit for a production theme.
```

The updated `daybrite/actions` website job reads this table, checks out the theme separately,
installs its dependencies from its committed npm lockfile, and builds it with the generated
publication data. It still uploads `daysite/dist`. A theme must have `daysite.config.mjs` at
its root. The App Fair example is an independent Astro project with a header, footer, logo,
localized UI catalog, and Markdown journal. That repository must be published before the
remote selection above can be used in CI.

For a theme committed in the app's repository:

```toml
[theme]
path = "./theme" # Relative to website/site.toml, not the runner's working directory.
```

Use `repository` or `path`, not both. `ref` applies to a remote repository. Locally, a remote
theme needs a checkout; point `DAYSITE_THEME` at it. That environment variable overrides a
local theme path, allowing a theme to be tried without editing an app's configuration.

## Component overrides

Add `website/daysite.config.mjs`, a theme's `daysite.config.mjs`, or both:

```js
export default {
  apiVersion: 1,
  components: {
    Header: './src/components/Header.astro',
    Footer: './src/components/Footer.astro',
    LandingPage: './src/components/LandingPage.astro',
  },
  customCss: ['./src/brand.css'],
  publicDirs: ['./static'],
};
```

Every path belongs to the module declaring it. Component selections merge in this order:
defaults, selected theme, project module, then `createDaysiteConfig()` options. CSS and asset
directories accumulate in that order. Routes with the same pattern in later layers replace
earlier ones; duplicate patterns in one layer fail. Missing files, unknown component names,
and unsupported API versions fail before the build renders anything.

Override names include `Layout`, `Header`, `Footer`, `Hero`, `LandingPage`, `GalleryPage`,
`AppGrid`, downloads, platform/channel/language pickers, screenshot components, and the smaller
building blocks. The complete registry is [src/customization.mjs](../src/customization.mjs).
The exported Astro component's `Props` is its contract; use Astro's `ComponentProps` to derive
it. `HeaderProps`, `FooterProps`, and configuration types are also exported from
`daysite/customization-types`.

There are two different import purposes:

```astro
---
// Always the original. A replacement can wrap it without recursively importing itself.
import DefaultHeader from 'daysite/components/Header.astro';
import type { HeaderProps } from 'daysite/customization-types';
interface Props extends HeaderProps {}
---
<DefaultHeader {...Astro.props}>
  <a slot="nav" href="https://example.org">Publication-supplied link label</a>
</DefaultHeader>
```

```astro
---
// The currently selected component, including theme and project overrides.
import Layout from '@daysite/components/Layout';
import Hero from '@daysite/components/Hero';
---
```

All default component composition uses the second form, so overriding a small building block
also affects pages composed from the defaults. Original layout import:
`daysite/layouts/Layout.astro`. The header has `brand` and `nav` slots; the default layout has
`head`, `before-content`, default content, and `after-content` slots. Overriding `Header` or
`Footer` preserves the default layout's SEO, favicons, theme behavior, and QR dialog. Replacing
`Layout` gives ownership of those responsibilities to the theme.

App-owned theme UI must use its own generated localization accessors, including accessibility
labels. Import bundled artwork through generated resource accessors. App Fair demonstrates
both. App publication text (store listings or blog articles) is separate from UI strings.

Assets in `publicDirs` are staged into the build's public directory. Generated publication
namespaces (`app`, `gallery`, `downloads`, `webapp`, `main`, `prerelease`) are reserved. Import
theme artwork from `src/assets` whenever possible; Astro then owns its hashed output and URL.
Use fresh asset staging for builds after removing or renaming theme public assets.

## Add pages, a blog, or take ownership of the entire site

For ordinary Astro page routing, set `srcDir` in your customization module:

```js
export default {
  apiVersion: 1,
  srcDir: './src',
  components: { Header: './src/components/Header.astro' },
};
```

Daysite injects its app landing/gallery/channel routes into this source tree. Your
`src/pages/about.astro`, `src/pages/en/blog/index.astro`, and dynamic blog routes coexist with
them. App Fair uses Astro's standard `src/content.config.ts`, `glob()` loader, validated
Markdown frontmatter, `getCollection()`, and `render()`. A theme can instead use MDX, RSS,
another content source, or another Astro integration.
The shared workflow publishes a static GitHub Pages artifact. Server-only Astro features need
a deployment that runs a server; client integrations and prerendered blog content work here.

If a custom page would occupy a default route, disable that default explicitly rather than
letting two pages compete for it:

```js
export default {
  apiVersion: 1,
  srcDir: './src',
  disabledRoutes: ['/[locale]', '/[locale]/[channel]'],
  // Alternatively replace an injected route directly:
  routes: [{ pattern: '/[locale]', entrypoint: './src/app-home.astro', prerender: true }],
};
```

Patterns use Astro's `injectRoute` syntax. The default route registry is
[src/integration.mjs](../src/integration.mjs). Disable every default if you want complete
route ownership. Component-level overrides do not require `srcDir`; replacing default routes
does. A project or theme can also supply `astro.config.mjs` to control Astro itself. Renderer
selection is project `website/astro.config.mjs`, then selected theme `astro.config.mjs`, then
the built-in configuration.
Renderer selection also accepts Astro's standard `.js`, `.ts`, `.mts`, `.cjs`, and `.cts`
configuration extensions.

In a project-owned Astro configuration:

```js
import { fileURLToPath } from 'node:url';
// CI/local build-site supplies the checkout path; no npm publication is required.
const { createDaysiteConfig } = await import(`${process.env.DAYSITE_ROOT}/src/config.mjs`);
const config = await createDaysiteConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  siteConfig: process.env.DAYSITE_CONFIG,
  publicDir: process.env.DAYSITE_PUBLIC_DIR,
  outDir: process.env.DAYSITE_OUT_DIR,
});
// Add your integrations/settings with Astro mergeConfig(), or edit config here.
export default config;
```

An installed daysite package also exposes `daysite/config` and `daysite/integration`. The
checkout workflow above is the supported delivery mechanism today; this refactor does not
publish a package. Keep the `publicDir` and `outDir` passed by the actions workflow so generated
captures/web apps and the uploaded artifact stay connected to your renderer. Keep compatible
Astro versions in the theme and renderer; commit dependency lockfiles.

The factory retains sitemap generation, optional Pagefind, portable URLs, custom-domain CNAME,
PNG optimization, Tailwind, and the self-contained resource check. Add content freely, while
serving loaded resources from the site's own origin. External navigational links are allowed.

## Reuse data without the default UI

`daysite/data` exposes `loadSite(channelId?)`, `siteChannels()`, and
`createSiteLoader({ configPath, publicDir, baseURL? })`. A loaded site includes localized app
views, platforms, artifacts, permissions, captures, icons, and channel records. Loader caches
are isolated by project and staging directory; `.invalidate()` refreshes an explicit loader.
Standalone TypeScript consumers need a TypeScript runner or Node with type stripping.

`daysite/routes`, `daysite/types`, `daysite/i18n`, `daysite/uistrings`, and `daysite/html` expose
the route helpers, types, existing localized controls, and description sanitizer. Route helpers
use Astro's deployment base; the portability build hook makes default and custom pages work
when the resulting artifact is hosted under a different prefix.

When embedding several platform pickers, enclose each related picker and its sections in
`data-platform-scope="unique-id"`. Selections are scoped and stored independently. Add
`data-platform-url="false"` to opt that scope out of controlling the page fragment. An absent
or empty scope ID preserves the legacy default platform storage key and bookmark behavior.

## Build and test locally

```sh
npm ci
# Generate captures/appindex/channels as before, or use an existing generated website directory.
export DAYSITE_CONFIG=/absolute/path/to/app/website/site.toml
export DAYSITE_THEME=/absolute/path/to/theme # Omit for the default.
node scripts/install-customization.mjs
node scripts/build-site.mjs build
node scripts/build-site.mjs dev --host 127.0.0.1 --port 4322
```

`preview.mjs` still assembles the app's data before launching development mode; it now uses the
same renderer selection as CI. `DAYSITE_PUBLIC_DIR` and `DAYSITE_OUT_DIR` select isolated
staging/output directories. Generation CLI also accepts `--public-dir`. None of these commands
publish or deploy.

CI builds the original default and a synthetic customization fixture without network app data,
then runs real-browser tests for languages/RTL, mobile layouts, downloads, galleries, release
channels, dark mode, component wrapping, Tailwind utilities, independent platform scopes, and
relocated URLs. App Fair's own workflow additionally checks its resource catalog and builds
its independent Astro content collection/blog. Existing live sample/scaffold tests remain.

## Delivery and upgrades

The supported delivery mechanism is a Git checkout, not an npm-published daysite package.
To roll out these changes, publish the renderer to the daysite revision apps select first.
Then publish reusable themes such as `appfair/appsite`, whose CI checks out the renderer,
and release the updated actions workflow at the revision app workflows select (often `v1`).
Selecting a theme remotely requires its repository and chosen ref to be accessible to Actions.
Existing apps with no customization continue using the original default appearance.

The three revisions are independent: the app workflow chooses the actions revision,
`daysite-version` chooses the renderer, and `[theme].ref` chooses the theme. Pin tested refs
where you want controlled upgrades. An older pinned renderer supports its default build but
the updated actions workflow rejects requests for customization it cannot render.

Day's [App websites guide](https://daybrite.dev/docs/websites) covers app setup, Pages,
and optional custom domains. For Actions-based Pages deployments, set the domain in GitHub's
repository Settings as well as DNS and `site.toml`; the output `CNAME` does not configure GitHub.
