import { analysisResponseSchema, normalizeAnalysis } from '../domain/storyboard.js';
import { snapshotDigest } from '../infrastructure/stage-workspace.js';
import path from 'node:path';
import { mkdir, appendFile, readFile } from 'node:fs/promises';
import type { Config } from '../config.js';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Workspace } from '../infrastructure/workspace.js';
import type { Queue } from '../infrastructure/queue.js';
import type { Rpc } from '../infrastructure/app-server.js';
import { codexOverrides } from '../infrastructure/app-server.js';
import type { HostProcesses } from '../infrastructure/host-processes.js';
import { readJson, writeJson, hashFile } from '../infrastructure/files.js';
import { stagePath, stageResponseSchema, assertStage } from '../contracts/two-stage.js';
import { randomUUID } from 'node:crypto';
import { prompt, loadPipeline } from './prompts.js';
import { mediaArguments, recordMediaProgress } from './media-tool.js';

export const dynamicTools = [
  {
    type: 'function',
    name: 'video_media',
    description:
      '受控媒体工具。以下参数均不含必传的 command：preflight 不传其他参数；extend-timeline 必传 timeline、output，不传 scene 或 frames，自动读取待补帧记录；derive-timeline 仅适配财经模板，必传 timeline、project，时间轴明确 withBgm；assemble 必传 manifest；render 必传 scene、entry、composition、frames，可选 project、props、fixedMix。参数错误按提示改正后重试。检查返回状态；需要调整不等于已完成。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['command'],
      properties: {
        command: {
          type: 'string',
          enum: ['render', 'extend-timeline', 'derive-timeline', 'assemble', 'preflight'],
        },
        scene: { type: 'string' },
        project: { type: 'string' },
        entry: { type: 'string' },
        composition: { type: 'string' },
        props: { type: 'string' },
        frames: { type: 'integer' },
        fixedMix: { type: 'boolean' },
        timeline: { type: 'string' },
        output: { type: 'string' },
        manifest: { type: 'string' },
      },
    },
  },
  {
    type: 'function',
    name: 'video_tts',
    description:
      '按确认分镜生成配音。只在 render 使用；每镜文本必须完整。speaker 为获准实际音色或显式配置的角色映射，缺少映射时报告，不能合并双主持音色，外部保存收费凭证。',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              sceneId: { type: 'string' },
              text: { type: 'string' },
              speaker: { type: 'string' },
            },
            required: ['id', 'sceneId', 'text', 'speaker'],
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
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
      'View a task PNG/JPEG. Returns a data: image URL; pass it to image(result). Large originals are resized for inspection. If the result is an error string, read it with text(result), not image().',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

// 模型可选择栏目角色，但不能把任意字符串作为供应商音色 ID 透传。
export function authorizeTtsItems(
  value: unknown,
  approvedSpeaker: string,
  voices: Record<string, string> = {},
) {
  if (!Array.isArray(value) || !approvedSpeaker)
    throw new AppError('INVALID_TTS_REQUEST', '配音清单或服务器音色配置无效');
  return value.map((item) => {
    if (!item || typeof item !== 'object')
      throw new AppError('INVALID_TTS_REQUEST', '配音条目无效');
    const { id, sceneId, text, speaker } = item as Record<string, unknown>;
    const approved = new Set([approvedSpeaker, ...Object.values(voices)]);
    const resolved =
      typeof speaker === 'string' && Object.hasOwn(voices, speaker) ? voices[speaker] : speaker;
    // 角色必须有明确授权，不能把双主持静默替换成默认单音色。
    if (typeof resolved !== 'string' || !approved.has(resolved))
      throw new AppError('CAPABILITY_MISSING', '角色音色未获准或缺少 TTS_VOICES 映射');
    return { id, sceneId, text, speaker: resolved };
  });
}
export function threadConfig(config: Config, w: Workspace) {
  const filesystem: Record<string, any> = { ':minimal': 'read', [w.root]: 'read' };
  if (w.task?.stage === 'render')
    for (const d of ['project', 'output', 'cache']) filesystem[path.join(w.root, d)] = 'write';
  if (
    w.task?.contractVersion === 'video-two-stage/1' &&
    w.task.stage === 'render' &&
    typeof w.task.runId === 'string'
  ) {
    const renderRoot = path.resolve(w.root, 'render');
    const runRoot = path.resolve(renderRoot, w.task.runId);
    // 渲染阶段只能写入当前 run 的中间文件，不能扩大到同任务的其他 run。
    if (path.dirname(runRoot) === renderRoot) filesystem[runRoot] = 'write';
  }
  // Builtin commands are disabled. This profile also constrains any remaining file tools.
  return {
    ...codexOverrides,
    ...(config.codexReasoningEffort ? { model_reasoning_effort: config.codexReasoningEffort } : {}),
    project_doc_max_bytes: 0,
    default_permissions: 'videocut',
    permissions: { videocut: { filesystem, network: { enabled: false } } },
  };
}
interface Active {
  toolBusy?: boolean;
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
    state.lastEvent = Date.now();
    const progress = ['item/started', 'item/completed', 'turn/completed'].includes(method);
    state.eventWrites = state.eventWrites
      .then(async () => {
        await this.queue.db.query(
          'UPDATE host_executions SET last_event_at=now(),last_progress_at=CASE WHEN $3 THEN now() ELSE last_progress_at END WHERE run_id=$1 AND fencing_token=$2',
          [state.lease.run.id, state.lease.token, progress],
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
  private handleRequest = async (method: string, params: any) => {
    if (method !== 'item/tool/call' || params.namespace != null)
      throw new Error('Interactive approval and unrelated tools are disabled');
    const state = this.active.get(params.threadId);
    if (!state || state.ended || state.signal.aborted || state.turnId !== params.turnId)
      throw new Error('Stale tool call');
    await this.queue.withLease(state.lease, async () => {});
    if (state.ended || state.signal.aborted || this.active.get(params.threadId) !== state)
      throw new Error('Stale tool call');
    if (state.lease.run.stage !== 'render')
      throw new AppError('STAGE_FORBIDDEN', '文本分镜阶段禁止制作工具');
    if (state.toolBusy) throw new AppError('TASK_BUSY', '同一任务一次只能执行一个工具');
    state.toolBusy = true;
    const toolId = params.callId ?? params.itemId ?? randomUUID();
    let toolStatus = 'failed';
    try {
      await this.queue.db.query(
        'UPDATE host_executions SET current_tool_id=$3,current_tool_name=$4,tool_started_at=now(),tool_ended_at=NULL,tool_status=$5,last_progress_at=now() WHERE run_id=$1 AND fencing_token=$2',
        [state.lease.run.id, state.lease.token, toolId, params.tool, 'running'],
      );
      await appendFile(
        path.join(state.workspace.root, 'output/events.jsonl'),
        JSON.stringify({
          type: 'tool/start',
          threadId: state.threadId,
          turnId: state.turnId,
          toolId,
          tool: params.tool,
          time: new Date().toISOString(),
        }) + '\n',
      );
      let text: string;
      if (params.tool === 'video_media') {
        const argv = mediaArguments(this.config, state.workspace, params.arguments);
        let out: string;
        try {
          out = await this.processes.run(
            state.lease.run.id,
            state.workspace,
            argv,
            state.signal,
            'tool',
          );
        } catch (e: any) {
          // 非零退出由执行工具报告，保留原始错误；不伪装成功。
          let failure: any;
          try {
            failure = JSON.parse(e.stdout?.trim());
          } catch {}
          await writeJson(path.join(state.workspace.root, '.control/last-issue.json'), {
            code: failure?.error?.code ?? 'SHARED_PIPELINE_ERROR',
            message: failure?.error?.message ?? String(e),
            evidence: failure?.diagnostics,
            scope: failure?.scope,
            source: 'video_media',
          });
          throw e;
        }
        const value = JSON.parse(out.trim());
        assertStage(this.config.toolkitRoot, 'mediaResult', value);
        await writeJson(
          path.join(state.workspace.root, '.control/last-issue.json'),
          value.error
            ? {
                ...value.error,
                scope: value.scope,
                evidence: value.diagnostics,
                source: 'video_media',
              }
            : null,
        );
        toolStatus = value.error && value.status !== 'adjustment_required' ? 'failed' : 'succeeded';
        if (params.arguments.command === 'render')
          await recordMediaProgress(
            state.workspace.root,
            state.lease.run.id,
            params.arguments.scene,
            value,
          );
        return {
          success: toolStatus === 'succeeded',
          contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
        };
      }
      if (params.tool === 'video_tts') {
        if (
          state.workspace.task.contractVersion !== 'video-two-stage/1' ||
          state.lease.run.stage !== 'render'
        )
          throw new AppError('STAGE_FORBIDDEN', '当前阶段禁止配音');
        const cache = path.join(this.config.dataRoot, state.lease.run.task_id, 'tool-cache');
        await mkdir(cache, { recursive: true, mode: 0o700 });
        const items = authorizeTtsItems(
          params.arguments?.items,
          this.config.ttsVoice,
          this.config.ttsVoices,
        );
        const script = path.join(cache, randomUUID() + '.json');
        await writeJson(script, {
          taskId: state.lease.run.task_id,
          runId: state.lease.run.id,
          token: state.lease.token,
          items,
        });
        // 清单是可信层从动态工具参数保存的快照，不执行模型提供的 Python 或 shell。
        const localScript = path.join(state.workspace.root, 'tool-audio', 'tts-call.json');
        await writeJson(localScript, items);
        const out = await this.processes.run(
          state.lease.run.id,
          state.workspace,
          [
            this.config.python,
            path.join(this.config.toolkitRoot, 'tools/worker_stage.py'),
            'tts',
            '--request',
            path.join(state.workspace.root, stagePath(state.workspace.task)),
            '--script',
            localScript,
            '--cache',
            cache,
          ],
          state.signal,
          'tool',
          cache,
          true,
        );
        await this.queue.withLease(state.lease, async () => {});
        const value = JSON.parse(out.trim());
        await writeJson(
          path.join(state.workspace.root, '.control/last-issue.json'),
          value.error ? { ...value.error, source: 'video_tts' } : null,
        );
        if (Array.isArray(value.clips)) {
          const registry = path.join(state.workspace.root, 'tool-audio', 'tts-request.json');
          let previous: any[] = [];
          try {
            previous = await readJson(registry);
          } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
          }
          const clips = new Map(previous.map((clip: any) => [clip.id, clip]));
          for (const clip of value.clips) clips.set(clip.id, clip);
          await writeJson(registry, [...clips.values()]);
        }
        toolStatus = value.error ? 'failed' : 'succeeded';
        return {
          success: !value.error,
          contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
        };
      }
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
        toolStatus = 'succeeded';
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
            // 大图只缩放查看副本，原始素材及校验证据不变；FFmpeg 同样在任务命名空间运行。
            'import base64,pathlib,sys,subprocess; b=pathlib.Path(sys.argv[1]).open("rb").read(4000001); mime="image/png" if b.startswith(b"\\x89PNG\\r\\n\\x1a\\n") else "image/jpeg" if b.startswith(b"\\xff\\xd8\\xff") else None; assert mime,"Expected PNG/JPEG"; large=len(b)>4000000; b=subprocess.run(["ffmpeg","-v","error","-i",sys.argv[1],"-vf","scale=min(1920\\\\,iw):-2","-frames:v","1","-q:v","3","-f","image2pipe","-vcodec","mjpeg","pipe:1"],check=True,capture_output=True,timeout=30).stdout if large else b; mime="image/jpeg" if large else mime; assert len(b)<=4000000,"Inspection image too large"; print("data:"+mime+";base64,"+base64.b64encode(b).decode())',
            file,
          ],
          state.signal,
          'agent',
        );
        toolStatus = 'succeeded';
        return { success: true, contentItems: [{ type: 'inputImage', imageUrl: text.trim() }] };
      }
      throw new Error('Unsupported task tool');
    } catch (e) {
      if (params.tool === 'video_tts') {
        // 可信收费入口异常退出时不能猜测没有扣费，更不能交给下一轮重复发送。
        await writeJson(path.join(state.workspace.root, '.control/last-issue.json'), {
          code: e instanceof AppError ? e.code : 'EXTERNAL_RESULT_UNKNOWN',
          message: e instanceof Error ? e.message : '收费调用结果未知',
          source: 'video_tts',
        });
      } else if (params.tool === 'video_media' && e instanceof AppError) {
        await writeJson(path.join(state.workspace.root, '.control/last-issue.json'), {
          code: e.code,
          message: e.message,
          source: 'video_media',
        });
      }
      return {
        success: false,
        contentItems: [{ type: 'inputText', text: e instanceof Error ? e.message : 'Tool failed' }],
      };
    } finally {
      state.toolBusy = false;
      await this.queue.db.query(
        'UPDATE host_executions SET tool_ended_at=now(),tool_status=$3,last_progress_at=now() WHERE run_id=$1 AND fencing_token=$2',
        [state.lease.run.id, state.lease.token, toolStatus],
      );
      await appendFile(
        path.join(state.workspace.root, 'output/events.jsonl'),
        JSON.stringify({
          type: 'tool/end',
          threadId: state.threadId,
          turnId: state.turnId,
          toolId,
          tool: params.tool,
          status: toolStatus,
          time: new Date().toISOString(),
        }) + '\n',
      );
      if (
        state.workspace.task.contractVersion === 'video-two-stage/1' &&
        state.lease.run.stage === 'render'
      ) {
        try {
          // 同一个 turn 中的工具失败也受预算约束；不等模型自行结束才停止任务。
          const budget = await readJson(path.join(state.workspace.root, '.control/execution.json'));
          if (typeof budget.stopReason === 'string' && budget.stopReason)
            state.reject(new AppError('REPAIR_BUDGET_EXHAUSTED', budget.stopReason));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            state.reject(new AppError('EXECUTION_STATE_INVALID', '无法读取阶段执行预算'));
        }
      }
    }
  };
  async run(lease: Lease, w: Workspace, signal: AbortSignal) {
    signal.throwIfAborted();
    const rules = loadPipeline(w.task, this.config.toolkitRoot);
    let feedback: any = null;
    try {
      feedback = await readJson(path.join(w.root, '.control/feedback.json'));
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    const inputPrompt =
      prompt(w.task, w.root, this.config.toolkitRoot, rules) +
      (w.task.stage === 'render'
        ? `\n获准默认音色：${this.config.ttsVoice}；角色映射：${JSON.stringify(this.config.ttsVoices ?? {})}。`
        : '') +
      (feedback
        ? `\n本轮可信续跑反馈：${JSON.stringify(feedback)}\n继续当前任务，不重新 Analysis，不修改公共链路。`
        : '');
    await writeJson(
      path.join(w.root, 'output/pipeline-files.json'),
      rules.map(({ source, sha256 }) => ({ source, sha256 })),
    );
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
    const previous = (
      await this.queue.db.query('SELECT thread_id,workspace FROM host_executions WHERE run_id=$1', [
        lease.run.id,
      ])
    ).rows[0];
    let response: any;
    if (feedback && previous?.thread_id && previous.workspace === w.root) {
      try {
        response = await this.rpc.request('thread/resume', {
          ...args,
          threadId: previous.thread_id,
        });
      } catch {
        // 上下文不可恢复时只换模型上下文，不换业务 run 或清空制作现场。
        signal.throwIfAborted();
      }
    }
    if (!response)
      response = await this.rpc.request('thread/start', {
        ...args,
        dynamicTools: lease.run.stage === 'render' ? dynamicTools : [],
      });
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
            toolActive: !!state.toolBusy,
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
      const outputSchema =
        lease.run.stage === 'analysis' ? analysisResponseSchema : stageResponseSchema;
      state.requested = true;
      const start = await this.rpc.request('turn/start', {
        threadId,
        ...(this.config.codexReasoningEffort ? { effort: this.config.codexReasoningEffort } : {}),
        input: [{ type: 'text', text: inputPrompt }],
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
      if (lease.run.stage === 'analysis') {
        const plan = normalizeAnalysis(
          result,
          await readFile(path.join(w.root, 'input/script.txt'), 'utf8'),
          lease.run.task_id,
          snapshotDigest(w.task.snapshot),
        );
        await writeJson(path.join(w.root, 'analysis/plan.json'), plan);
        result = {
          contractVersion: w.task.contractVersion,
          taskId: lease.run.task_id,
          runId: lease.run.id,
          stage: 'analysis',
          status: 'candidate',
          artifact: 'analysis/plan.json',
          error: null,
        };
      }
      assertStage(this.config.toolkitRoot, 'modelResponse', result);
      await writeJson(path.join(w.root, 'output/agent-response.json'), result);
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
