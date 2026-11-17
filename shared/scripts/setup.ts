import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const collection_root = realpathSync(resolve(import.meta.dir, '../..'));
const app_dirs = ['recorder', 'learning', 'travel'].map((name) => resolve(collection_root, name));
const current_dir = realpathSync(process.cwd());
if (current_dir !== collection_root && !app_dirs.includes(current_dir)) {
  throw new Error('Run setup from the collection root or an app directory.');
}

// Shared packaging tools must be available even when setup starts inside one app.
execFileSync(process.execPath, ['install'], { cwd: collection_root, stdio: 'inherit' });
for (const app_dir of current_dir === collection_root ? app_dirs : [current_dir]) {
  execFileSync(process.execPath, [resolve(import.meta.dir, 'link-sdk.ts')], {
    cwd: app_dir,
    stdio: 'inherit',
  });
  execFileSync(process.execPath, ['install'], { cwd: app_dir, stdio: 'inherit' });
}
