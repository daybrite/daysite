/**
 * The Day platform-toolkit vocabulary, in display order.
 *
 * `key` is the entry's name under `platforms` in appindex.json. `ios` and `android` are the
 * App Fair schema's conventional keys, so an appindex generated for a Day app remains readable
 * by any App Fair consumer; the other six are Day's additive extension. `target` is the Day
 * target id the entry was built from (`PlatformEntry.platform` carries it too).
 */
export interface DayTarget {
  /** appindex `platforms` key. */
  key: string;
  /** Day target id (`day build -p <target>`). */
  target: string;
  /** Short name for the platform picker. */
  name: string;
  /** Longer name for downloads and alt text. */
  displayName: string;
  /** Icon id under src/icons/ (the Day platform mark set). */
  icon: string;
  /** Device class — decides the gallery shell and screenshot aspect. */
  device: 'phone' | 'desktop' | 'web';
  /** Package extensions this target ships, in preference order. */
  packages: string[];
}

export const DAY_TARGETS: DayTarget[] = [
  { key: 'web',       target: 'web-dom',       name: 'Web',       displayName: 'Web (DOM)',                icon: 'web-dom',       device: 'web',     packages: [] },
  { key: 'android',   target: 'android-mdc',   name: 'Android',   displayName: 'Android (Material)',       icon: 'android-mdc',   device: 'phone',   packages: ['.apk', '.aab'] },
  { key: 'ios',       target: 'ios-uikit',     name: 'iOS',       displayName: 'iOS (UIKit)',              icon: 'ios-uikit',     device: 'phone',   packages: ['.ipa'] },
  { key: 'harmony',   target: 'harmony-arkui', name: 'HarmonyOS', displayName: 'HarmonyOS (ArkUI)',        icon: 'harmony-arkui', device: 'phone',   packages: ['.hap'] },
  { key: 'macos',     target: 'macos-appkit',  name: 'macOS',     displayName: 'macOS (AppKit)',           icon: 'macos-appkit',  device: 'desktop', packages: ['.dmg'] },
  { key: 'windows',   target: 'windows-xaml',  name: 'Windows',   displayName: 'Windows (XAML)',           icon: 'windows-xaml',  device: 'desktop', packages: ['.msix', '-setup.exe'] },
  { key: 'linux-gtk', target: 'linux-gtk',     name: 'GNOME',     displayName: 'Linux (GTK 4 / GNOME)',    icon: 'linux-gtk',     device: 'desktop', packages: ['.flatpak'] },
  { key: 'linux-qt',  target: 'linux-qt',      name: 'KDE',       displayName: 'Linux (Qt 6 / KDE)',       icon: 'linux-qt',      device: 'desktop', packages: ['.flatpak'] },
];

const byKey = new Map(DAY_TARGETS.map((t) => [t.key, t]));
const byTarget = new Map(DAY_TARGETS.map((t) => [t.target, t]));

export function dayTarget(keyOrTarget: string): DayTarget | undefined {
  return byKey.get(keyOrTarget) ?? byTarget.get(keyOrTarget);
}

/** appindex `platforms` keys in canonical display order, filtered to the ones present. */
export function orderKeys(present: Iterable<string>): string[] {
  const have = new Set(present);
  const ordered = DAY_TARGETS.filter((t) => have.has(t.key)).map((t) => t.key);
  // Unknown keys (a future target this template predates) go last rather than vanishing.
  for (const k of have) if (!ordered.includes(k)) ordered.push(k);
  return ordered;
}
