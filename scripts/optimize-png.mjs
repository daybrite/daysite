// Recompress the built site's PNG files losslessly with oxipng (site.toml `optimize-png`).
// The pixels stay the same and the files get smaller: 15% on a Day app's captures at level 1.
// A published gallery.json records each capture's size and sha-256, so the entries of every
// file that changed are refreshed afterwards.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
/** Files per oxipng call: it spreads one call's files over every core. */
const BATCH = 64;

/** site.toml `optimize-png`: `true` is level 1, a number 0–6 is that oxipng level. */
export function optimizeLevel(setting) {
  if (setting === true) return 1;
  if (Number.isInteger(setting) && setting >= 0 && setting <= 6) return setting;
  return null;
}

async function walk(root, skips) {
  const files = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = resolve(entry.parentPath, entry.name);
    if (skips.some((s) => path === s || path.startsWith(s + sep))) continue;
    files.push(path);
  }
  return files;
}

/** Point each index entry at its file's current bytes. Returns the number of entries changed. */
export async function refreshIndex(indexPath) {
  let index;
  try {
    index = JSON.parse(await readFile(indexPath, 'utf8'));
  } catch {
    return 0;
  }
  if (!Array.isArray(index.screenshots)) return 0;
  let changed = 0;
  for (const e of index.screenshots) {
    if (!e.platform || !e.variant || !e.file || !('sha256' in e)) continue;
    const parts = [e.platform, ...(e.device ? [e.device] : []), e.variant, e.file];
    let bytes;
    try {
      bytes = await readFile(join(dirname(indexPath), ...parts));
    } catch {
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 === e.sha256) continue;
    e.sha256 = sha256;
    e.bytes = bytes.length;
    changed++;
  }
  if (changed > 0) await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');
  return changed;
}

/**
 * Optimize every PNG under `root` in place and refresh the gallery indexes beside them.
 * Returns `{ files, before, after }`, or `null` when the optimizer could not run.
 */
export async function optimizePNGs(root, { skips = [], level = 1, bin = 'oxipng', warn = () => {} } = {}) {
  try {
    await run(bin, ['--version']);
  } catch {
    warn(`optimize-png is on and \`${bin}\` is not installed, so the PNG files ship as built`);
    return null;
  }
  const all = await walk(root, skips);
  const pngs = all.filter((p) => p.toLowerCase().endsWith('.png'));
  const size = async () => (await Promise.all(pngs.map((p) => stat(p)))).reduce((n, s) => n + s.size, 0);
  const before = await size();
  for (let i = 0; i < pngs.length; i += BATCH) {
    // oxipng rewrites a file only when the result is smaller, and keeps its pixels.
    await run(bin, ['-o', String(level), '--strip', 'safe', '-q', ...pngs.slice(i, i + BATCH)],
      { maxBuffer: 1 << 24 });
  }
  for (const index of all.filter((p) => p.endsWith(sep + 'gallery.json'))) await refreshIndex(index);
  return { files: pngs.length, before, after: await size() };
}

/**
 * @param {unknown} setting site.toml `optimize-png`
 * @param {string[]} webappDirs each channel's hosted web app, which is the app's build
 * @returns {import('astro').AstroIntegration}
 */
export function optimizePNGIntegration(setting, webappDirs) {
  return {
    name: 'optimize-png',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const level = optimizeLevel(setting);
        if (level === null) return;
        const root = fileURLToPath(dir);
        const result = await optimizePNGs(root, {
          skips: webappDirs.map((d) => resolve(root, d)),
          level,
          bin: process.env.DAYSITE_OXIPNG || 'oxipng',
          warn: (m) => logger.warn(m),
        });
        if (!result) return;
        const mb = (n) => (n / 1e6).toFixed(1);
        logger.info(`${result.files} PNG files: ${mb(result.before)} MB → ${mb(result.after)} MB`);
      },
    },
  };
}
