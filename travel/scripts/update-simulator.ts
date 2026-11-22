import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { version } from '../package.json';

const target = process.env.APELL_SIMULATOR ?? 'Apell iPhone 16 Pro';
const shell = 'dev.apell.shell';

function simctl(...args: string[]): string {
  return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8' }).trim();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const bytes = await readFile('artifacts/travel.apel');
const digest = sha256(bytes);

function dataContainer(): string {
  return simctl('get_app_container', target, shell, 'data');
}

async function isCurrent(): Promise<boolean> {
  const installed = join(
    dataContainer(),
    'Library',
    'Application Support',
    shell,
    'bundles',
    'travel',
  );
  try {
    const pointer = await readFile(join(installed, 'active'), 'utf8');
    // Older shells used a plain digest pointing to a legacy JSON package.
    if (/^[a-f0-9]{64}$/.test(pointer)) return false;
    const active = JSON.parse(pointer);
    return (
      active.applet_id === 'travel' &&
      !active.removed &&
      active.sha256 === digest &&
      sha256(await readFile(join(installed, `${digest}.apel`))) === digest
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function install(): Promise<void> {
  // Use the installed debug shell's startup handoff, the same one used by apell dev --install.
  const queue = join(dataContainer(), 'Library', 'Caches', 'apell-dev');
  const batch = randomUUID().replaceAll('-', '');
  let staging = join(queue, batch);
  await mkdir(queue, { recursive: true });
  await mkdir(staging);
  try {
    await writeFile(join(staging, '0.apel'), bytes, { flag: 'wx' });
    simctl('launch', '--terminate-running-process', target, shell, `--apell-dev-install=${batch}`);
    const deadline = Date.now() + 60_000;
    while (!existsSync(join(staging, 'result.json'))) {
      // Reinstalling the shell can move its data container while preserving the package.
      if (!existsSync(staging)) {
        staging = join(dataContainer(), 'Library', 'Caches', 'apell-dev', batch);
        if (!existsSync(staging)) {
          if (await isCurrent()) return;
          throw new Error(
            'The simulator install queue moved before Fieldnotes was installed. Retry the update.',
          );
        }
      }
      if (Date.now() >= deadline)
        throw new Error(
          'Apell did not acknowledge the install. Check that the simulator has a current debug shell.',
        );
      await delay(200);
    }
    const results = JSON.parse(await readFile(join(staging, 'result.json'), 'utf8'));
    if (
      results.length !== 1 ||
      results[0]?.applet_id !== 'travel' ||
      results[0]?.version !== version
    ) {
      throw new Error(results[0]?.error ?? 'Unexpected Fieldnotes install receipt.');
    }
    if (!(await isCurrent()))
      throw new Error('Installed Fieldnotes package differs from this build.');
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

simctl('bootstatus', target, '-b');
if (!(await isCurrent())) await install();
console.log(`Verified Fieldnotes ${version} on ${target} (SHA-256 ${digest}).`);
