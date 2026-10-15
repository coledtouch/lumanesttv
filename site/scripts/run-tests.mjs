import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter(name => /\.test\.(?:ts|mjs)$/.test(name))
  .sort()
  .map(name => 'tests/' + name);
if (!tests.length) throw new Error('No site tests were found.');
const result = spawnSync(process.execPath, ['--test', ...tests], {cwd: root, stdio: 'inherit'});
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.status ?? 1;
