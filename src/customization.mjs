// The public customization contract. Paths are relative to the configuration that owns them.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

export const TEMPLATE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const COMPONENTS = [
  'Layout', 'Header', 'Footer', 'Hero', 'LandingPage', 'GalleryPage', 'AppGrid',
  'DownloadCard', 'WebAppCard', 'AboutCard', 'DescriptionBlock', 'PermissionsList',
  'PlatformShots', 'ScreenshotCarousel', 'PlatformPicker', 'ChannelPicker',
  'ChannelNote', 'LanguagePicker', 'ThemeToggle', 'SearchBar', 'StoreBadge',
  'DeviceShell', 'AppMark', 'ShotPicture', 'AppActions', 'PlatformIcon', 'CommandField',
  'DevBuildNote', 'DayLogo',
];

export function defaultComponent(name) {
  return resolve(TEMPLATE_ROOT, 'src', name === 'Layout' ? 'layouts' : 'components', `${name}.astro`);
}

export function siteConfigPath() {
  if (process.env.DAYSITE_CONFIG) return resolve(process.env.DAYSITE_CONFIG);
  const conventional = resolve(TEMPLATE_ROOT, '..', 'site.toml');
  return existsSync(conventional) ? conventional : resolve(TEMPLATE_ROOT, 'samples/site.toml');
}

function file(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`${label}: no such file: ${path}`);
  return path;
}

/** Load a theme, then project overrides, then caller overrides. No source files are copied. */
export async function loadCustomization(options = {}) {
  const configPath = resolve(options.siteConfig ?? siteConfigPath());
  const siteDir = dirname(configPath);
  const site = parse(readFileSync(configPath, 'utf8'));
  const selection = site.theme ?? {};
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
    throw new Error('site.toml: theme must be a table');
  }
  if (selection.path !== undefined && (typeof selection.path !== 'string' || !selection.path)) {
    throw new Error('site.toml: theme.path must be a nonempty string');
  }
  if (selection.repository !== undefined && (typeof selection.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(selection.repository))) {
    throw new Error('site.toml: theme.repository must be owner/name');
  }
  if (selection.repository && selection.path) throw new Error('site.toml: choose theme.repository or theme.path, not both');
  if (selection.ref !== undefined && (typeof selection.ref !== 'string' || !selection.ref || /[\n\r\0]/.test(selection.ref))) {
    throw new Error('site.toml: theme.ref must be a nonempty, single-line Git ref');
  }
  const themeDir = options.themeDir || process.env.DAYSITE_THEME ||
    (selection.path ? resolve(siteDir, selection.path) : undefined);
  if (selection.repository && !themeDir) {
    throw new Error(`site.toml selects ${selection.repository}: set DAYSITE_THEME to its checkout (CI does this automatically)`);
  }
  const layers = [];
  if (themeDir) layers.push(resolve(themeDir, 'daysite.config.mjs'));
  const projectConfig = resolve(siteDir, 'daysite.config.mjs');
  if (existsSync(projectConfig) && !layers.includes(projectConfig)) layers.push(projectConfig);
  const result = {
    configPath, siteDir, themeDir: themeDir ? resolve(themeDir) : undefined,
    components: {}, customCss: [], publicDirs: [],
    routes: [], srcDir: undefined, disabledRoutes: [], watchFiles: [configPath, resolve(siteDir, 'theme.css')],
  };
  for (const config of layers) {
    file(config, 'daysite customization');
    // Refresh the configuration on an Astro config restart, including local development.
    const layer = (await import(/* @vite-ignore */ `${pathToFileURL(config).href}?mtime=${statSync(config).mtimeMs}`)).default;
    applyLayer(result, layer, dirname(config));
    result.watchFiles.push(config);
  }
  applyLayer(result, options, options.root ? resolve(options.root) : siteDir);
  return result;
}

function applyLayer(result, layer, root) {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) {
    throw new Error('daysite.config.mjs must export a configuration object');
  }
  if (layer.apiVersion !== undefined && layer.apiVersion !== 1) throw new Error('Unsupported daysite customization apiVersion; expected 1');
  if (layer.components !== undefined && (!layer.components || typeof layer.components !== 'object' || Array.isArray(layer.components))) {
    throw new Error('components must be an object');
  }
  for (const key of ['customCss', 'publicDirs', 'disabledRoutes']) {
    if (layer[key] !== undefined && (!Array.isArray(layer[key]) || layer[key].some((value) => typeof value !== 'string' || !value))) {
      throw new Error(`${key} must be an array of nonempty strings`);
    }
  }
  if (layer.routes !== undefined && !Array.isArray(layer.routes)) throw new Error('routes must be an array');
  if (layer.srcDir !== undefined && (typeof layer.srcDir !== 'string' || !layer.srcDir)) throw new Error('srcDir must be a nonempty string');
  for (const [name, value] of Object.entries(layer.components ?? {})) {
    if (!COMPONENTS.includes(name)) throw new Error(`Unknown daysite component: ${name}`);
    if (typeof value !== 'string') throw new Error(`Component ${name} must name an Astro file`);
    const path = file(resolve(root, value), `Component ${name}`);
    if (!path.endsWith('.astro')) throw new Error(`Component ${name} must be an .astro file`);
    result.components[name] = path;
    result.watchFiles.push(path);
  }
  for (const css of layer.customCss ?? []) {
    result.customCss.push(file(resolve(root, css), 'customCss'));
  }
  for (const publicDir of layer.publicDirs ?? []) result.publicDirs.push(resolve(root, publicDir));
  if (layer.srcDir) result.srcDir = resolve(root, layer.srcDir);
  const patterns = new Set();
  for (const route of layer.routes ?? []) {
    if (!route || typeof route.pattern !== 'string' || !route.pattern.startsWith('/')) throw new Error('A daysite route pattern must begin with /');
    if (typeof route.entrypoint !== 'string' || !route.entrypoint) throw new Error(`Route ${route.pattern} must name an entrypoint`);
    if (route.prerender !== undefined && typeof route.prerender !== 'boolean') throw new Error(`Route ${route.pattern}: prerender must be a boolean`);
    if (patterns.has(route.pattern)) throw new Error(`Duplicate daysite route pattern: ${route.pattern}`);
    patterns.add(route.pattern);
    const entry = { ...route, entrypoint: file(resolve(root, route.entrypoint), `Route ${route.pattern}`) };
    const previous = result.routes.findIndex((item) => item.pattern === route.pattern);
    if (previous < 0) result.routes.push(entry);
    else result.routes[previous] = entry;
  }
  result.disabledRoutes.push(...(layer.disabledRoutes ?? []));
}
