import Fastify from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { ZodError, z } from 'zod';
import type { Config, Tenant } from '../config.js';
import { AppError } from '../domain/task.js';
import { Tasks } from '../application/tasks.js';
import type { Database } from '../infrastructure/postgres.js';
import { TaskRepository } from '../infrastructure/task-repository.js';
import { CallbackOutbox } from '../infrastructure/callback-outbox.js';
import { safeFile } from '../infrastructure/files.js';
export function createApi(db: Database, config: Config) {
  const api = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger: {},
  });
  const tasks = new Tasks(new TaskRepository(db), config);
  // 联调模式固定使用唯一租户；租户配置仍负责目录隔离和回调签名。
  const tenant: Tenant = config.tenants[0]!;
  api.setErrorHandler((e: any, req, reply) => {
    if (e instanceof ZodError)
      return reply.code(400).send({
        status: 1,
        msg: 'INVALID_REQUEST',
        error: {
          code: 'INVALID_REQUEST',
          issues: e.issues.map((i) => ({ path: i.path, message: i.message })),
        },
      });
    if (e instanceof AppError)
      return reply
        .code(e.httpStatus)
        .send({ status: 1, msg: e.message, error: { code: e.code, retryable: e.retryable } });
    req.log.error(e);
    return reply
      .code(e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500)
      .send({ status: 1, msg: 'REQUEST_FAILED' });
  });
  api.get('/healthz', async () => {
    await db.query('SELECT 1');
    return { status: 0 };
  });
  // 仅暴露 Worker 已发布的媒体根；safeFile 同时拒绝穿越和符号链接越界。
  api.get<{ Params: { '*': string } }>('/media/*', async (req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    const key = req.params['*'];
    // 只开放发布结果，输入素材、临时文件不作为媒体接口暴露。
    if (!/^tasks\/[^/]+\/results\/[^/]+\/[^/]+\.[a-zA-Z0-9]+$/.test(key))
      return reply.code(404).send();
    let file: string;
    try {
      file = await safeFile(config.mediaRoot, key);
    } catch (error: any) {
      if (['ENOENT', 'ENOTDIR', 'PATH_FORBIDDEN', 'ASSET_UNAVAILABLE'].includes(error.code))
        return reply.code(404).send();
      throw error;
    }
    const { size } = await stat(file);
    const type = file.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream';
    reply.type(type).header('Accept-Ranges', 'bytes');
    const range = req.method === 'GET' ? req.headers.range : undefined;
    // 播放器使用单段 Range 拖动；多段或无法识别的 Range 忽略并返回完整文件。
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2]) && !req.headers['if-range']) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      )
        return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1)
        .send(createReadStream(file, { start, end }));
    }
    reply.header('Content-Length', size);
    // Fastify 的 HEAD 处理会丢弃流正文，同时保留真实 Content-Length。
    return reply.send(createReadStream(file));
  });
  api.options('/media/*', async (_req, reply) =>
    reply
      .code(204)
      .header('Access-Control-Allow-Origin', '*')
      .header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
      .header('Access-Control-Allow-Headers', 'Range, If-Range')
      .send(),
  );
  api.post('/narrate/ai_video_director/getAiVideoEditingAnalysisData', async (req, reply) => {
    const r = await tasks.analysis(tenant, req.body);
    return reply.code(202).send(r);
  });
  api.post('/narrate/ai_video_director/getAiVideoEditingData', async (req, reply) => {
    const r = await tasks.render(tenant, req.body);
    return reply.code(202).send(r);
  });
  api.get<{ Params: { taskId: string } }>('/ai_video_director/tasks/:taskId', async (req) => ({
    status: 0,
    msg: '',
    data: await tasks.repo.query(tenant.id, req.params.taskId),
  }));
  api.post<{ Params: { runId: string } }>('/ai_video_director/runs/:runId/cancel', async (req) => ({
    status: 0,
    msg: '',
    data: await tasks.repo.cancel(tenant.id, z.uuid().parse(req.params.runId)),
  }));
  api.post<{ Params: { eventId: string } }>(
    '/ai_video_director/callbacks/:eventId/retry',
    async (req, reply) => {
      const r = await new CallbackOutbox(db, config.tenants).retry(
        tenant.id,
        z.uuid().parse(req.params.eventId),
      );
      if (!r) return reply.code(409).send({ status: 1, msg: '事件不存在或不在 dead_letter 状态' });
      return { status: 0, msg: 'queued', data: r };
    },
  );
  return api;
}
