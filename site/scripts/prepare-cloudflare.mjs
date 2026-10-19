import {access, copyFile, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath, pathToFileURL} from 'node:url';

const DEFAULTS = {
  accountId: 'ba46412ff1f79be9aef72d7f1895fd78',
  workerName: 'lumanest-tv',
  databaseName: 'lumanest-tv-production',
  bucketName: 'lumanest-tv-downloads',
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function parseOptions(args) {
  const options = {...DEFAULTS, production: false};
  const valueOptions = {
    '--database-id': 'databaseId',
    '--database-name': 'databaseName',
    '--account-id': 'accountId',
    '--worker-name': 'workerName',
    '--bucket-name': 'bucketName',
  };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (seen.has(arg)) throw new Error(`Duplicate option: ${arg}`);
    seen.add(arg);
    if (arg === '--production') options.production = true;
    else if (Object.hasOwn(valueOptions, arg)) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[valueOptions[arg]] = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (!UUID.test(options.databaseId || '') || /^00000000-/i.test(options.databaseId)) {
    throw new Error('Pass the existing destination D1 UUID with --database-id. Placeholder databases are refused.');
  }
  if (!/^[a-f0-9]{32}$/i.test(options.accountId)) throw new Error('The Cloudflare account ID must contain 32 hexadecimal characters.');
  for (const key of ['workerName', 'databaseName', 'bucketName']) {
    if (!NAME.test(options[key])) throw new Error(`Invalid ${key}; use a lowercase Cloudflare resource name.`);
  }
  return options;
}

export async function prepareCloudflare(options, root = new URL('../', import.meta.url)) {
  const server = new URL('dist/server/', root);
  const template = JSON.parse(await readFile(new URL('wrangler.json', server), 'utf8'));
  await Promise.all([
    access(new URL('index.js', server)),
    access(new URL('dist/client/', root)),
  ]);
  // Avoid automatic URL capture; API-only query redaction must be set and
  // verified separately after deployment (see the deployment instructions).
  const observability = {enabled: true, logs: {enabled: true, invocation_logs: false}, traces: {enabled: false}};
  const config = {
    name: options.workerName,
    account_id: options.accountId,
    main: 'cloudflare-entry.mjs',
    compatibility_date: template.compatibility_date || '2026-10-15',
    compatibility_flags: [...new Set([...(template.compatibility_flags || []), 'nodejs_compat', 'enable_request_signal'])],
    no_bundle: true,
    rules: [{type: 'ESModule', globs: ['**/*.js', '**/*.mjs']}],
    assets: {directory: '../client', binding: 'ASSETS'},
    d1_databases: [{binding: 'DB', database_name: options.databaseName, database_id: options.databaseId, migrations_dir: '../../drizzle'}],
    r2_buckets: [{binding: 'BUCKET', bucket_name: options.bucketName}],
    // Web player poster requests per line across isolates (lib/player-vod.ts). Free; the Worker runs without it.
    // namespace_id must differ from the stream relay's RELAY_LIMITER (1001), or the two would share counts.
    ratelimits: [{name: 'PLAYER_LIMITER', namespace_id: '1002', simple: {limit: 1200, period: 60}}],
    // Preserve dashboard settings without writing their values into source or this artifact.
    keep_vars: true,
    workers_dev: !options.production,
    preview_urls: false,
    // Do not persist automatic invocation URLs or traces containing media tokens.
    observability,
    ...(options.production ? {routes: [{pattern: 'lumanest.tv', custom_domain: true}]} : {}),
  };
  await copyFile(new URL('./cloudflare-entry.mjs', import.meta.url), new URL('cloudflare-entry.mjs', server));
  const target = new URL('wrangler-cloudflare.json', server);
  await writeFile(target, JSON.stringify(config, null, 2) + '\n');
  return {config, path: fileURLToPath(target)};
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  if (process.argv.slice(2).includes('--help')) {
    console.log('After npm run build: npm run cloudflare:prepare -- --database-id D1_UUID [--database-name NAME] [--account-id ID] [--worker-name NAME] [--bucket-name NAME] [--production]');
  } else {
    try {
      const result = await prepareCloudflare(parseOptions(process.argv.slice(2)));
      console.log(`Prepared ${result.path}`);
      console.log(result.config.routes ? 'Production domain: lumanest.tv. Deploy only after the private database and runtime configuration have been transferred and verified.' : 'No production routes are configured. The existing domain is unchanged.');
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Cloudflare preparation failed.');
      process.exitCode = 1;
    }
  }
}
