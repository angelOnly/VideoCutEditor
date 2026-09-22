import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { mkdir, readFile, readdir, lstat, realpath } from 'node:fs/promises';
import type { Rpc } from '../infrastructure/app-server.js';
import { codexOverrides } from '../infrastructure/app-server.js';
import { hashFile, readJson, safeFile, within, writeJson } from '../infrastructure/files.js';
import type { Config } from '../config.js';
import { validateChapterBrief } from './chapter-contract.js';

export const chapterTool = {
  type: 'function',
  name: 'video_chapters',
  description:
    '章节受控会话。dispatch 指定 chapterId、brief（任务相对 JSON）；status/cancel 指定 executionId。先写 direction.json 和 brief。章节只提交候选，主 Render 必须审核真实预览后合并。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operation'],
    properties: {
      operation: { type: 'string', enum: ['dispatch', 'status', 'cancel'] },
      chapterId: { type: 'string' },
      brief: { type: 'string' },
      executionId: { type: 'string' },
    },
  },
};
const directionDigest = (direction: any) => {
  const { reviews, ...content } = direction;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
};
const fileTool = {
  type: 'function',
  name: 'video_chapter_files',
  description:
    'read/list 的路径相对任务根；write 的路径相对本章 workspace。只能写本章候选，禁止执行进程、配音或最终发布。write 返回实际 sha256。',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['operation', 'path'],
    properties: {
      operation: { type: 'string', enum: ['read', 'list', 'write'] },
      path: { type: 'string' },
      text: { type: 'string' },
    },
  },
};
interface Chapter {
  executionId: string;
  chapterId: string;
  attemptId: string;
  directionVersion: unknown;
  directionHash: string;
  brief: string;
  briefHash: string;
  workspace: string;
  threadId?: string;
  turnId?: string;
  requested?: boolean;
  status: 'starting' | 'running' | 'candidate' | 'failed' | 'cancelled';
  error?: string;
  startedAt: string;
  endedAt?: string;
  usage?: unknown;
  result?: unknown;
  terminal: Promise<void>;
  finish: () => void;
  busy?: boolean;
}
export interface ChapterParent {
  root: string;
  runId: string;
  token: string | number;
  signal: AbortSignal;
  /** 调用方同时检查父租约及剩余预算；不能为章节重新分配完整预算。 */
  check: () => Promise<void>;
}
/** 正式宿主和本地驱动共用；唯一文件代理代替 shell，章节没有启动媒体进程的能力。 */
export class Chapters {
  private executions = new Map<string, Chapter>();
  private timer: NodeJS.Timeout;
  private writes = Promise.resolve();
  private closing = false;
  private quotaExhausted = false;
  private dispatching = new Set<string>();
  private cancellations = new Map<string, Promise<void>>();
  constructor(
    private rpc: Rpc,
    private config: Config,
    private parent: ChapterParent,
    private concurrency = 3,
  ) {
    rpc.on('notification', this.notification);
    rpc.on('fatal', this.fatal);
    parent.signal.addEventListener('abort', this.aborted, { once: true });
    this.timer = setInterval(() => {
      void this.check()
        .catch(() => this.cancelAll())
        .catch(() => {});
    }, 5000);
    this.timer.unref();
  }
  private async check() {
    this.parent.signal.throwIfAborted();
    if (this.closing) throw Error('章节控制器已关闭');
    await this.parent.check();
  }
  private aborted = () => {
    void this.cancelAll().catch(() => {});
  };
  private fatal = (error: Error) => {
    for (const c of this.executions.values())
      if (['starting', 'running'].includes(c.status)) {
        c.status = 'failed';
        c.error = error.message;
        c.finish();
        void this.persist(c);
      }
  };
  private persist(c: Chapter) {
    const { terminal, finish, busy, ...record } = c;
    const value = { ...record, parentRunId: this.parent.runId, fencingToken: this.parent.token };
    this.writes = this.writes.then(() =>
      writeJson(path.join(this.parent.root, '.control/chapters', c.executionId + '.json'), value),
    );
    return this.writes;
  }
  owns(threadId: string) {
    return [...this.executions.values()].some((c) => c.threadId === threadId);
  }
  private notification = (method: string, p: any) => {
    const c = [...this.executions.values()].find((x) => x.threadId === p.threadId);
    if (!c) return;
    if (method === 'turn/started' && !c.turnId) c.turnId = p.turn?.id;
    if (method === 'thread/tokenUsage/updated') {
      c.usage = p.tokenUsage;
      void this.persist(c).catch(() => {});
      return;
    }
    if ((p.turnId ?? p.turn?.id) !== c.turnId) return;
    if (
      method === 'item/started' &&
      ['commandExecution', 'mcpToolCall', 'collabAgentToolCall'].includes(p.item?.type)
    ) {
      c.error = 'UNMANAGED_TOOL';
      void this.cancel(c).catch(() => {});
    }
    if (method === 'turn/completed') {
      c.finish();
      if (c.status === 'cancelled') return;
      c.endedAt = new Date().toISOString();
      if (p.turn?.status !== 'completed') {
        c.status = 'failed';
        c.error = p.turn?.error?.message ?? `章节 turn ${p.turn?.status}`;
        if (/usage_limit_exceeded|quota|usage limit/i.test(JSON.stringify(p.turn?.error)))
          this.quotaExhausted = true;
      } else c.status = 'candidate'; // 候选不等于已验收；status 再核验版本和文件。
      void this.persist(c).catch(() => {});
    }
  };
  async operate(input: any) {
    await this.check();
    if (
      !input ||
      Object.keys(input).some(
        (k) => !['operation', 'chapterId', 'brief', 'executionId'].includes(k),
      )
    )
      throw Error('章节参数无效');
    if (input.operation === 'dispatch') return this.dispatch(input);
    const c = this.executions.get(input.executionId);
    if (!c) throw Error('未知章节执行，旧进程不得当作恢复成功');
    if (input.operation === 'cancel') {
      await this.cancel(c);
      return { executionId: c.executionId, status: c.status };
    }
    if (input.operation !== 'status') throw Error('未知章节操作');
    if (c.status === 'candidate') {
      try {
        c.result = await this.verify(c);
      } catch (e) {
        c.status = 'failed';
        c.error = String(e);
        await this.persist(c);
      }
    }
    const { terminal, finish, busy, ...record } = c;
    return record;
  }
  private async dispatch(input: any) {
    if (this.dispatching.has(input.chapterId)) throw Error('同章正在派发');
    if (
      this.dispatching.size +
        [...this.executions.values()].filter((c) => ['starting', 'running'].includes(c.status))
          .length >=
      this.concurrency
    )
      throw Error('章节并发槽已满');
    this.dispatching.add(input.chapterId);
    try {
      return await this.startDispatch(input);
    } finally {
      this.dispatching.delete(input.chapterId);
    }
  }
  private async startDispatch(input: any) {
    if (this.quotaExhausted) throw Error('账户额度耗尽，禁止新模型调用');
    if (typeof input.chapterId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.chapterId))
      throw Error('chapterId 无效');
    if (
      [...this.executions.values()].filter((c) => ['starting', 'running'].includes(c.status))
        .length >= this.concurrency
    )
      throw Error('章节并发槽已满');
    if (
      [...this.executions.values()].some(
        (c) => c.chapterId === input.chapterId && ['starting', 'running'].includes(c.status),
      )
    )
      throw Error('同章已有执行');
    const expected = `render/${this.parent.runId}/chapters/${input.chapterId}/brief.json`;
    if (input.brief !== expected) throw Error('brief 必须属于指定章节');
    const briefPath = await safeFile(this.parent.root, expected),
      brief = await readJson(briefPath);
    await validateChapterBrief(this.parent.root, this.parent.runId, brief);
    const direction = await readJson(
      await safeFile(this.parent.root, `render/${this.parent.runId}/direction.json`),
    );
    if (
      brief.chapterId !== input.chapterId ||
      brief.directionVersion == null ||
      brief.directionVersion !== direction.directionVersion ||
      !Array.isArray(brief.sceneIds) ||
      !brief.sceneIds.length
    )
      throw Error('章节编排版本或分镜无效');
    const attemptId = randomUUID(),
      executionId = randomUUID();
    const workspace = `render/${this.parent.runId}/chapters/${input.chapterId}/attempts/${attemptId}/workspace`;
    await mkdir(path.join(this.parent.root, workspace), { recursive: true });
    let finish!: () => void;
    const terminal = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const c: Chapter = {
      executionId,
      chapterId: input.chapterId,
      attemptId,
      brief: expected,
      briefHash: await hashFile(briefPath),
      directionVersion: brief.directionVersion,
      directionHash: directionDigest(direction),
      workspace,
      status: 'starting',
      startedAt: new Date().toISOString(),
      terminal,
      finish,
    };
    this.executions.set(executionId, c);
    await this.persist(c);
    try {
      const response = await this.rpc.request('thread/start', {
        cwd: path.join(this.parent.root, workspace),
        runtimeWorkspaceRoots: [this.parent.root],
        approvalPolicy: 'never',
        permissions: 'videocut-chapter',
        ...(this.config.codexModel ? { model: this.config.codexModel } : {}),
        config: {
          ...codexOverrides,
          project_doc_max_bytes: 0,
          default_permissions: 'videocut-chapter',
          ...(this.config.codexReasoningEffort
            ? { model_reasoning_effort: this.config.codexReasoningEffort }
            : {}),
          permissions: {
            'videocut-chapter': {
              filesystem: { ':minimal': 'read', [this.parent.root]: 'read' },
              network: { enabled: false },
            },
          },
        },
        dynamicTools: [fileTool],
        developerInstructions:
          '只使用 video_chapter_files。所有写入由可信文件代理限制在本章 workspace，不得执行命令、配音或最终发布。按 brief 创作独立组件和视觉事件草案；预览需求交主 Render 统一渲染，不能声称未生成的预览已经通过。',
      });
      if (response.activePermissionProfile?.id !== 'videocut-chapter')
        throw Error('SANDBOX_POLICY_UNSUPPORTED');
      c.threadId = response.thread.id;
      await this.check();
      c.requested = true;
      const turn = await this.rpc.request('turn/start', {
        threadId: c.threadId,
        ...(this.config.codexReasoningEffort ? { effort: this.config.codexReasoningEffort } : {}),
        input: [
          {
            type: 'text',
            text: `完成本章候选。任务根=${this.parent.root}；workspace=${workspace}。brief=${expected}；约定=${JSON.stringify(brief)}。最终在 workspace 写 result.json，包含 chapterId=${c.chapterId}、attemptId=${attemptId}、directionVersion=${JSON.stringify(c.directionVersion)}、briefHash=${c.briefHash}、sceneIds、audioAnchors、files:[{path,sha256}]（相对workspace，写文件工具会返回sha256）、previewRequests 和 visualEvents。不得伪造预览。文件名使用本章前缀，禁止修改确认文字。主控负责实际预览、审核和合并。`,
          },
        ],
      });
      if (c.turnId && c.turnId !== turn.turn.id) throw Error('章节 turn 身份冲突');
      c.turnId = turn.turn.id;
      // 启动 RPC 期间可能收到父取消；仍必须中断刚获得身份的 turn。
      if (c.status === 'cancelled' || this.parent.signal.aborted || this.closing) {
        c.status = 'running';
        this.cancellations.delete(c.executionId);
        await this.cancel(c);
        throw Error('父任务已取消');
      }
      if (c.status === 'starting') c.status = 'running';
      await this.check();
      await this.persist(c);
      return { executionId, attemptId, workspace, threadId: c.threadId, status: c.status };
    } catch (e) {
      c.error = String(e);
      await this.cancel(c);
      c.status = 'failed';
      await this.persist(c);
      throw e;
    }
  }
  async handleRequest(method: string, p: any) {
    const c = [...this.executions.values()].find((x) => x.threadId === p.threadId);
    if (
      !c ||
      method !== 'item/tool/call' ||
      p.namespace != null ||
      p.tool !== 'video_chapter_files' ||
      p.turnId !== c.turnId ||
      !['starting', 'running'].includes(c.status) ||
      c.busy
    )
      throw Error('章节工具无权限或已过期');
    await this.check();
    c.busy = true;
    try {
      const a = p.arguments;
      if (!a || typeof a.path !== 'string') throw Error('文件参数无效');
      let value: unknown;
      if (a.operation === 'write') {
        if (typeof a.text !== 'string' || Buffer.byteLength(a.text) > 1_000_000)
          throw Error('文件内容超过限制');
        const root = path.join(await realpath(this.parent.root), c.workspace),
          target = path.resolve(root, a.path);
        if (path.isAbsolute(a.path) || !within(root, target)) throw Error('章节写入越界');
        // 每层拒绝符号链接，文件代理不允许创建链接或执行代码。
        let current = root;
        for (const part of path
          .relative(root, path.dirname(target))
          .split(path.sep)
          .filter(Boolean)) {
          current = path.join(current, part);
          await mkdir(current, { recursive: true });
          if ((await lstat(current)).isSymbolicLink()) throw Error('章节路径禁止链接');
        }
        if (
          (await realpath(root)) !== root ||
          (await realpath(path.dirname(target))) !== path.dirname(target)
        )
          throw Error('章节路径禁止链接');
        const handle = await open(
          target,
          constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
          0o600,
        );
        try {
          await handle.writeFile(a.text);
        } finally {
          await handle.close();
        }
        value = { path: a.path, sha256: await hashFile(target) };
      } else if (a.operation === 'read') {
        if (a.path.split(/[\\/]/).includes('.control')) throw Error('控制记录不可读取');
        const file = await safeFile(this.parent.root, a.path);
        if ((await lstat(file)).size > 1_000_000) throw Error('文件过大，请读取必要文本输入');
        value = await readFile(file, 'utf8');
      } else if (a.operation === 'list') {
        const parentRoot = await realpath(this.parent.root);
        const target = path.resolve(parentRoot, a.path);
        if (
          !within(parentRoot, target) ||
          a.path.split(/[\\/]/).includes('.control') ||
          (await realpath(target)) !== target
        )
          throw Error('目录越界');
        value = await readdir(target);
      } else throw Error('未知文件操作');
      await this.check();
      return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(value) }] };
    } catch (e) {
      return { success: false, contentItems: [{ type: 'inputText', text: String(e) }] };
    } finally {
      c.busy = false;
    }
  }
  private async verify(c: Chapter) {
    await this.check();
    const direction = await readJson(
      await safeFile(this.parent.root, `render/${this.parent.runId}/direction.json`),
    );
    if (
      direction.directionVersion !== c.directionVersion ||
      directionDigest(direction) !== c.directionHash ||
      (await hashFile(await safeFile(this.parent.root, c.brief))) !== c.briefHash
    )
      throw Error('章节编排或 brief 已过期');
    const brief = await readJson(await safeFile(this.parent.root, c.brief));
    await validateChapterBrief(this.parent.root, this.parent.runId, brief);
    const root = path.join(this.parent.root, c.workspace),
      result = await readJson(await safeFile(root, 'result.json'));
    for (const key of ['chapterId', 'attemptId', 'directionVersion', 'briefHash'] as const)
      if (result[key] !== c[key]) throw Error(`章节结果身份不匹配：${key}`);
    if (JSON.stringify(result.sceneIds) !== JSON.stringify(brief.sceneIds))
      throw Error('章节分镜范围不匹配');
    if (!Array.isArray(result.files) || !result.files.length) throw Error('章节缺少实际文件');
    const seen = new Set<string>();
    for (const f of result.files) {
      if (seen.has(f.path)) throw Error('章节文件重复');
      seen.add(f.path);
      if ((await hashFile(await safeFile(root, f.path))) !== f.sha256)
        throw Error('章节文件摘要不匹配');
    }
    if (Array.isArray(result.visualEvents)) {
      const ids = new Set<string>();
      for (const event of result.visualEvents) {
        if (
          typeof event.id !== 'string' ||
          ids.has(event.id) ||
          !brief.sceneIds.includes(event.sceneId)
        )
          throw Error('章节事件 ID 重复或分镜越界');
        ids.add(event.id);
      }
    }
    if (
      brief.audioAnchors &&
      JSON.stringify(result.audioAnchors) !== JSON.stringify(brief.audioAnchors)
    )
      throw Error('章节音频锚点不匹配');
    return { ...result, reviewRequired: true, previewVerified: false };
  }
  private cancel(c: Chapter): Promise<void> {
    const previous = this.cancellations.get(c.executionId);
    if (previous) return previous;
    const pending = this.cancelOne(c);
    this.cancellations.set(c.executionId, pending);
    return pending;
  }
  private async cancelOne(c: Chapter) {
    if (!['starting', 'running'].includes(c.status)) return;
    c.status = 'cancelled';
    if (c.requested && !c.turnId && this.rpc.healthy) {
      this.rpc.invalidate?.(Error('CHAPTER_TURN_UNKNOWN'));
      throw Error('CHAPTER_TURN_UNKNOWN');
    }
    if (c.threadId && c.turnId && this.rpc.healthy) {
      await this.rpc.request('turn/interrupt', { threadId: c.threadId, turnId: c.turnId });
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          c.terminal,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('CHAPTER_INTERRUPT_UNCONFIRMED')), 15000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
    c.endedAt = new Date().toISOString();
    await this.persist(c);
  }
  async cancelAll() {
    await Promise.all([...this.executions.values()].map((c) => this.cancel(c)));
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    this.parent.signal.removeEventListener('abort', this.aborted);
    try {
      await this.cancelAll();
      await this.writes;
    } finally {
      this.rpc.off('notification', this.notification);
      this.rpc.off('fatal', this.fatal);
    }
  }
}
