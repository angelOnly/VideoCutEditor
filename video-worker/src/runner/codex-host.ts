import path from 'node:path';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Workspace } from '../infrastructure/workspace.js';
import type { Queue } from '../infrastructure/queue.js';
import type { Rpc } from '../infrastructure/app-server.js';
import { codexOverrides } from '../infrastructure/app-server.js';
import { productionPaths, type HostProcesses } from '../infrastructure/host-processes.js';
import { productionRoot, productionSkill } from '../infrastructure/production-plugin.js';
import { writeJson } from '../infrastructure/files.js';
import { finalReference, finalReferenceSchema, matchIdentity } from '../contracts/pipeline-io.js';
import { prompt, loadPipeline } from './prompts.js';
export function threadConfig(config: Config, w: Workspace) {
  const filesystem: Record<string, string> = {
    ':minimal': 'read',
    [w.root]: 'write',
    [path.join(w.root, 'input')]: 'read',
  };
  for (const directory of productionPaths(config)) filesystem[directory] = 'read';
  for (const file of [
    path.resolve(path.dirname(config.python), '..'),
    process.execPath,
    path.dirname(config.hostBrowser),
  ])
    filesystem[file] = 'read';
  // 虚拟环境的解释器常是符号链接；只补充该解释器实际运行时的只读目录。
  try {
    filesystem[path.resolve(path.dirname(realpathSync(config.python)), '..')] = 'read';
  } catch {}
  // Linux 沙箱会再次执行 Codex 二进制，仅开放固定依赖的运行时文件。
  if (process.platform === 'linux') {
    const require = createRequire(import.meta.url);
    const cli = require.resolve('@openai/codex/package.json');
    const native = createRequire(cli).resolve(`@openai/codex-linux-${process.arch}/package.json`);
    filesystem[path.join(path.dirname(native), 'vendor')] = 'read';
    // Ubuntu 的 resolv.conf 指向 /run；只读开放实际 DNS 配置，避免沙箱内断网。
    filesystem[realpathSync('/etc/resolv.conf')] = 'read';
  }
  return {
    ...codexOverrides,
    // 临时文件也落在任务内，兼容浏览器和渲染器且不开放宿主 /tmp。
    shell_environment_policy: {
      ...(codexOverrides.shell_environment_policy as Record<string, unknown>),
      set: { TMPDIR: path.join(w.root, 'cache') },
    },
    ...(config.codexReasoningEffort ? { model_reasoning_effort: config.codexReasoningEffort } : {}),
    project_doc_max_bytes: 0,
    default_permissions: 'videocut',
    permissions: { videocut: { filesystem, network: { enabled: true } } },
  };
}
interface Active {
  lastEvent: number;
  eventWrites: Promise<void>;
  lease: Lease;
  workspace: Workspace;
  threadId: string;
  turnId?: string;
  starting: boolean;
  requested: boolean;
  ended: boolean;
  completed: boolean;
  toolStarted: boolean;
  lastTool: { type: string; id: string | null } | null;
  terminal: Promise<void>;
  finish: () => void;
  final: string;
  signal: AbortSignal;
  commandAbort: AbortController;
  resolve: () => void;
  reject: (e: Error) => void;
  done: Promise<void>;
}

function diagnosticText(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  // Codex 的原始错误可能来自上游服务；限制长度并折叠换行，避免任务错误被异常内容撑大。
  return String(value).replace(/\s+/g, ' ').trim().slice(0, 500) || null;
}

function isToolItem(item: any) {
  const type = item?.type;
  // 未知 item 按工具处理，宁可不重试也不能重放可能已执行的操作。
  return typeof type === 'string' && !['agentMessage', 'reasoning'].includes(type);
}

function turnFailure(params: any, state: Active) {
  const source = params?.turn?.error ?? params?.error ?? {};
  const nested = source?.error ?? {};
  const providerCode = diagnosticText(
    source?.codex_error_info ?? source?.code ?? nested?.codex_error_info ?? nested?.code,
  );
  const providerMessage = diagnosticText(source?.message ?? nested?.message);
  const atCapacity =
    providerCode === 'server_overloaded' ||
    providerMessage?.toLowerCase().includes('selected model is at capacity') === true;
  const details = {
    turnStatus: diagnosticText(params?.turn?.status) ?? 'unknown',
    providerCode,
    providerMessage,
    lastTool: state.lastTool,
  };
  if (atCapacity)
    return new AppError(
      'CODEX_MODEL_OVERLOADED',
      state.toolStarted
        ? 'Codex 模型容量不足，但制作工具已启动，任务不自动重试'
        : 'Codex 模型当前容量不足，任务将稍后自动重试',
      503,
      !state.toolStarted,
      details,
    );
  return new AppError(
    'CODEX_TURN_FAILED',
    `Codex 回合执行失败（${details.turnStatus}）`,
    502,
    false,
    details,
  );
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
    if (['item/started', 'item/completed'].includes(method) && isToolItem(params.item)) {
      state.toolStarted = true;
      state.lastTool = { type: params.item.type, id: diagnosticText(params.item.id) };
    }
    if (
      method === 'item/completed' &&
      params.item?.type === 'agentMessage' &&
      params.item.phase !== 'commentary'
    )
      state.final = params.item.text;
    if (method === 'turn/completed') {
      state.ended = true;
      if (params.turn.status === 'completed') state.resolve();
      else state.reject(turnFailure(params, state));
    }
    state.lastEvent = Date.now();
    const progress = ['item/started', 'item/completed', 'turn/completed'].includes(method);
    state.eventWrites = state.eventWrites
      .then(async () => {
        await this.queue.db.query(
          'UPDATE host_executions SET last_event_at=now(),last_progress_at=CASE WHEN $3 THEN now() ELSE last_progress_at END,current_tool_name=coalesce($4,current_tool_name),tool_status=coalesce($5,tool_status) WHERE run_id=$1 AND fencing_token=$2',
          [
            state.lease.run.id,
            state.lease.token,
            progress,
            params.item?.type ?? null,
            method === 'item/started'
              ? 'running'
              : method === 'item/completed'
                ? (params.item?.status ?? 'completed')
                : null,
          ],
        );
      })
      .catch((e) => state.reject(e));
    // Only structural information; no model text, account details or input content in shared logs.
    void appendFile(
      path.join(state.workspace.root, 'output/events.jsonl'),
      JSON.stringify({
        type: method,
        threadId: state.threadId,
        turnId,
        itemId: params.item?.id,
        time: new Date().toISOString(),
      }) + '\n',
    ).catch(() => {});
  };
  private handleRequest = async (_method: string, _params: any) => {
    throw new AppError(
      'UNSUPPORTED_SERVER_REQUEST',
      '当前任务不注册 Worker 制作工具，也不允许提权',
    );
  };
  async run(lease: Lease, w: Workspace, signal: AbortSignal) {
    signal.throwIfAborted();
    const plugin = await productionSkill(this.rpc, this.config, w.root, lease.run.stage);
    const rules = loadPipeline(w.task, productionRoot(this.config));
    const inputPrompt = prompt(w.task, w.root, productionRoot(this.config), rules);
    await writeJson(path.join(w.root, `output/${lease.run.id}/plugin-runtime.json`), {
      ...plugin.release,
      skills: plugin.inputs,
    });
    const args = {
      cwd: w.root,
      runtimeWorkspaceRoots: [w.root],
      approvalPolicy: 'never',
      permissions: 'videocut',
      config: threadConfig(this.config, w),
      ...(this.config.codexModel ? { model: this.config.codexModel } : {}),
      developerInstructions:
        '使用当前权限配置提供的原生文件、命令和看图工具。所有制作资料保存在当前任务目录；长命令返回执行句柄时等待完成再提交结果。',
    };
    const previous = (
      await this.queue.db.query('SELECT thread_id FROM tasks WHERE id=$1', [lease.run.task_id])
    ).rows[0];
    // 同任务复用同一 thread；恢复失败应报告系统错误，不静默创建另一制作主控。
    const response = previous?.thread_id
      ? await this.rpc.request('thread/resume', { ...args, threadId: previous.thread_id })
      : await this.rpc.request('thread/start', args);
    if (response.activePermissionProfile?.id !== 'videocut')
      throw new AppError('SANDBOX_POLICY_UNSUPPORTED', 'Codex 未应用任务权限配置，拒绝执行');
    const threadId = response.thread.id;
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
      lastEvent: Date.now(),
      eventWrites: Promise.resolve(),
      workspace: w,
      threadId,
      starting: true,
      requested: false,
      ended: false,
      completed: false,
      toolStarted: false,
      lastTool: null,
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
    const quiet = setInterval(() => {
      if (Date.now() - state.lastEvent > 120000)
        void appendFile(
          path.join(w.root, 'output/events.jsonl'),
          JSON.stringify({
            type: 'event_gap_warning',
            threadId,
            turnId: state.turnId,
            time: new Date().toISOString(),
          }) + '\n',
        ).catch(() => {});
    }, 60000);
    try {
      await this.queue.withLease(lease, async (q) => {
        await q.query('UPDATE tasks SET thread_id=$2,session_path=NULL WHERE id=$1', [
          lease.run.task_id,
          threadId,
        ]);
        await q.query(
          `INSERT INTO host_executions(run_id,attempt,fencing_token,thread_id,workspace)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(run_id) DO UPDATE SET attempt=$2,fencing_token=$3,thread_id=$4,turn_id=NULL,workspace=$5,
          last_event_at=NULL,last_progress_at=NULL,current_tool_id=NULL,current_tool_name=NULL,
          tool_started_at=NULL,tool_ended_at=NULL,tool_status=NULL,cleanup_state=NULL`,
          [lease.run.id, lease.run.attempt, lease.token, threadId, w.root],
        );
      });
      signal.throwIfAborted();
      const outputSchema = finalReferenceSchema;
      state.requested = true;
      const start = await this.rpc.request('turn/start', {
        threadId,
        ...(this.config.codexReasoningEffort ? { effort: this.config.codexReasoningEffort } : {}),
        input: [{ type: 'text', text: inputPrompt }, ...plugin.inputs],
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
      await state.eventWrites;
      await this.queue.withLease(lease, async () => {});
      if (!state.final.trim())
        throw new AppError(
          lease.run.stage === 'analysis' ? 'ANALYSIS_RESULT_MISSING' : 'RENDER_RESULT_MISSING',
          '模型结束但未返回结果',
        );
      let result: any;
      try {
        result = JSON.parse(state.final);
      } catch {
        throw new AppError(
          lease.run.stage === 'analysis' ? 'ANALYSIS_RESULT_INVALID' : 'RENDER_RESULT_INVALID',
          '模型返回无效 JSON',
        );
      }
      result = finalReference.parse(result);
      matchIdentity(result, w.task);
      if (result.resultFile !== w.task.resultFile)
        throw new AppError('RESULT_PROTOCOL_INVALID', '最终回复没有引用当前消息输出位置');
      await writeJson(path.join(w.root, `output/${lease.run.id}/agent-response.json`), result);
    } finally {
      clearInterval(quiet);
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
    state?.commandAbort.abort();
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
    try {
      await this.processes.stop(runId);
    } catch (e) {
      await this.queue.db.query(
        "UPDATE host_executions SET cleanup_state='cleanup_failed' WHERE run_id=$1",
        [runId],
      );
      throw e;
    }
    await this.queue.db.query('UPDATE host_executions SET cleanup_state=$2 WHERE run_id=$1', [
      runId,
      error ? 'cleanup_failed' : 'stopped',
    ]);
    if (error) {
      this.rpc.invalidate?.(new Error('CODEX_STOP_UNCONFIRMED'));
      throw error;
    }
  }
}
