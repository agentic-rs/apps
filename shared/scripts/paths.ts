import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

export function hostRoot(): string {
  if (process.env.APELL_ROOT) return resolve(process.env.APELL_ROOT);
  const common_dir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return resolve(dirname(resolve(common_dir)), '../apell');
}
