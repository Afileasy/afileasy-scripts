#!/usr/bin/env node
/**
 * Builds the browser bundles into dist/.
 *
 *   node scripts/build.mjs                 minified production build
 *   node scripts/build.mjs --no-minify     readable output (debugging)
 *   node scripts/build.mjs --watch         rebuild on change
 *
 * Build-time configuration (all optional):
 *   AFILEASY_API_URL     default API base baked into the bundle
 *   AFILEASY_CDN_HOSTS   comma-separated hosts that must not be mistaken for
 *                        the API origin (appended to the built-in list)
 */
import { build, context } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist');

const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const minify = !args.has('--no-minify');

const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const DEFAULT_API_URL = 'https://api.afileasy.com/v1';

/**
 * Hosts that serve the script itself. `resolveApiUrl()` derives the API base
 * from the script's own origin so self-hosted installs work out of the box —
 * these hosts are excluded so the script never calls a CDN as if it were the API.
 */
const DEFAULT_CDN_HOSTS = [
  'cdn.afileasy.com',
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'unpkg.com',
  'cdn.statically.io',
  'raw.githack.com',
  'rawcdn.githack.com',
  'raw.githubusercontent.com',
];

const cdnHosts = [
  ...new Set([
    ...DEFAULT_CDN_HOSTS,
    ...(process.env.AFILEASY_CDN_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean),
  ]),
];

const apiUrl = process.env.AFILEASY_API_URL?.trim() || DEFAULT_API_URL;

/** Entry point → public file name (without the `.js` extension). */
const ENTRIES = {
  'afileasy-script': 'src/entries/core.ts',
  'afileasy-script-stripe': 'src/entries/stripe.ts',
};

const suffix = minify ? '.min' : '';
const entryPoints = Object.fromEntries(
  Object.entries(ENTRIES).map(([name, entry]) => [name + suffix, path.join(ROOT, entry)]),
);

const banner = `/*! Afileasy ${VERSION} | https://afileasy.com | (c) Afileasy */`;

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints,
  outdir: OUT_DIR,
  bundle: true,
  format: 'iife',
  target: ['es2017', 'chrome64', 'firefox62', 'safari12', 'edge79'],
  platform: 'browser',
  minify,
  sourcemap: true,
  legalComments: 'none',
  banner: { js: banner },
  charset: 'utf8',
  metafile: true,
  logLevel: 'info',
  define: {
    __AFILEASY_VERSION__: JSON.stringify(VERSION),
    __AFILEASY_API_URL__: JSON.stringify(apiUrl),
    __AFILEASY_CDN_HOSTS__: JSON.stringify(cdnHosts),
  },
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(`watching src/ — output in dist/ (minify: ${minify})`);
} else {
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const result = await build(options);
  await writeManifest(result.metafile);
}

/**
 * Writes dist/manifest.json: file sizes plus SRI hashes, so the install snippet
 * can pin `integrity="sha384-..."` for each released version.
 */
async function writeManifest(metafile) {
  const files = Object.keys(metafile.outputs)
    .map((out) => path.basename(out))
    .filter((name) => name.endsWith('.js'))
    .sort();

  const entries = {};
  const rows = [];

  for (const name of files) {
    const bytes = await readFile(path.join(OUT_DIR, name));
    const integrity = 'sha384-' + createHash('sha384').update(bytes).digest('base64');
    const gzip = gzipSync(bytes, { level: 9 }).length;
    const brotli = brotliCompressSync(bytes).length;

    entries[name] = { bytes: bytes.length, gzip, brotli, integrity };
    rows.push({
      file: name,
      raw: format(bytes.length),
      gzip: format(gzip),
      brotli: format(brotli),
    });
  }

  await writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ version: VERSION, apiUrl, cdnHosts, files: entries }, null, 2) + '\n',
  );

  console.log(`\nAfileasy ${VERSION} — api: ${apiUrl}`);
  console.table(rows);
}

function format(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(2)} kB`;
}
