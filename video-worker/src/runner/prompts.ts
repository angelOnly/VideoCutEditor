import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AppError } from '../domain/task.js';
import { ioProtocol } from '../contracts/pipeline-io.js';
export function loadPipeline(task: any, toolkit: string) {
  if (task.protocol !== ioProtocol)
    throw new AppError('PIPELINE_REVISION_EXPIRED', '不支持旧执行协议');
  return ['SKILL.md', 'references/task-io.md'].map((file) => {
    const source = path.join(toolkit, '.agents/skills/video-pipeline', file);
    const content = readFileSync(source, 'utf8');
    return { source, content, sha256: createHash('sha256').update(content).digest('hex') };
  });
}
export function prompt(task: any, _job = '', toolkit = '/opt/toolkit', _rules?: any) {
  // 先交代本期创作目标，再交代导出协议；模板始终从当前任务输入读取。
  const renderCreation =
    task.stage === 'render'
      ? '\n本次由你负责创作完整视频。读取完整稿件、确认文本、制作要求和本任务已下载的模板，按 references/production-flow.md 完成讲解编排、真实配音驱动的组件实现、讲解对应审片及修订。模板决定栏目样式，本期内容决定正文表达；在任务工程中实现。审片须从完整口播检查变化或合理保持，不能仅凭入场动画和首中尾截图通过。发现问题修订后重验，再交付。\n'
      : '';
  // 当前 Render 的交付协议优先于参考资料中的旧版“仅 N 个分镜”示例。
  const renderDelivery =
    task.stage === 'render'
      ? '\n本次 Render 必须交付整片及全部确认分镜。使用 tools/task_io.py render --task <当前任务入口> --manifest <当前清单> 完成交付；该入口会调用现有 assemble 合片并终检。分镜批量渲染经 stage_media.py render-batch 执行时，不要自行选择 --slots：Worker 已通过 VIDEOCUT_RENDER_SLOTS 固定本任务并发，工具会拒绝不一致的值。render-batch 必须以前台命令执行并等待正常退出；严禁使用 nohup、&、disown 或 setsid 将其转入后台，也不能依据 $! 或另一条命令的临时 PID 判断渲染状态。只有批次结束、结果落盘后才可调用 task_io.py render；needs_input 只用于确实缺少人工输入。内部 manifest.scenes 仍只包含 N 个分镜；对外 result.dataList[0] 是 id=whole-video、extraData.kind=wholeVideo 的整片，dataList[1..N] 保留确认分镜顺序，files 包含 video-whole 和全部分镜。以此约定覆盖参考资料中的旧版仅分镜交付示例，不要把整片加入输入确认列表或内部 manifest.scenes。所有媒体使用 artifactRef 交给 Worker 替换服务 URL，不填写本地路径作为 url。'
      : '';
  return `按 ${path.join(toolkit, '.agents/skills/video-pipeline/SKILL.md')} 执行当前任务。\n任务入口：${task.entryFile}。\n读取入口引用的完整请求和输入资料，所有制作资料保存在当前任务目录。${renderCreation}\n使用当前环境原生工具；长命令返回句柄时等待同一命令完成。使用 functions.exec 包装 exec_command 时输出完整返回对象（text(r)），不能只输出 r.output 而丢弃 session_id。有 session_id 时用 tools.write_stdin 等待原句柄，直到返回 exit_code；functions.exec 返回 cell ID 时用 functions.wait 等待该 cell。不同隔离命令的进程不可互见，不能用另一命令的 ps 或尚无结果文件判定渲染中断。\n按 references/task-io.md 写入结果，并在当前 turn 的结构化最终回复中引用该结果文件。${renderDelivery}`;
}
