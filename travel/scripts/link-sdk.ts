import { lstat, readFile, realpath, symlink, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostRoot } from './paths';

const target = await realpath(
  process.env.APELL_SDK_DIR ?? resolve(hostRoot(), 'packages/applet-sdk'),
);
const metadata = JSON.parse(await readFile(resolve(target, 'package.json'), 'utf8'));
if (metadata.name !== '@apell/sdk') throw new Error('APELL_SDK_DIR must point to the Apell SDK.');
const link = resolve('.apell-sdk');
try {
  const stat = await lstat(link);
  if (!stat.isSymbolicLink())
    throw new Error('The SDK link is occupied by a regular file or folder.');
  if ((await realpath(link).catch(() => '')) !== target) await unlink(link);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
try {
  await symlink(target, link, 'dir');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
}
console.log('Local Apell SDK is linked.');
