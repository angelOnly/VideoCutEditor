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
  // 当前 Render 的交付协议优先于参考资料中的旧版“仅 N 个分镜”示例。
  const renderDelivery =
    task.stage === 'render'
      ? '\n本次 Render 必须交付整片及全部确认分镜。使用 tools/task_io.py render --task <当前任务入口> --manifest <当前清单> 完成交付；该入口会调用现有 assemble 合片并终检。分镜批量渲染经 stage_media.py render-batch 执行时，不要自行选择 --slots：Worker 已通过 VIDEOCUT_RENDER_SLOTS 固定本任务并发，工具会拒绝不一致的值。内部 manifest.scenes 仍只包含 N 个分镜；对外 result.dataList[0] 是 id=whole-video、extraData.kind=wholeVideo 的整片，dataList[1..N] 保留确认分镜顺序，files 包含 video-whole 和全部分镜。以此约定覆盖参考资料中的旧版仅分镜交付示例，不要把整片加入输入确认列表或内部 manifest.scenes。所有媒体使用 artifactRef 交给 Worker 替换服务 URL，不填写本地路径作为 url。'
      : '';
  return `按 ${path.join(toolkit, '.agents/skills/video-pipeline/SKILL.md')} 执行当前任务。\n任务入口：${task.entryFile}。\n读取入口引用的完整请求和输入资料，所有制作资料保存在当前任务目录。\n使用当前环境原生工具；长命令返回句柄时等待同一命令完成。\n按 references/task-io.md 写入结果，并在当前 turn 的结构化最终回复中引用该结果文件。${renderDelivery}`;
}
