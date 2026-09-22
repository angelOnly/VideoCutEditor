/** 本机 Render 驱动：复用制作契约、动态媒体入口、恢复分类及独立终检，不调用客户端接口。 */
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { mkdir, readFile, realpath, rename, rmdir } from 'node:fs/promises';
import { AppServer } from '../src/infrastructure/app-server.js';
import { command } from '../src/infrastructure/process.js';
import { readJson, writeJson, hashFile, safeFile } from '../src/infrastructure/files.js';
import { dynamicTools, threadConfig } from '../src/runner/codex-host.js';
import {
  mediaArguments,
  recordMediaProgress,
  verifiedMediaProgress,
} from '../src/runner/media-tool.js';
import { prompt } from '../src/runner/prompts.js';
import { stageResponseSchema, assertStage } from '../src/contracts/two-stage.js';
import { decideRecovery } from '../src/application/render-recovery.js';
import { pipelineRevision } from '../src/domain/storyboard.js';
import { AppError } from '../src/domain/task.js';
import type { Config } from '../src/config.js';

const { values: v } = parseArgs({
  options: Object.fromEntries(
    [
      'request',
      'python',
      'modules',
      'browser',
      'codex',
      'model',
      'effort',
      'resume-id',
      'revision',
      'note',
      'pipeline',
      'mode',
    ].map((k) => [k, { type: 'string' as const }]),
  ),
});
if (!v.request || !v.python || !v.modules || !v.browser || !v.codex)
  throw Error(
    '用法：local-render --request 绝对路径 --python 路径 --modules 路径 --browser 路径 --codex 路径 [--model 模型 --effort high]；人工恢复另需 --resume-id ID --revision N --note 说明 --pipeline 版本',
  );
if (process.platform !== 'darwin')
  throw Error('本机驱动使用 macOS sandbox-exec；Linux 请使用正式 Worker');
const requestFile = await realpath(v.request),
  root = path.resolve(requestFile, '../../..');
const toolkit = await realpath(
  new URL('../../claude-code-video-toolkit', import.meta.url).pathname,
);
const request = await readJson(requestFile);
assertStage(toolkit, 'request', request);
if (
  request.stage !== 'render' ||
  requestFile !== path.join(root, 'render', request.runId, 'request.json')
)
  throw Error('必须选择已确认的 Render 请求');
const config = {
  python: path.resolve(v.python),
  toolkitRoot: toolkit,
  hostBrowser: await realpath(v.browser),
  codexPath: await realpath(v.codex),
  codexHome: process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'),
  codexModel: v.model,
  codexReasoningEffort: v.effort,
} as Config;
const modules = await realpath(v.modules),
  workspace: any = { root, task: request };
if (path.resolve(config.hostBrowser, '../../..') === '/')
  throw new AppError(
    'CAPABILITY_MISSING',
    '浏览器必须使用应用内真实可执行路径，不能扩大为根目录读取权限',
  );
const pythonRuntime = path.dirname(path.dirname(await realpath(config.python)));
const control = path.join(root, '.control'),
  ledger = path.join(control, 'local-recovery.json');
const scratch = path.join(root, 'cache/local-runtime');
await mkdir(scratch, { recursive: true });
const darwinTemp = (await command('/usr/bin/getconf', ['DARWIN_USER_TEMP_DIR'])).trim();
const socketPaths = [darwinTemp.replace(/\/$/, ''), await realpath(darwinTemp)].map(
  (p) =>
    '^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/\\.?com\\.google\\.Chrome\\.[^/]+(/.*)?$',
);
await mkdir(control, { recursive: true, mode: 0o700 });
const lock = path.join(control, 'local-driver.lock');
await mkdir(lock); // 不抢占旧控制器；异常退出遗留锁须由人核查进程后处理。
const rpc = new AppServer(),
  abort = new AbortController();
let state: any,
  started = 0,
  pendingTool: Promise<any> | undefined,
  currentThread: string | undefined,
  currentTurn: string | undefined;
let resolveTurn: () => void = () => {},
  rejectTurn: (e: Error) => void = () => {},
  final = '';
let issue: any = null,
  toolBusy = false,
  ownsProduction = false,
  turnEnded = true;
const onSignal = () => abort.abort();
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const environment = {
  PATH: `${path.dirname(config.python)}:${path.dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
  HOME: scratch,
  TMPDIR: scratch,
  LANG: 'en_US.UTF-8',
  PYTHONDONTWRITEBYTECODE: '1',
  REMOTION_BROWSER_EXECUTABLE: config.hostBrowser,
};
const quote = JSON.stringify;
function readablePaths() {
  return [
    root,
    ...['/System', '/Library', '/usr', '/bin', '/sbin', '/private/etc', '/dev'],
    path.dirname(path.dirname(config.python)),
    pythonRuntime,
    path.dirname(process.execPath),
    path.resolve(config.hostBrowser, '../../..'),
    modules,
    path.join(toolkit, 'tools'),
    path.join(toolkit, '.agents/skills'),
  ];
}
function profile(trusted: boolean) {
  const reads = readablePaths();
  const writes = ['project', 'output', 'cache', `render/${request.runId}`].map((p) =>
    path.join(root, p),
  );
  if (trusted) writes.push(control);
  return `(version 1)(deny default)(allow process*)(allow sysctl-read)(allow mach-lookup)
    (allow file-read-metadata)
    (allow file-read-data (literal "/"))
    (allow file-read* ${reads.map((p) => `(subpath ${quote(p)})`).join(' ')})
    (allow file-write* ${writes.map((p) => `(subpath ${quote(p)})`).join(' ')} (literal "/dev/null"))
    (deny file-write* (literal ${quote(requestFile)}))
    ${trusted ? `(allow file-write* (literal ${quote(path.join(root, '.execution.lock'))}) (literal ${quote(path.join(root, '.operation.lock'))}))` : ''}
    ${trusted ? `(allow file-read* file-write* ${socketPaths.map((p) => `(regex ${quote(p)})`).join(' ')})` : ''}
    ${trusted ? '(allow network* (local ip "localhost:*") (remote ip "localhost:*"))' : ''}`;
}
async function execute(argv: string[], trusted = false) {
  abort.signal.throwIfAborted();
  ownsProduction = true;
  // 可信媒体管理器需要检查进程并启动独立渲染沙箱，macOS 不允许嵌套初始化沙箱。
  // 模型 shell 保持隔离；工程 JS 的读写限制交由媒体入口在子进程启动前施加。
  return command(
    trusted ? argv[0] : '/usr/bin/sandbox-exec',
    trusted ? argv.slice(1) : ['-p', profile(false), ...argv],
    {
      cwd: root,
      env: {
        ...environment,
        ...(trusted
          ? {
              VIDEOCUT_RENDER_SANDBOX: 'seatbelt',
              VIDEOCUT_RENDER_READ_PATHS: JSON.stringify(readablePaths()),
            }
          : {}),
      },
      signal: abort.signal,
      timeout: Math.max(
        1,
        started
          ? (request.limits.executionSeconds - state.elapsedSeconds) * 1000 - (Date.now() - started)
          : 30000,
      ),
    },
  );
}
async function verifyRequest() {
  await command(
    config.python,
    [
      '-c',
      'import sys;sys.path.insert(0,sys.argv[1]);from two_stage import load_request,active_processes,require;root,r=load_request(sys.argv[2],"render");require(not active_processes(root),"已有制作进程在执行","TASK_BUSY")',
      path.join(toolkit, 'tools'),
      requestFile,
    ],
    { env: environment, timeout: 30000 },
  );
}
async function preflight() {
  // 不只检查版本：覆盖可信管理器的进程检查及独立沙箱启动，提前发现 macOS 冲突。
  await execute(['/bin/ps', '-p', String(process.pid), '-o', 'pid='], true);
  await execute(
    [
      '/usr/bin/sandbox-exec',
      '-p',
      profile(false),
      process.execPath,
      '-e',
      'process.stdout.write("sandbox_ready")',
    ],
    true,
  );
  const shell = await execute([
    '/bin/bash',
    '-c',
    'pwd; ls -d project output; test -r ' + JSON.stringify(requestFile),
  ]);
  const argv = mediaArguments(config, workspace, { command: 'preflight' });
  argv[argv.indexOf('--modules') + 1] = modules;
  const media = JSON.parse(await execute(argv, true));
  assertStage(toolkit, 'mediaResult', media);
  if (media.status !== 'ok') throw new AppError('EXECUTOR_UNAVAILABLE', '媒体预检未通过');
  return { status: 'preflight_passed', shell: shell.trim(), media };
}
async function cleanup() {
  if (!ownsProduction) return;
  await pendingTool?.catch(() => {});
  // 只回收本任务登记且进程签名匹配的组；未知孤儿组不冒险误杀。
  await command(
    config.python,
    [
      '-c',
      'import sys,os,signal,time;sys.path.insert(0,sys.argv[1]);from pathlib import Path;from two_stage import active_processes,require;root=Path(sys.argv[2]);records=active_processes(root);require(not any(r.get("orphanGroup") for r in records),"子进程归属不明，人工核查","TASK_BUSY");[(os.killpg(r["pid"],signal.SIGKILL)) for r in records];time.sleep(.2) if records else None;require(not active_processes(root),"清理未完成","TASK_BUSY")',
      path.join(toolkit, 'tools'),
      root,
    ],
    { env: environment, timeout: 15000 },
  );
}
async function save() {
  await writeJson(ledger, {
    ...state,
    activeSince: started ? Date.now() : null,
    elapsedSeconds: state.elapsedSeconds + (started ? (Date.now() - started) / 1000 : 0),
  });
}
try {
  await verifyRequest();
  if (v.mode === 'check') {
    // 先在真实任务目录检查命令和媒体入口，不启动模型、不消耗或重置制作账本。
    console.log(JSON.stringify(await preflight()));
  } else {
    try {
      state = await readJson(ledger);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
    if (!state) {
      let legacy: any = {};
      try {
        legacy = await readJson(path.join(path.dirname(requestFile), 'execution.json'));
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      state = {
        runId: request.runId,
        requestHash: await hashFile(requestFile),
        pipelineRevision,
        status: legacy.stopReason ? 'waiting_human' : 'ready',
        revision: 1,
        elapsedSeconds: legacy.elapsedSeconds ?? 0,
        repairs: legacy.repairRounds ?? 0,
        history: [],
        issue: legacy.stopReason ? { message: legacy.stopReason } : null,
      };
    }
    if (state.activeSince) {
      state.elapsedSeconds += (Date.now() - state.activeSince) / 1000;
      state.activeSince = null;
      state.status = 'waiting_human';
    }
    if (state.requestHash !== (await hashFile(requestFile)))
      throw new AppError('INPUT_CHANGED', '请求发生变化，禁止续跑');
    if (state.status === 'waiting_human' || state.pipelineRevision !== pipelineRevision) {
      if (
        !v['resume-id'] ||
        Number(v.revision) !== state.revision ||
        !v.note ||
        v.pipeline !== pipelineRevision
      )
        throw new AppError('HUMAN_REVIEW_REQUESTED', `需人工恢复参数，暂停版本 ${state.revision}`);
      if (state.history.some((x: any) => x.id === v['resume-id']))
        throw Error('恢复请求 ID 已使用');
      state.history.push({
        id: v['resume-id'],
        revision: state.revision,
        note: v.note,
        actor: os.userInfo().username,
        pipelineRevision,
        at: new Date().toISOString(),
      });
      state.status = 'ready';
      state.pipelineRevision = pipelineRevision;
      state.loop = undefined;
      state.feedback = {
        runId: request.runId,
        action: 'resume_after_human',
        note: v.note,
        instruction:
          '已修复执行器；本轮启动前会重新执行真实预检。继续现有确认版，复用配音，不重跑 Analysis。preflight 仅传 command。',
      };
    }
    if (['failed', 'succeeded'].includes(state.status))
      throw Error(`任务已经结束：${state.status}`);
    await writeJson(path.join(control, 'policy.json'), { budgetOwner: 'local-driver' });
    await save();
    started = Date.now();
    state.status = 'running';
    await save();
    const timer = setTimeout(
      () => abort.abort(),
      Math.max(1, (request.limits.executionSeconds - state.elapsedSeconds) * 1000),
    );
    try {
      try {
        console.log(JSON.stringify(await preflight()));
      } catch (e: any) {
        state.issue = {
          code: 'EXECUTOR_UNAVAILABLE',
          scope: 'shared_pipeline',
          message: e.message,
        };
        throw e;
      }
      await rpc.start(config);
      rpc.on('fatal', (e: Error) => rejectTurn(e));
      rpc.on('notification', (method: string, p: any) => {
        if (p.threadId !== currentThread) return;
        if (method === 'turn/started' && !currentTurn) currentTurn = p.turn.id;
        if ((p.turnId ?? p.turn?.id) !== currentTurn) return;
        if (method === 'item/completed' && p.item?.type === 'agentMessage') final = p.item.text;
        if (
          method === 'item/started' &&
          ['commandExecution', 'mcpToolCall', 'collabAgentToolCall'].includes(p.item?.type)
        )
          rejectTurn(new AppError('UNMANAGED_TOOL', '发现非受控工具'));
        if (method === 'turn/completed') {
          turnEnded = true;
          p.turn.status === 'completed'
            ? resolveTurn()
            : rejectTurn(new Error(`Codex ${p.turn.status}`));
        }
      });
      rpc.handleRequest = async (method, p) => {
        if (
          method !== 'item/tool/call' ||
          p.threadId !== currentThread ||
          p.turnId !== currentTurn ||
          toolBusy ||
          abort.signal.aborted
        )
          throw Error('过期或并发工具调用');
        toolBusy = true;
        pendingTool = (async () => {
          try {
            let value: any;
            if (p.tool === 'video_media') {
              const argv = mediaArguments(config, workspace, p.arguments),
                index = argv.indexOf('--modules');
              if (index >= 0) argv[index + 1] = modules;
              value = JSON.parse(await execute(argv, true));
              assertStage(toolkit, 'mediaResult', value);
              issue = value.error
                ? { ...value.error, scope: value.scope, evidence: value.diagnostics }
                : null;
              if (p.arguments.command === 'render')
                await recordMediaProgress(root, request.runId, p.arguments.scene, value);
            } else if (p.tool === 'video_exec' && typeof p.arguments.command === 'string') {
              value = {
                status: 'ok',
                output: await execute(['/bin/bash', '-c', p.arguments.command]),
              };
            } else if (p.tool === 'video_view_image') {
              const b = await readFile(await safeFile(root, p.arguments.path));
              if (b.length > 4_000_000)
                throw new AppError('INVALID_CONTRACT', '请在工程内制作较小的查看副本');
              const mime = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
                ? 'image/png'
                : b[0] === 255 && b[1] === 216
                  ? 'image/jpeg'
                  : null;
              if (!mime) throw new AppError('INVALID_CONTRACT', '只能查看 PNG/JPEG');
              return {
                success: true,
                contentItems: [
                  { type: 'inputImage', imageUrl: `data:${mime};base64,${b.toString('base64')}` },
                ],
              };
            } else
              throw new AppError(
                'CAPABILITY_MISSING',
                '本机回归只复用既有配音，不注册新的收费调用',
              );
            return {
              success: !value.error || value.status === 'adjustment_required',
              contentItems: [{ type: 'inputText', text: JSON.stringify(value) }],
            };
          } catch (e: any) {
            let report: any;
            try {
              report = JSON.parse(e.stdout);
            } catch {}
            if (p.tool === 'video_exec' && (e.exitSignal || e.code === 'ENOENT')) {
              issue = {
                code: 'EXECUTOR_UNAVAILABLE',
                scope: 'shared_pipeline',
                message: e.message,
                evidence: { exitSignal: e.exitSignal, exitCode: e.exitCode },
              };
            } else if (p.tool !== 'video_exec' && issue?.scope !== 'shared_pipeline')
              issue = report?.error
                ? { ...report.error, evidence: report.diagnostics }
                : { code: e.code ?? 'SHARED_PIPELINE_ERROR', message: e.message };
            await writeJson(path.join(control, 'last-tool-error.json'), {
              tool: p.tool,
              error: report?.error ?? { code: e.code ?? 'EXECUTION_FAILED', message: e.message },
              exitSignal: e.exitSignal ?? null,
              at: new Date().toISOString(),
            });
            return {
              success: false,
              contentItems: [
                {
                  type: 'inputText',
                  text: JSON.stringify(
                    report ?? { error: { code: e.code ?? 'EXECUTION_FAILED', message: e.message } },
                  ),
                },
              ],
            };
          } finally {
            toolBusy = false;
          }
        })();
        return pendingTool;
      };
      while (!abort.signal.aborted) {
        issue = null;
        final = '';
        currentTurn = undefined;
        try {
          await verifyRequest();
          try {
            await rename(
              path.join(root, 'output/agent-response.json'),
              path.join(control, 'previous-response.json'),
            );
          } catch (e: any) {
            if (e.code !== 'ENOENT') throw e;
          }
          const args = {
            cwd: root,
            runtimeWorkspaceRoots: [root],
            approvalPolicy: 'never',
            permissions: 'videocut',
            config: threadConfig(config, workspace),
            ...(v.model ? { model: v.model } : {}),
            developerInstructions:
              '仅使用 video_* 动态工具。本机仅复用配音，不调用 TTS；公共代码与控制目录只读。',
          };
          let thread: any;
          if (state.threadId)
            try {
              thread = await rpc.request('thread/resume', { ...args, threadId: state.threadId });
            } catch {}
          if (!thread)
            thread = await rpc.request('thread/start', {
              ...args,
              dynamicTools: dynamicTools.filter((t) => t.name !== 'video_tts'),
            });
          if (thread.activePermissionProfile?.id !== 'videocut')
            throw new AppError('CAPABILITY_MISSING', '模型权限配置未生效');
          currentThread = state.threadId = thread.thread.id;
          await save();
          turnEnded = false;
          const done = new Promise<void>((resolve, reject) => {
            resolveTurn = resolve;
            rejectTurn = reject;
          });
          void done.catch(() => {});
          const onAbort = () => rejectTurn(new AppError('TIMEOUT', '执行被中断或活动时限已到'));
          abort.signal.addEventListener('abort', onAbort, { once: true });
          try {
            await rpc.request('turn/start', {
              threadId: currentThread,
              ...(v.effort ? { effort: v.effort } : {}),
              outputSchema: stageResponseSchema,
              input: [
                {
                  type: 'text',
                  text:
                    prompt(request, root, toolkit) +
                    `\n本机受控执行，锁定依赖实际路径：${modules}。仅复用有效配音。\n本轮可信反馈：${JSON.stringify(state.feedback ?? '继续当前确认稿的 Render，检查实际时间轴与现有产物。')}`,
                },
              ],
            });
            if (abort.signal.aborted) onAbort();
            await done;
          } finally {
            abort.signal.removeEventListener('abort', onAbort);
          }
          await cleanup();
          let response: any;
          try {
            response = JSON.parse(final);
          } catch {
            throw new AppError('RENDER_RESULT_INVALID', '模型未返回合法结果 JSON');
          }
          assertStage(toolkit, 'modelResponse', response);
          if (
            response.runId !== request.runId ||
            response.taskId !== request.taskId ||
            response.stage !== 'render'
          )
            throw new AppError('INVALID_CONTRACT', '返回身份不符');
          await writeJson(path.join(root, 'output/agent-response.json'), response);
          if (response.status !== 'candidate')
            throw new AppError(
              response.status === 'human_required'
                ? 'HUMAN_REVIEW_REQUESTED'
                : 'PRODUCTION_INCOMPLETE',
              response.error?.message ?? '尚未完成',
            );
          const artifact = await safeFile(root, response.artifact),
            before = await hashFile(artifact);
          const report = JSON.parse(
            await execute([
              config.python,
              path.join(toolkit, 'tools/worker_stage.py'),
              'check',
              '--request',
              requestFile,
              '--artifact',
              response.artifact,
            ]),
          );
          if (!report.passed)
            throw new AppError(
              report.error?.code ?? 'VALIDATION_FAILED',
              report.error?.message ?? '终检未通过',
            );
          if (before !== (await hashFile(artifact)) || before !== report.artifactSha256)
            throw new AppError('INPUT_CHANGED', '终检期间产物改变');
          state.status = 'succeeded';
          state.result = { artifact: response.artifact, sha256: before, report };
          break;
        } catch (e: any) {
          // 未正常结束的模型轮次不能与下一轮重叠，关闭会话宿主后转人工。
          if (!turnEnded) {
            abort.abort();
            await rpc.close();
          }
          await cleanup();
          if (abort.signal.aborted)
            issue = { code: 'TIMEOUT', message: '执行被中断，或活动预算耗尽' };
          else if (
            !issue ||
            [
              'INPUT_CHANGED',
              'STALE_CONFIRMATION',
              'PATH_FORBIDDEN',
              'HUMAN_REVIEW_REQUESTED',
            ].includes(e.code)
          )
            issue = {
              code: e.code ?? 'SHARED_PIPELINE_ERROR',
              message: e.message,
              evidence: issue ?? undefined,
            };
          const completed = await verifiedMediaProgress(root, request.runId);
          const decision = decideRecovery(issue, completed, state.loop);
          state.loop = decision.state;
          state.issue = decision.issue;
          if (decision.action === 'fail') {
            state.status = 'failed';
            break;
          }
          if (decision.action === 'wait_human') {
            state.status = 'waiting_human';
            state.revision++;
            break;
          }
          if (decision.action === 'repair' && state.repairs >= request.limits.repairRounds) {
            state.status = 'failed';
            state.issue = {
              code: 'REPAIR_BUDGET_EXHAUSTED',
              message: '修复预算耗尽，尚未发起修复',
              cause: decision.issue,
            };
            break;
          }
          if (decision.action === 'repair') state.repairs++;
          state.feedback = {
            runId: request.runId,
            iteration: state.loop.iteration,
            action: decision.action,
            issue,
            completed,
          };
          await writeJson(path.join(control, 'feedback.json'), state.feedback);
          await save();
          console.log(JSON.stringify({ status: 'running', ...state.feedback }));
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }
} finally {
  abort.abort();
  await rpc.close();
  await cleanup();
  if (state) {
    if (state.status === 'running') {
      state.status = 'waiting_human';
      state.revision++;
      state.issue ??= { code: 'SHARED_PIPELINE_ERROR', message: '控制器未正常结束，需核查现场' };
    }
    state.elapsedSeconds += started ? (Date.now() - started) / 1000 : 0;
    started = 0;
    state.activeSince = null;
    await save();
  }
  await rmdir(lock);
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
}
if (state) console.log(JSON.stringify(state, null, 2));
if (state && state.status !== 'succeeded') process.exitCode = 2;
