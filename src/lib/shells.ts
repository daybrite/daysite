// Which presentational shell a platform's screenshot wears in the gallery.
//
// Captures are the WINDOW CONTENT by design (day docs/testing): offscreen snapshots are
// deterministic, headless, and permission-free, and Linux CI runs under bare xvfb where no
// window manager exists to draw real decorations. So the desktop frame is drawn in CSS at
// display time — traffic lights for macOS, caption glyphs for Windows, an Adwaita headerbar
// for GNOME, Breeze for KDE, a browser bar for the web build (styles/shells.css, adopted from
// the day website so an app gallery and daybrite.dev dress the same capture the same way).
//
// Phones get the opposite treatment: their captures already hold the real screen chrome, so
// the shell adds only the hardware around the glass.

const CHROME: Record<string, string> = {
  'macos-appkit': 'macos',
  'windows-xaml': 'windows',
  'linux-gtk': 'gnome',
  'linux-qt': 'kde',
  'web-dom': 'browser',
};

const BEZEL: Record<string, string> = {
  'ios-uikit': 'iphone',
  'android-mdc': 'android',
  'harmony-arkui': 'harmony',
};

/** The window decoration for a desktop/web target, if it has one. */
export const chromeOf = (id: string): string | undefined => CHROME[id];

/** The hardware bezel for a phone-class target, if it has one. */
export const bezelOf = (id: string): string | undefined => BEZEL[id];
