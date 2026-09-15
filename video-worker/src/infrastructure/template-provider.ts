import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Config } from '../config.js';
import { safeFile } from './files.js';
import { AppError } from '../domain/task.js';
const templateSchema = z.object({
  id: z.string(),
  version: z.string().min(1),
  content: z.string().min(1),
  attachments: z
    .array(
      z.object({
        assetId: z.string(),
        url: z.string(),
        kind: z.enum(['image', 'video', 'audio', 'reference', 'source', 'font']),
      }),
    )
    .default([]),
});
export class TemplateProvider {
  constructor(private config: Config) {}
  async read(id: string) {
    if (this.config.templateApiUrl) {
      const url = new URL(this.config.templateApiUrl);
      url.searchParams.set('templateId', id);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok)
        throw new AppError('TEMPLATE_UNAVAILABLE', `模板接口返回 ${response.status}`);
      const value = templateSchema.parse(await response.json());
      if (value.id !== id) throw new AppError('TEMPLATE_MISMATCH', '模板 ID 不一致');
      return { ...value, source: 'api' };
    }
    const entry = this.config.templates[id];
    if (!entry) throw new AppError('TEMPLATE_UNAVAILABLE', '未配置模板文件');
    let relative = entry.path;
    if ((await stat(path.join(this.config.toolkitRoot, relative))).isDirectory())
      relative += '/README.md';
    const file = await safeFile(this.config.toolkitRoot, relative);
    return {
      ...templateSchema.parse({
        id,
        version: entry.version,
        content: await readFile(file, 'utf8'),
        attachments: entry.attachments ?? [],
      }),
      source: 'fixture',
    };
  }
}
