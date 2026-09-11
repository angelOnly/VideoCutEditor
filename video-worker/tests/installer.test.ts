import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const deploy = new URL('../deploy/', import.meta.url);

test('generated systemd unit preserves literal WorkingDirectory and quotes command/environment separately', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'worker-unit-'));
  try {
    const script = await readFile(new URL('install-host.sh', deploy), 'utf8');
    const generator = script.split("python3 - <<'PY'\n")[1].split('\nPY\n')[0];
    await mkdir(path.join(dir, '.config/systemd/user'), { recursive: true });
    const service = path.join(dir, 'repo with spaces % value/video-worker');
    const code = `import pathlib, unittest.mock, os
with unittest.mock.patch.object(pathlib.Path, 'home', return_value=pathlib.Path(os.environ['TEST_INSTALL_ROOT'])):
    exec(${JSON.stringify(generator)})`;
    execFileSync('python3', ['-c', code], {
      env: {
        ...process.env,
        TEST_INSTALL_ROOT: dir,
        VIDEOCUT_INSTALL_SERVICE_DIR: service,
        VIDEOCUT_INSTALL_NODE_DIR: '/usr/local/bin',
      },
    });
    const unit = await readFile(
      path.join(dir, '.config/systemd/user/videocut-worker.service'),
      'utf8',
    );
    assert.ok(unit.includes(`WorkingDirectory=${service.replaceAll('%', '%%')}\n`));
    assert.ok(!unit.includes('WorkingDirectory="'));
    assert.ok(unit.includes(`ExecStart="${service.replaceAll('%', '%%')}/deploy/start-worker.sh"`));
    assert.ok(unit.includes('Environment="PATH=/usr/local/bin:/usr/local/bin:/usr/bin:/bin"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('AppArmor installer preserves existing policy and only installs after a matching failed probe', async () => {
  const source = await readFile(new URL('install-bwrap-policy.sh', deploy), 'utf8');
  for (const scenario of [
    'disabled',
    'working',
    'missing',
    'custom',
    'compile-failure',
    'unrelated-error',
  ]) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'worker-policy-'));
    try {
      const bin = path.join(dir, 'bin'),
        policies = path.join(dir, 'policies');
      await mkdir(bin);
      await mkdir(policies);
      await mkdir(path.join(dir, 'apparmor'));
      await copyFile(
        new URL('apparmor/bwrap-userns-restrict', deploy),
        path.join(dir, 'apparmor/bwrap-userns-restrict'),
      );
      await writeFile(path.join(dir, 'loaded'), '');
      if (scenario === 'custom')
        await writeFile(path.join(policies, 'admin-policy'), 'profile bwrap /usr/bin/bwrap { }');
      const fake = async (name: string, body: string) =>
        writeFile(path.join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o755 });
      await fake('sysctl', 'if [[ "$TEST_SCENARIO" == disabled ]]; then echo 0; else echo 1; fi\n');
      await fake('sudo', 'exec "$@"\n');
      await fake(
        'systemd-run',
        `if [[ "$TEST_SCENARIO" == working || -f "$TEST_ROOT/loaded-ok" ]]; then exit 0; fi
if [[ "$TEST_SCENARIO" == unrelated-error ]]; then echo 'Failed to connect to bus' >&2; else echo 'bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted' >&2; fi
exit 1\n`,
      );
      await fake(
        'apparmor_parser',
        `if [[ "$TEST_SCENARIO" == compile-failure ]]; then exit 1; fi
if [[ "$1" == '-r' ]]; then touch "$TEST_ROOT/loaded-ok"; fi\n`,
      );
      await fake(
        'install',
        'args=("$@"); n=${#args[@]}; cp "${args[$((n-2))]}" "${args[$((n-1))]}"\n',
      );
      const script = path.join(dir, 'install.sh');
      await writeFile(
        script,
        source
          .replaceAll('/etc/apparmor.d', policies)
          .replaceAll('/sys/kernel/security/apparmor/profiles', path.join(dir, 'loaded')),
      );
      let failed = false;
      try {
        execFileSync('/bin/bash', [script], {
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            TEST_ROOT: dir,
            TEST_SCENARIO: scenario,
          },
          stdio: 'pipe',
        });
      } catch {
        failed = true;
      }
      assert.equal(
        failed,
        ['custom', 'compile-failure', 'unrelated-error'].includes(scenario),
        scenario,
      );
      const installed = await readFile(path.join(policies, 'videocut-bwrap-userns'), 'utf8').catch(
        () => null,
      );
      assert.equal(installed !== null, scenario === 'missing', scenario);
      if (scenario === 'custom')
        assert.equal(
          await readFile(path.join(policies, 'admin-policy'), 'utf8'),
          'profile bwrap /usr/bin/bwrap { }',
        );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
});
