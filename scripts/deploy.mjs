#!/usr/bin/env node
/**
 * Uploads dist/ to the Cloudflare R2 bucket behind cdn.afileasy.com.
 *
 *   node scripts/deploy.mjs              upload every channel
 *   node scripts/deploy.mjs --dry-run    print the wrangler commands only
 *   node scripts/deploy.mjs --only=v1    restrict to one channel prefix
 *
 * Environment:
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN   wrangler credentials
 *   AFILEASY_R2_BUCKET                            bucket name (default: afileasy-cdn)
 *
 * Channels
 *   v<major>.<minor>.<patch>/  immutable, cached for a year — pin this in production
 *   v<major>/                  moving alias, 10 minute edge cache
 *
 * Objects are never overwritten in an exact-version channel: releasing the same
 * version twice is a mistake, so the upload aborts unless --force is passed.
 */
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const only = args.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);

const BUCKET = process.env.AFILEASY_R2_BUCKET || 'afileasy-cdn';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const ALIAS = 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400';

const CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const manifestPath = path.join(DIST, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => {
  console.error('dist/manifest.json not found — run `npm run build` first.');
  process.exit(1);
}));

const version = manifest.version;
const major = version.split('.')[0];

const channels = [
  { prefix: `v${version}`, cacheControl: IMMUTABLE, immutable: true },
  { prefix: `v${major}`, cacheControl: ALIAS, immutable: false },
].filter((channel) => !only || channel.prefix === only);

if (channels.length === 0) {
  console.error(`No channel matches --only=${only}.`);
  process.exit(1);
}

const files = (await readdir(DIST)).filter((name) => path.extname(name) in CONTENT_TYPES).sort();

console.log(`Afileasy ${version} → r2://${BUCKET}${dryRun ? '  (dry run)' : ''}`);

for (const channel of channels) {
  if (channel.immutable && !dryRun && !force) {
    const existing = files.find((name) => objectExists(`${channel.prefix}/${name}`));
    if (existing) {
      console.error(
        `\n${channel.prefix}/${existing} already exists in ${BUCKET}.\n` +
          'Released versions are immutable — bump the version in package.json, ' +
          'or pass --force to overwrite deliberately.',
      );
      process.exit(1);
    }
  }

  for (const name of files) {
    const key = `${channel.prefix}/${name}`;
    const argv = [
      'wrangler',
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      `--file=${path.join(DIST, name)}`,
      `--content-type=${CONTENT_TYPES[path.extname(name)]}`,
      `--cache-control=${channel.cacheControl}`,
      '--remote',
    ];

    if (dryRun) {
      console.log('  npx ' + argv.map(quote).join(' '));
      continue;
    }

    process.stdout.write(`  ${key} ... `);
    const result = spawnSync('npx', argv, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
      console.log('failed');
      process.stderr.write(result.stderr?.toString() ?? '');
      process.exit(result.status ?? 1);
    }
    console.log('ok');
  }
}

if (!dryRun) {
  const entry = manifest.files['afileasy-script.min.js'];
  console.log(
    `\nDone. Install snippet:\n\n` +
      `  <script src="https://cdn.afileasy.com/v${version}/afileasy-script.min.js"\n` +
      `          integrity="${entry?.integrity ?? ''}"\n` +
      `          crossorigin="anonymous"\n` +
      `          data-afileasy="YOUR_PUBLIC_KEY"></script>\n`,
  );
}

function objectExists(key) {
  const result = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, '--remote', '--pipe'],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'ignore'] },
  );
  return result.status === 0;
}

function quote(value) {
  return /[\s"']/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
