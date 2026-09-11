import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from './helpers.js';
import { DockerSandbox } from '../src/infrastructure/sandbox.js';

test('runner receives only a task mount and model settings; validation is isolated and read-only', async () => {
  const calls: any[] = [];
  const exec = async (file: string, args: string[], opts: any) => {
    calls.push({ file, args, opts });
    if (args[0] === 'create') return 'container-id';
    if (args[0] === 'wait') return '0';
    if (args[0] === 'ps') return 'container-id';
    if (args[0] === 'start' && args.includes('-a')) return '{"passed":true}';
    return '';
  };
  const sandbox = new DockerSandbox(config({ codexApiKey: 'private-test-value' }), exec);
  const l: any = {
    run: { id: 'run-one', attempt: 1, repair_rounds: 0, deadline: new Date(Date.now() + 60000) },
  };
  const w: any = { root: '/task-specific/one', task: { operation: 'analysis' } };
  await sandbox.run(l, w, new AbortController().signal);
  await sandbox.validate(l, w, new AbortController().signal);
  const [runner, validator] = calls.filter((c) => c.args[0] === 'create');
  assert.ok(runner.args.includes('--read-only'));
  assert.ok(runner.args.includes('--cap-drop=ALL'));
  assert.ok(
    runner.args.includes(
      'type=bind,src=/task-specific/one/input,dst=/workspace/job/input,readonly',
    ),
  );
  assert.ok(!runner.args.join(' ').includes('/var/run/docker.sock'));
  assert.ok(!runner.args.join(' ').includes('private-test-value'));
  assert.ok(!runner.args.includes('DATABASE_URL'));
  assert.ok(!runner.args.includes('DOUBAO_TTS_API_KEY'));
  assert.ok(validator.args.includes('none'));
  assert.ok(
    validator.args.includes('type=bind,src=/task-specific/one,dst=/workspace/job,readonly'),
  );
  assert.ok(calls.filter((c) => c.args[0] === 'rm').length >= 2);
});
