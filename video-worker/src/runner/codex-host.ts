import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Workspace } from '../infrastructure/workspace.js';
import type { Queue } from '../infrastructure/queue.js';
import type { Rpc } from '../infrastructure/app-server.js';
import { codexOverrides } from '../infrastructure/app-server.js';
import type { HostProcesses } from '../infrastructure/host-processes.js';
import { readJson, writeJson } from '../infrastructure/files.js';
import { prompt } from './prompts.js';

export const dynamicTools = [
  {
    type: 'function',
    name: 'video_exec',
    description:
      "Run a shell command in this task's isolated Linux workspace. Files and edits must use this tool. Commands finish before the tool returns; no background jobs persist.",
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'video_view_image',
    description:
      'Actually view an image/frame from this task (PNG or JPEG). Use after extracting video frames or rendering previews.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];
export function threadConfig(config: Config, w: Workspace) {
  const filesystem: Record<string, any> = { ':minimal': 'read', [w.root]: 'read' };
  for (const d of ['project', 'output', 'cache']) filesystem[path.join(w.root, d)] = 'write';
  // Builtin commands are disabled. This profile also constrains any remaining file tools.
  return {
    ...codexOverrides,
    project_doc_max_bytes: 0,
    default_permissions: 'videocut',
    permissions: { videocut: { filesystem, network: { enabled: false } } },
  };
}
interface Active {
  lease: Lease;
  workspace: Workspace;
  threadId: string;
  turnId?: string;
  starting: boolean;
  requested: boolean;
  ended: boolean;
  completed: boolean;
  terminal: Promise<void>;
  finish: () => void;
  final: string;
  signal: AbortSignal;
  commandAbort: AbortController;
  resolve: () => void;
  reject: (e: Error) => void;
  done: Promise<void>;
}
export class HostCodex {
  private active = new Map<string, Active>();
  constructor(
    private config: Config,
    private rpc: Rpc,
    private queue: Queue,
    private processes: HostProcesses,
  ) {
    rpc.on('notification', this.notification);
    rpc.on('fatal', this.fatal);
    rpc.handleRequest = this.handleRequest;
  }
  private fatal = (error: Error) => {
    for (const state of this.active.values()) state.reject(error);
  };
  private notification = (method: string, params: any) => {
    const state = this.active.get(params?.threadId);
    if (!state) return;
    if (method === 'turn/completed' && params.turn?.id === state.turnId) {
      state.completed = true;
      state.finish();
    }
    if (state.ended) return;
    const turnId = params.turnId ?? params.turn?.id;
    if (state.starting && !state.turnId && method === 'turn/started') state.turnId = turnId;
    if (!turnId || state.turnId !== turnId) return;
    if (method === 'item/completed' && params.item?.type === 'agentMessage')
      state.final = params.item.text;
    if (
      method === 'item/started' &&
      ['commandExecution', 'collabAgentToolCall', 'mcpToolCall'].includes(params.item?.type)
    )
      state.reject(new AppError('UNMANAGED_TOOL', '检测到未经任务执行器管理的工具调用'));
    if (method === 'turn/completed') {
      state.ended = true;
      if (params.turn.status === 'completed') state.resolve();
      else state.reject(new AppError('CODEX_TURN_FAILED', `Codex turn ${params.turn.status}`));
    }
    // Only structural information; no model text, account details or input content in shared logs.
    void appendFile(
      path.join(state.workspace.root, 'output/events.jsonl'),
      JSON.stringify({ type: method, turnId, time: new Date().toISOString() }) + '\n',
    ).catch(() => {});
  };
  private handleRequest = async (method: string, params: any) => {
    if (method !== 'item/tool/call' || params.namespace != null)
      throw new Error('Interactive approval and unrelated tools are disabled');
    const state = this.active.get(params.threadId);
    if (!state || state.ended || state.signal.aborted || state.turnId !== params.turnId)
      throw new Error('Stale tool call');
    await this.queue.withLease(state.lease, async () => {});
    if (state.ended || state.signal.aborted || this.active.get(params.threadId) !== state)
      throw new Error('Stale tool call');
    try {
      let text: string;
      if (
        params.tool === 'video_exec' &&
        typeof params.arguments?.command === 'string' &&
        params.arguments.command.length <= 100000
      ) {
        text = await this.processes.run(
          state.lease.run.id,
          state.workspace,
          ['/bin/bash', '-c', params.arguments.command],
          state.signal,
          'agent',
        );
        return { success: true, contentItems: [{ type: 'inputText', text }] };
      }
      if (params.tool === 'video_view_image' && typeof params.arguments?.path === 'string') {
        const file = path.resolve(state.workspace.root, params.arguments.path);
        const relative = path.relative(state.workspace.root, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative))
          throw new Error('Image must belong to this task');
        text = await this.processes.run(
          state.lease.run.id,
          state.workspace,
          [
            this.config.python,
            '-c',
            'import base64,pathlib,sys; b=pathlib.Path(sys.argv[1]).open("rb").read(4000001); assert len(b)<=4000000; mime="image/png" if b.startswith(b"\\x89PNG\\r\\n\\x1a\\n") else "image/jpeg" if b.startswith(b"\\xff\\xd8\\xff") else None; assert mime; print("data:"+mime+";base64,"+base64.b64encode(b).decode())',
            file,
          ],
          state.signal,
          'agent',
        );
        return { success: true, contentItems: [{ type: 'inputImage', imageUrl: text.trim() }] };
      }
      throw new Error('Unsupported task tool');
    } catch (e) {
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: e instanceof Error ? e.message : 'Tool failed' }],
      };
    }
  };
  async run(lease: Lease, w: Workspace, signal: AbortSignal) {
    signal.throwIfAborted();
    const threadRow = (
      await this.queue.db.query('SELECT thread_id FROM tasks WHERE id=$1', [lease.run.task_id])
    ).rows[0];
    const existing = threadRow.thread_id;
    const args = {
      cwd: w.root,
      runtimeWorkspaceRoots: [w.root],
      approvalPolicy: 'never',
      permissions: 'videocut',
      config: threadConfig(this.config, w),
      ...(this.config.codexModel ? { model: this.config.codexModel } : {}),
      developerInstructions:
        'All shell commands and file operations must use video_exec. All visual inspection must use video_view_image. These tools execute in an isolated per-task Ubuntu namespace. Never use other execution tools or launch background work.',
    };
    const response = await this.rpc.request(
      existing ? 'thread/resume' : 'thread/start',
      existing ? { ...args, threadId: existing, excludeTurns: true } : { ...args, dynamicTools },
    );
    if (response.activePermissionProfile?.id !== 'videocut')
      throw new AppError('SANDBOX_POLICY_UNSUPPORTED', 'Codex 未应用任务权限配置，拒绝执行');
    const threadId = response.thread.id;
    if (existing && threadId !== existing) throw new Error('Thread identity mismatch');
    if (this.active.has(threadId)) throw new Error('Thread is already executing');
    let finish!: () => void;
    const terminal = new Promise<void>((done) => {
      finish = done;
    });
    let resolve!: () => void, reject!: (e: Error) => void;
    const done = new Promise<void>((a, b) => {
      resolve = a;
      reject = b;
    });
    void done.catch(() => {});
    const commandAbort = new AbortController();
    const state: Active = {
      lease,
      workspace: w,
      threadId,
      starting: true,
      requested: false,
      ended: false,
      completed: false,
      terminal,
      finish,
      final: '',
      signal: AbortSignal.any([signal, commandAbort.signal]),
      commandAbort,
      resolve,
      reject,
      done,
    };
    this.active.set(threadId, state);
    const abort = () => reject(new AppError('CANCELLED', 'Codex 执行已中断'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      await this.queue.withLease(lease, async (q) => {
        await q.query('UPDATE tasks SET thread_id=$2,session_path=NULL WHERE id=$1', [
          lease.run.task_id,
          threadId,
        ]);
        await q.query(
          `INSERT INTO host_executions(run_id,attempt,fencing_token,thread_id,workspace)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id) DO UPDATE SET attempt=$2,fencing_token=$3,thread_id=$4,turn_id=NULL,workspace=$5`,
          [lease.run.id, lease.run.attempt, lease.token, threadId, w.root],
        );
      });
      signal.throwIfAborted();
      const outputSchema = await readJson(
        path.join(
          this.config.toolkitRoot,
          '.agents/skills/video-pipeline/references/response-v2.schema.json',
        ),
      );
      state.requested = true;
      const start = await this.rpc.request('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt(w.task, w.root, this.config.toolkitRoot) }],
        outputSchema,
      });
      if (state.turnId && state.turnId !== start.turn.id) throw new Error('Turn identity mismatch');
      state.turnId = start.turn.id;
      state.starting = false;
      await this.queue.withLease(lease, async (q) => {
        await q.query(
          'UPDATE host_executions SET turn_id=$2 WHERE run_id=$1 AND fencing_token=$3',
          [lease.run.id, state.turnId, lease.token],
        );
      });
      if (signal.aborted) abort();
      await done;
      await this.queue.withLease(lease, async () => {});
      await writeJson(path.join(w.root, 'output/agent-response.json'), JSON.parse(state.final));
    } finally {
      signal.removeEventListener('abort', abort);
      // Mark unavailable for tool calls before interrupting / killing the task cgroup.
      state.starting = false;
      try {
        await this.stop(lease.run.id);
      } finally {
        this.active.delete(threadId);
      }
    }
  }
  async stop(runId: string) {
    const state = [...this.active.values()].find((s) => s.lease.run.id === runId);
    let error: unknown;
    if (state && !state.ended) {
      state.ended = true;
      state.commandAbort.abort();
      if (state.turnId && this.rpc.healthy) {
        try {
          await this.rpc.request('turn/interrupt', {
            threadId: state.threadId,
            turnId: state.turnId,
          });
          let timer: NodeJS.Timeout | undefined;
          try {
            await Promise.race([
              state.terminal,
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('CODEX_INTERRUPT_UNCONFIRMED')), 15000);
              }),
            ]);
          } finally {
            if (timer) clearTimeout(timer);
          }
        } catch (e) {
          error = e;
        }
      } else if (state.requested && this.rpc.healthy)
        error = new Error('Unknown active turn; restart Worker before releasing slot');
    }
    await this.processes.stop(runId);
    if (error) {
      this.rpc.invalidate?.(new Error('CODEX_STOP_UNCONFIRMED'));
      throw error;
    }
  }
}
