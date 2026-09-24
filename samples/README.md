# The sample

The site a bare checkout of the template builds: Day Showcase, as it is on the main branch of
[Day-Showcase](https://github.com/daybrite/Day-Showcase) right now. Only `site.toml` is
committed; `npm run sample` (`scripts/sample.mjs`) generates everything else, so the sample
cannot drift from the app:

- a shallow clone of Day-Showcase at `main` into `.showcase/app/` (or the checkout
  `SHOWCASE_DIR` names), with `day store export` for its listing, store records and
  permission reasons, and `day icon build` for its icon family;
- the first two titled screens (`SAMPLE_SHOTS` changes the count) of the screenshots the
  Showcase's own site publishes for its main build, in every locale and theme, with that
  site's `gallery.json` cut down to match;
- `appindex.json` and `gallery-manifest.json` beside `site.toml`, from the same two
  generators CI runs for a real repository.

It needs git, network access, and a day CLI (`DAY_BIN`, else `day` on `PATH`). Everything it
writes is ignored. `npx astro build` or `npm run dev` then builds against it.
