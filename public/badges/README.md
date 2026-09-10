# Store badges

The App Store and Google Play badges the landing page shows for a listed app
(`Day.toml` `[store]`), one directory per locale:
`<locale>/apple-app-store.svg` and `<locale>/google-play-store.svg`.

The files are copied unchanged from the App Fair's `appland` site template
(`public/badges/`, also served at `https://appfair.net/badges/<locale>/…`), which
assembled them from the stores' own localized badge downloads. They ship with this
repository so a site build reads nothing from the network for them.

The locale directories are exactly the sets `badgeLocale()` in `src/lib/i18n.ts`
knows: 39 App Store locales and 81 Google Play locales. Keep the two in step. A
page locale with no directory of its own falls back to its language, then to `en`.

## Trademarks

Apple, the Apple logo, and App Store are trademarks of Apple Inc. Google Play and
the Google Play logo are trademarks of Google LLC. The artwork is used as the
stores' badge guidelines allow, to link to an app's listing; it is not licensed
under this repository's license.
