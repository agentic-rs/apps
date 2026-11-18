import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';

export function hostRoot(): string {
  if (process.env.APELL_ROOT) return resolve(process.env.APELL_ROOT);
  const setting = spawnSync('git', ['config', '--worktree', '--path', '--get', 'apell.hostRoot'], {
    encoding: 'utf8',
  });
  if (setting.status === 0) {
    const root = setting.stdout.trim();
    if (!isAbsolute(root)) throw new Error('Use an absolute checkout path for apell.hostRoot.');
    return root;
  }
  const common_dir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    encoding: 'utf8',
  }).trim();
  return resolve(dirname(resolve(common_dir)), '../apell');
}

export function hostCli(): string {
  return process.env.APELL_BIN ?? Bun.which('apell') ?? resolve(hostRoot(), 'target/debug/apell');
}
