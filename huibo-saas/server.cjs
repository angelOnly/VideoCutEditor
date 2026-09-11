const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes, randomUUID, timingSafeEqual, createHash} = require('node:crypto');
const {ApiError, ORIGIN, ENDPOINTS, signedURL, videoPayload, pricePayload, costTotals, checkLimits, unwrap} = require('./core.cjs');

function atomic(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2), {mode: 0o600});
  fs.renameSync(file + '.tmp', file);
}
class Huibo {
  constructor(directory) { this.directory = directory; this.context = null; this.opening = null; }
  async open() {
    if (this.context) return {open: true};
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const {chromium} = require('playwright');
      // Dedicated profile: never read or copy the user's everyday Chrome profile.
      const context = await chromium.launchPersistentContext(path.join(this.directory, 'browser-profile'), {
        channel: 'chrome', headless: false, chromiumSandbox: true, timeout: 20000,
        viewport: {width: 1440, height: 1000}, acceptDownloads: false,
      });
      this.context = context;
      context.on('close', () => { if (this.context === context) this.context = null; });
      const page = context.pages()[0] || await context.newPage();
      await page.goto(ORIGIN + '/video#/character?platform=video&figure_tab=personal', {waitUntil: 'domcontentloaded', timeout: 20000});
      return {open: true, instruction: '请在新打开的一镜专用 Chrome 窗口中登录；无需提供密码或 Cookie 给此服务。'};
    })().finally(() => { this.opening = null; });
    return this.opening;
  }
  async call(endpoint, payload) {
    if (!this.context) throw new ApiError(503, 'LOGIN_REQUIRED', '先调用 POST /session/open，在专用浏览器中登录');
    const body = JSON.stringify(payload);
    let response;
    try {
      response = await this.context.request.post(signedURL(endpoint, body), {
        data: body, headers: {'Content-Type': 'application/json; charset=utf-8',
          'hbx-platform-type-header': '1', 'hbx-platform-version-header': '2',
          Origin: ORIGIN, Referer: ORIGIN + '/video'},
        timeout: 20000, maxRedirects: 0, maxRetries: 0,
      });
      if (response.status() !== 200) throw new ApiError(502, 'UPSTREAM_HTTP', `一镜返回 HTTP ${response.status()}，请检查登录状态`);
      const json = await response.json();
      return unwrap(json);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      // Playwright errors can contain signed URLs and headers. Do not expose them.
      throw new ApiError(502, 'UPSTREAM_UNCERTAIN', '一镜请求失败或响应无法解析；生成请求不可直接重试，请先核对视频作品');
    } finally { if (response) await response.dispose(); }
  }
  async close() { await this.context?.close(); }
}

class Service {
  constructor(directory, upstream) {
    this.directory = directory;
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    this.upstream = upstream;
    this.stateFile = path.join(directory, 'state.json');
    this.state = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : {quotes: {}, jobs: {}};
    for (const job of Object.values(this.state.jobs)) {
      if (['queued', 'pricing'].includes(job.status)) { job.status = 'interrupted'; job.error = '服务重启发生在提交前，没有自动重试'; }
      if (job.status === 'submitting') { job.status = 'unknown'; job.error = '服务在提交期间重启，请核对一镜视频作品，勿重复生成'; }
    }
    this.save();
    this.busy = false;
    this.polling = false;
  }
  save() { atomic(this.stateFile, this.state); }
  async avatars(screen = '9:16', page = 1) {
    if (!['9:16', '16:9'].includes(screen) || !Number.isInteger(page) || page < 1) throw new ApiError(400, 'INVALID_INPUT', 'screen 或 page 无效');
    return this.upstream.call(ENDPOINTS.avatars, {page: String(page), rn: '10', order_type: '1', gender: 0, posture: 0, target_audience: 0, screen: screen === '9:16' ? 0 : 1});
  }
  async quote(input) {
    const payload = videoPayload(input);
    const cost = await this.upstream.call(ENDPOINTS.price, pricePayload(payload));
    const totals = costTotals(cost);
    const quote = {id: randomUUID(), created_at: Date.now(), payload, cost, totals};
    this.state.quotes[quote.id] = quote;
    this.save();
    return {quote_id: quote.id, expires_at: quote.created_at + 300000, ...totals, cost,
      avatar_id: payload.vis_figure_id, title: payload.task_list[0].title, text: payload.task_list[0].generate_script};
  }
  enqueue(input, key) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['quote_id', 'max_coins', 'max_quota'].includes(k))) throw new ApiError(400, 'INVALID_INPUT', '请求参数错误');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new ApiError(400, 'IDEMPOTENCY_REQUIRED', '必须提供 8–128 字符的 Idempotency-Key');
    const hash = createHash('sha256').update(JSON.stringify([input.quote_id, input.max_coins, input.max_quota])).digest('hex');
    const existing = Object.values(this.state.jobs).find(job => job.key === key);
    if (existing) {
      if (existing.hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', '同一个 Idempotency-Key 不能对应不同参数');
      return this.publicJob(existing);
    }
    const quote = this.state.quotes[input.quote_id];
    if (!quote || Date.now() - quote.created_at > 300000) throw new ApiError(400, 'QUOTE_EXPIRED', '报价不存在或已超过 5 分钟，请重新估价');
    if (Object.values(this.state.jobs).some(job => job.quote_id === quote.id)) throw new ApiError(409, 'QUOTE_USED', '这个报价已创建任务，请查询原任务');
    checkLimits(quote.cost, input);
    if (Object.values(this.state.jobs).filter(job => ['queued', 'pricing', 'submitting'].includes(job.status)).length >= 10) throw new ApiError(429, 'QUEUE_FULL', '待提交任务已达 10 个');
    const job = {id: randomUUID(), key, hash, quote_id: quote.id, limits: {max_coins: input.max_coins, max_quota: input.max_quota}, status: 'queued', created_at: Date.now()};
    this.state.jobs[job.id] = job;
    this.save();
    setImmediate(() => this.drain().catch(() => {}));
    return this.publicJob(job);
  }
  publicJob(job) {
    const {key, hash, limits, ...publicFields} = job;
    return {...publicFields, status_url: '/tasks/' + job.id};
  }
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      let job;
      while ((job = Object.values(this.state.jobs).find(j => j.status === 'queued'))) {
        try {
          const quote = this.state.quotes[job.quote_id];
          job.status = 'pricing'; this.save();
          const cost = await this.upstream.call(ENDPOINTS.price, pricePayload(quote.payload));
          checkLimits(cost, job.limits);
          job.cost = cost;
          // Durable uncertainty marker BEFORE the paid request. No automatic re-submission.
          job.status = 'submitting'; this.save();
          const result = await this.upstream.call(ENDPOINTS.make + '?video_type=2', {...quote.payload, cost});
          const ids = result.task_ids;
          if (!Array.isArray(ids) || ids.length !== 1 || !ids.every(id => /^\d+$/.test(String(id)) && Number.isSafeInteger(Number(id)))) throw new ApiError(502, 'TASK_IDS_MISSING', '生成响应缺少预期 task_ids，请在一镜视频作品核对');
          job.upstream_ids = ids;
          job.status = 'submitted';
        } catch (error) {
          job.error = error instanceof ApiError ? error.message : '本地处理失败';
          job.status = job.status === 'submitting' ? 'unknown' : 'failed';
        }
        this.save();
      }
    } finally { this.busy = false; }
  }
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      const jobs = Object.values(this.state.jobs).filter(j => ['submitted', 'running'].includes(j.status));
      if (!jobs.length) return;
      for (const job of jobs) {
        try {
          const result = await this.upstream.call(ENDPOINTS.query, {ids: job.upstream_ids.map(Number), version: 4});
          const record = result.list?.find(item => String(item.id) === String(job.upstream_ids[0]));
          if (!record) throw new Error('task not present');
          job.upstream = record;
          job.last_checked_at = Date.now();
          delete job.poll_error;
          if ([6, 7].includes(Number(record.status))) {
            job.status = 'succeeded';
            job.video_url = record.subtitled_video_url || null;
          } else if ([-1, 101, 102, 103].includes(Number(record.status))) job.status = 'failed';
          else job.status = 'running';
        } catch (error) {
          job.poll_error = error instanceof ApiError ? error.message : '任务尚未出现在查询结果中';
        }
        this.save();
      }
    } finally { this.polling = false; }
  }
}

function createServer(service, apiKey) {
  const reply = (res, status, data) => {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, {ok: true, integration: 'awaiting_live_validation'});
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + apiKey);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new ApiError(401, 'UNAUTHORIZED', '需要 Bearer API Key');
      let body = {};
      if (req.method === 'POST') {
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new ApiError(415, 'CONTENT_TYPE', '使用 application/json');
        let size = 0; const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw new ApiError(413, 'BODY_TOO_LARGE', '请求体不能超过 64 KB');
          chunks.push(chunk);
        }
        try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); }
        catch { throw new ApiError(400, 'INVALID_JSON', 'JSON 格式错误'); }
      }
      const route = req.method + ' ' + url.pathname;
      if (route === 'POST /session/open') return reply(res, 200, await service.upstream.open());
      if (route === 'GET /session') {
        try { const data = await service.avatars(); return reply(res, 200, {ready: true, avatar_count_on_page: data.list?.length ?? null}); }
        catch (error) { return reply(res, 200, {ready: false, code: error.code || 'SESSION_FAILED', message: error.message}); }
      }
      if (route === 'GET /avatars') return reply(res, 200, await service.avatars(url.searchParams.get('screen') || '9:16', Number(url.searchParams.get('page') || 1)));
      if (route === 'POST /quotes') return reply(res, 200, await service.quote(body));
      if (route === 'POST /videos') return reply(res, 202, service.enqueue(body, req.headers['idempotency-key']));
      if (req.method === 'GET' && url.pathname.startsWith('/tasks/')) {
        const job = service.state.jobs[url.pathname.slice(7)];
        if (job) return reply(res, 200, service.publicJob(job));
      }
      throw new ApiError(404, 'NOT_FOUND', '接口不存在');
    } catch (error) {
      reply(res, error instanceof ApiError ? error.status : 500, {error: error.code || 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : '本地服务失败，请查看服务状态'});
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  return server;
}

async function main() {
  process.umask(0o077);
  const directory = path.join(__dirname, '.data');
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const keyFile = path.join(directory, 'api-key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, randomBytes(32).toString('hex'), {mode: 0o600});
  const upstream = new Huibo(directory);
  const service = new Service(directory, upstream);
  const server = createServer(service, fs.readFileSync(keyFile, 'utf8').trim());
  const port = Number(process.env.HUIBO_PORT || 8788);
  server.on('error', error => { console.error('服务无法启动：' + error.code); process.exit(1); });
  server.listen(port, '127.0.0.1', () => console.log(`一镜 SaaS 本地 API：http://127.0.0.1:${port}；密钥保存在 .data/api-key`));
  const timer = setInterval(() => service.poll().catch(() => {}), 15000);
  if (process.argv.includes('--login')) {
    try { console.log(await upstream.open()); }
    catch { console.error('专用浏览器未成功打开，可用 client.cjs POST /session/open 重试。'); }
  }
  const stop = async () => { clearInterval(timer); server.close(); await upstream.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (require.main === module) main().catch(() => { console.error('启动失败'); process.exit(1); });
module.exports = {Service, Huibo, createServer};
