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
  return `按 ${path.join(toolkit, '.agents/skills/video-pipeline/SKILL.md')} 执行当前任务。\n任务入口：${task.entryFile}。\n读取入口引用的完整请求和输入资料，所有制作资料保存在当前任务目录。\n使用当前环境原生工具；长命令返回句柄时等待同一命令完成。\n按 references/task-io.md 写入结果，并在当前 turn 的结构化最终回复中引用该结果文件。`;
}
