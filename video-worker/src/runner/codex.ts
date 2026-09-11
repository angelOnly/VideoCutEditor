import { Codex, type ThreadOptions } from '@openai/codex-sdk';
import { appendFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from '../infrastructure/files.js';
import { prompt } from './prompts.js';
export async function runCodex(root: string, task: any) {
  const client = new Codex({
    apiKey: process.env.CODEX_API_KEY,
    baseUrl: process.env.CODEX_BASE_URL,
    codexPathOverride: process.env.CODEX_PATH,
  });
  const options: ThreadOptions = {
    workingDirectory: root,
    skipGitRepoCheck: true,
    sandboxMode: 'workspace-write',
    approvalPolicy: 'never',
    webSearchMode: 'disabled',
    networkAccessEnabled: true,
    ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}),
  };
  let threadId = task.threadId;
  try {
    threadId = (await readJson(path.join(root, 'output/session.json'))).threadId ?? threadId;
  } catch {}
  if (threadId) {
    const files = await readdir(
      path.join(process.env.CODEX_HOME ?? path.join(root, 'codex-home'), 'sessions'),
      { recursive: true },
    ).catch(() => []);
    if (!files.some((file) => String(file).includes(threadId))) threadId = null;
  }
  const thread = threadId ? client.resumeThread(threadId, options) : client.startThread(options);
  const schema = await readJson(
    '/opt/toolkit/.agents/skills/video-pipeline/references/response-v2.schema.json',
  );
  const remaining = new Date(task.limits.deadline).getTime() - Date.now();
  if (remaining <= 0) throw Error('Task deadline exceeded');
  const turn = await thread.runStreamed(prompt(task), {
    signal: AbortSignal.timeout(remaining),
    outputSchema: schema,
  });
  let final = '';
  for await (const event of turn.events) {
    // Model text can contain private input. Store only structural progress in the event log.
    await appendFile(
      path.join(root, 'output/events.jsonl'),
      JSON.stringify({ type: event.type, time: new Date().toISOString() }) + '\n',
    );
    if (event.type === 'thread.started')
      await writeJson(path.join(root, 'output/session.json'), { threadId: event.thread_id });
    if (event.type === 'item.completed' && event.item.type === 'agent_message')
      final = event.item.text;
    if (event.type === 'turn.failed' || event.type === 'error')
      throw Error(event.type === 'turn.failed' ? event.error.message : event.message);
  }
  const candidate = JSON.parse(final);
  await writeJson(path.join(root, 'output/agent-response.json'), candidate);
  if (candidate.status !== 'candidate')
    throw Error(candidate.error?.code ?? 'Codex returned failure');
}
