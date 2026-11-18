import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { version } from '../package.json';

const updater = join(import.meta.dir, '../scripts/update-simulator.ts');

// The shell returns from launch before its install receipt becomes visible.
const fake_xcrun = `#!/bin/sh
set -eu
[ "$1" = simctl ]
case "$2" in
  bootstatus) ;;
  get_app_container) printf '%s\\n' "$FIXTURE_CONTAINER" ;;
  launch)
    batch=\${6#--apell-dev-install=}
    stage="$FIXTURE_CONTAINER/Library/Caches/apell-dev/$batch"
    printf '%s\\n' "$batch" >> "$FIXTURE_CONTAINER/launches"
    if [ ! -f "$FIXTURE_CONTAINER/leave-corrupt" ]; then
      cp "$stage/0.apel" "$FIXTURE_INSTALLED/$FIXTURE_HASH.apel"
    fi
    printf '{"applet_id":"travel","sha256":"%s"}' "$FIXTURE_HASH" > "$FIXTURE_INSTALLED/active"
    (
      sleep 0.5
      printf '[{"applet_id":"travel","version":"%s"}]' "$FIXTURE_VERSION" > "$stage/result.tmp"
      mv "$stage/result.tmp" "$stage/result.json"
    ) </dev/null >/dev/null 2>&1 &
    ;;
  *) exit 1 ;;
esac
`;

test('waits for the shell receipt, skips an identical package, and rejects corrupt installed bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fieldnotes-simulator-'));
  try {
    const container = join(root, 'container');
    const installed = join(container, 'Library/Application Support/dev.apell.shell/bundles/travel');
    const queue = join(container, 'Library/Caches/apell-dev');
    const artifacts = join(root, 'artifacts');
    await mkdir(installed, { recursive: true });
    await mkdir(artifacts);
    const bytes = Buffer.from('synthetic Fieldnotes package');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(artifacts, 'travel.apel'), bytes);
    await writeFile(join(root, 'xcrun'), fake_xcrun, { mode: 0o755 });

    function update() {
      const result = spawnSync(process.execPath, [updater], {
        cwd: root,
        env: {
          ...process.env,
          PATH: [root, process.env.PATH].join(delimiter),
          APELL_SIMULATOR: 'Fixture simulator',
          FIXTURE_CONTAINER: container,
          FIXTURE_INSTALLED: installed,
          FIXTURE_HASH: hash,
          FIXTURE_VERSION: version,
        },
        encoding: 'utf8',
        timeout: 4_000,
      });
      if (result.error) throw result.error;
      return result;
    }

    const first = update();
    expect(first.status).toBe(0);
    expect(first.stdout).toContain(hash);
    expect(await readdir(queue)).toEqual([]);
    const launches = join(container, 'launches');
    const first_launch = await readFile(launches, 'utf8');
    expect(first_launch.trim()).toMatch(/^[a-f0-9]{32}$/);

    expect(update().status).toBe(0);
    expect(await readFile(launches, 'utf8')).toBe(first_launch);

    await writeFile(join(installed, `${hash}.apel`), 'corrupt bytes');
    await writeFile(join(container, 'leave-corrupt'), '');
    const corrupt = update();
    expect(corrupt.status).toBe(1);
    expect(corrupt.stderr).toContain('Installed Fieldnotes package differs');
    expect((await readFile(launches, 'utf8')).trim().split('\n')).toHaveLength(2);
    expect(await readdir(queue)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
