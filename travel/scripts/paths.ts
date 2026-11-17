import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';

export function hostRoot(): string {
  const common_dir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return resolve(dirname(resolve(common_dir)), '../apell');
}
