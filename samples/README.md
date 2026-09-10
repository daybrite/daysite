# The bundled sample

A Day project in miniature, so a bare checkout of the template has something to build:
Day Showcase's own `Day.toml` (trimmed), its `store/` listing texts in every locale, its icon
master with the png family sizes the favicon set takes, and two screenshots per platform,
scaled down to keep the fixture small. Everything here is copied from the
[Day-Showcase](https://github.com/daybrite/Day-Showcase) repository and its capture tree
(Apache-2.0, like that app).

`npm run sample` runs the same two generators CI runs for a real repository and writes
`appindex.json` and `gallery-manifest.json` beside `site.toml` (both generated, both
ignored); `npx astro build` or `npm run dev` then builds against them.
