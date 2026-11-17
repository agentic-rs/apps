import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostRoot } from '../../shared/scripts/paths';

const metadata = JSON.parse(await readFile('package.json', 'utf8')) as {
  version: string;
};
const manifest = {
  schema_version: 1,
  api_version: 2,
  applet_id: 'learning',
  name: 'Learning',
  version: metadata.version,
  permissions: ['fs', 'llm'],
};
await mkdir('artifacts', { recursive: true });
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
const packer = process.env.APELL_BIN ?? resolve(hostRoot(), 'target/debug/apell');
execFileSync(packer, ['pack', 'dist', '--output', 'artifacts/learning.apel'], {
  stdio: 'inherit',
});
const digest = createHash('sha256')
  .update(await readFile('artifacts/learning.apel'))
  .digest('hex');
await writeFile('artifacts/learning.sha256', `${digest}  learning.apel\n`);
await copyFile('dist/manifest.json', 'artifacts/manifest.json');
console.log(`Learning applet built (${metadata.version}).`);
