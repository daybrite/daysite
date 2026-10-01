// Convert generated resource/navigation URLs to file-relative URLs. Keeping this at the
// output boundary also covers Astro's injected styles and inline module imports, rather
// than relying on each component to remember the depth of its containing page.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { posix, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, serialize } from 'parse5';
import { init, parse as moduleImports } from 'es-module-lexer';
import cssValue from 'postcss-value-parser';

export function relativeURL(url, file, base = '/') {
  if (!url.startsWith('/') || url.startsWith('//')) return url;
  const prefix = base.replace(/\/$/, '') + '/';
  // Data files and theme CSS can also supply site-root paths without Astro's prefix.
  const local = url === prefix.slice(0, -1) ? ''
    : url.startsWith(prefix) ? url.slice(prefix.length) : url.slice(1);
  const cut = local.search(/[?#]/);
  const path = cut < 0 ? local : local.slice(0, cut);
  const suffix = cut < 0 ? '' : local.slice(cut);
  let result = posix.relative(posix.dirname(file), path || '.');
  if (!result) result = '.';
  if (!path || path.endsWith('/')) result += '/';
  if (!result.startsWith('.')) result = './' + result;
  return result + suffix;
}

export function portableCSS(text, file, base) {
  const ast = cssValue(text);
  ast.walk((node) => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      const value = node.nodes.find((n) => n.type === 'word' || n.type === 'string');
      if (value) value.value = relativeURL(value.value, file, base);
      return false;
    }
  });
  // Quoted @import URLs are not url() functions.
  for (let i = 0; i < ast.nodes.length; i++) {
    if (ast.nodes[i].type !== 'word' || ast.nodes[i].value !== '@import') continue;
    const next = ast.nodes.slice(i + 1).find((n) => n.type !== 'space' && n.type !== 'comment');
    if (next?.type === 'string') next.value = relativeURL(next.value, file, base);
  }
  return ast.toString();
}

export async function portableModule(text, file, base) {
  await init;
  const [imports] = moduleImports(text);
  // Work backwards to preserve lexer offsets. Dynamic import ranges include quotes;
  // static import/export ranges contain only the specifier.
  for (const imp of imports.toReversed()) {
    if (!imp.n) continue;
    const value = relativeURL(imp.n, file, base);
    if (value === imp.n) continue;
    text = text.slice(0, imp.s) + (imp.d >= 0 ? JSON.stringify(value) : value) + text.slice(imp.e);
  }
  return text;
}

export async function portableHTML(text, file, base) {
  const tree = parse(text);
  async function visit(node) {
    const attrs = node.attrs ?? [];
    const attr = (name) => attrs.find((a) => a.name === name)?.value;
    for (const a of attrs) {
      if (['href', 'src', 'poster', 'action', 'data-site-url'].includes(a.name)
          || a.name.startsWith('data-v-')
          || (a.name === 'data' && node.tagName === 'object')
          || (a.name === 'content' && attr('name') === 'daysite-root')) {
        a.value = relativeURL(a.value, file, base);
      } else if (a.name === 'style') {
        a.value = portableCSS(a.value, file, base);
      } else if (a.name === 'srcset') {
        a.value = a.value.replace(/(^|,\s*)(\/(?!\/)[^\s,]+)/g,
          (_, lead, url) => lead + relativeURL(url, file, base));
      } else if (a.name === 'content' && attr('http-equiv')?.toLowerCase() === 'refresh') {
        a.value = a.value.replace(/(url\s*=\s*)(.*)$/i,
          (_, lead, url) => lead + relativeURL(url, file, base));
      }
    }
    for (const child of node.childNodes ?? []) {
      if (child.nodeName === '#text' && node.tagName === 'style') {
        child.value = portableCSS(child.value, file, base);
      } else if (child.nodeName === '#text' && node.tagName === 'script' && attr('type') === 'module') {
        child.value = await portableModule(child.value, file, base);
      } else await visit(child);
    }
    if (node.content) await visit(node.content); // <template>, including gallery variants
  }
  await visit(tree);
  return serialize(tree);
}

export function portableURLsIntegration(base, webappDirs) {
  return {
    name: 'portable-urls',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const skips = webappDirs.map((d) => resolve(root, d));
        let count = 0;
        for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const path = resolve(entry.parentPath, entry.name);
          if (skips.some((s) => path === s || path.startsWith(s + sep))) continue;
          const file = relative(root, path).split(sep).join('/');
          const transform = file.endsWith('.html') ? portableHTML
            : file.endsWith('.css') ? portableCSS : null;
          if (!transform) continue;
          const original = await readFile(path, 'utf8');
          const result = await transform(original, file, base);
          if (result !== original) { await writeFile(path, result); count++; }
        }
        logger.info(`${count} page/stylesheet files use deployment-relative URLs`);
      },
    },
  };
}
