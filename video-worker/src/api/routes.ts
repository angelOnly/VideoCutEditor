import Fastify from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ZodError, z } from 'zod';
import type { Config, Tenant } from '../config.js';
import { AppError } from '../domain/task.js';
import { Tasks } from '../application/tasks.js';
import type { Database } from '../infrastructure/postgres.js';
import { TaskRepository } from '../infrastructure/task-repository.js';
import { CallbackOutbox } from '../infrastructure/callback-outbox.js';
export function createApi(db: Database, config: Config) {
  const api = Fastify({
    bodyLimit: 2 * 1024 * 1024,
    logger: { redact: ['req.headers.authorization'] },
  });
  const tasks = new Tasks(new TaskRepository(db), config);
  const tenants = new WeakMap<object, Tenant>();
  api.addHook('preHandler', async (req, reply) => {
    if (req.url === '/healthz') return;
    const header = req.headers.authorization ?? '';
    const hash = createHash('sha256').update(header).digest();
    const tenant = config.tenants.find((t) =>
      timingSafeEqual(
        hash,
        createHash('sha256')
          .update('Bearer ' + t.apiKey)
          .digest(),
      ),
    );
    if (!tenant) return reply.code(401).send({ status: 1, msg: 'UNAUTHORIZED' });
    tenants.set(req, tenant);
  });
  api.setErrorHandler((e: any, req, reply) => {
    if (e instanceof ZodError)
      return reply
        .code(400)
        .send({
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
  api.post('/ai_video_director/getAiVideoEditingAnalysisData', async (req, reply) => {
    const r = await tasks.analysis(tenants.get(req)!, req.body);
    return reply.code(202).send(r);
  });
  api.post('/ai_video_director/getAiVideoEditingData', async (req, reply) => {
    const r = await tasks.render(tenants.get(req)!, req.body);
    return reply.code(202).send(r);
  });
  api.get<{ Params: { taskId: string } }>('/ai_video_director/tasks/:taskId', async (req) => ({
    status: 0,
    msg: '',
    data: await tasks.repo.query(tenants.get(req)!.id, req.params.taskId),
  }));
  api.post<{ Params: { runId: string } }>('/ai_video_director/runs/:runId/cancel', async (req) => ({
    status: 0,
    msg: '',
    data: await tasks.repo.cancel(tenants.get(req)!.id, z.uuid().parse(req.params.runId)),
  }));
  api.post<{ Params: { eventId: string } }>(
    '/ai_video_director/callbacks/:eventId/retry',
    async (req, reply) => {
      const r = await new CallbackOutbox(db, config.tenants).retry(
        tenants.get(req)!.id,
        z.uuid().parse(req.params.eventId),
      );
      if (!r) return reply.code(409).send({ status: 1, msg: '事件不存在或不在 dead_letter 状态' });
      return { status: 0, msg: 'queued', data: r };
    },
  );
  return api;
}
