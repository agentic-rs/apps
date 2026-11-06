import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const metadata = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const manifest = {
  schema_version: 1,
  api_version: 2,
  applet_id: 'recorder',
  name: 'Recorder',
  version: metadata.version,
  permissions: ['fs', 'audio', 'speech'],
};
await mkdir('artifacts', { recursive: true });
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
const packer = process.env.APELL_BIN ?? resolve('../../apell/target/debug/apell');
execFileSync(packer, ['pack', 'dist', '--output', 'artifacts/recorder.apel'], { stdio: 'inherit' });
const digest = createHash('sha256')
  .update(await readFile('artifacts/recorder.apel'))
  .digest('hex');
await writeFile('artifacts/recorder.sha256', `${digest}  recorder.apel\n`);
await copyFile('dist/manifest.json', 'artifacts/manifest.json');
console.log(`Recorder applet built (${metadata.version}).`);
