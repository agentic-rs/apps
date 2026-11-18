import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostRoot } from '../../shared/scripts/paths';
import { writePackageIcon } from '../../shared/scripts/package-icon';

const metadata = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
const manifest = {
  schema_version: 1,
  api_version: 2,
  applet_id: 'travel',
  name: 'Fieldnotes',
  version: metadata.version,
  permissions: ['fs', 'camera', 'photos', 'location', 'http', 'llm'],
};
await mkdir('artifacts', { recursive: true });
await writePackageIcon('fieldnotes');
await writeFile('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
const packer = process.env.APELL_BIN ?? resolve(hostRoot(), 'target/debug/apell');
execFileSync(packer, ['pack', 'dist', '--output', 'artifacts/travel.apel'], { stdio: 'inherit' });
const digest = createHash('sha256')
  .update(await readFile('artifacts/travel.apel'))
  .digest('hex');
await writeFile('artifacts/travel.sha256', `${digest}  travel.apel\n`);
console.log(`Fieldnotes applet built (${metadata.version}).`);
