const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {signedURL, ENDPOINTS, videoPayload, checkLimits} = require('./core.cjs');
const {Service, createServer} = require('./server.cjs');

const input = {text: '这是测试文案。', avatar_id: 'example-avatar', voice: {tts_mid: 'example-voice', tts_speed: 5}};
const cost = {cost_total: {coin_total: 0, quota: 1, duration: 3}, cost_breakdown: []};
function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'huibo-test-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const calls = [];
  const upstream = {async call(endpoint, payload) {
    calls.push({endpoint, payload});
    if (endpoint === ENDPOINTS.price) return overrides.price ? overrides.price() : cost;
    if (endpoint.startsWith(ENDPOINTS.make)) {
      if (overrides.make) return overrides.make();
      return {task_ids: [123]};
    }
    if (endpoint === ENDPOINTS.query) return {list: [{id: 123, status: 6, subtitled_video_url: 'https://example.com/test.mp4'}]};
    return {list: []};
  }};
  return {service: new Service(directory, upstream), calls, directory, upstream};
}
test('plain text is kept as data and video is talk mode with watermark', () => {
  const payload = videoPayload({...input, text: '引号 " \\ <script> $(echo hello)'});
  assert.equal(payload.video_type, 2);
  assert.equal(payload.need_watermark, 1);
  assert.equal(payload.task_list[0].generate_script, '引号 " \\ <script> $(echo hello)');
  assert.throws(() => videoPayload({...input, text: ''}));
  assert.throws(() => videoPayload({...input, url: 'http://evil.test'}));
});
test('signed URLs preserve frontend query conventions and reject other destinations', () => {
  const url = new URL(signedURL(ENDPOINTS.make + '?video_type=2', '{}', 1700000000));
  assert.equal(url.origin, 'https://huibo.baidu.com');
  assert.equal(url.searchParams.get('timestamp'), '1700000000');
  assert.deepEqual(url.searchParams.getAll('video_type'), ['2', '2']);
  assert.match(url.searchParams.get('sign'), /^[a-f0-9]{32}$/);
  assert.notEqual(url.searchParams.get('sign'), new URL(signedURL(ENDPOINTS.make + '?video_type=2', '{"x":1}', 1700000000)).searchParams.get('sign'));
  assert.throws(() => signedURL('https://evil.test/path', '{}'));
});
test('unknown or excessive cost fails closed', () => {
  assert.throws(() => checkLimits({}, {max_coins: 0, max_quota: 1}));
  assert.throws(() => checkLimits(cost, {max_coins: 0, max_quota: 0}));
  assert.throws(() => checkLimits(cost, {max_coins: NaN, max_quota: 1}));
});
test('same idempotency key submits once; changed request and reused quote fail', async t => {
  const {service, calls} = fixture(t);
  const quote = await service.quote(input);
  const request = {quote_id: quote.quote_id, max_coins: 0, max_quota: 1};
  const first = service.enqueue(request, 'test-key-123');
  assert.equal(service.enqueue(request, 'test-key-123').id, first.id);
  assert.throws(() => service.enqueue({...request, max_coins: 2}, 'test-key-123'));
  assert.throws(() => service.enqueue(request, 'test-key-456'));
  await service.drain();
  assert.equal(calls.filter(c => c.endpoint.startsWith(ENDPOINTS.make)).length, 1);
  await service.poll();
  assert.equal(service.state.jobs[first.id].status, 'succeeded');
  assert.equal(service.state.jobs[first.id].video_url, 'https://example.com/test.mp4');
});
test('price increases before submit block the paid request', async t => {
  let count = 0;
  const {service, calls} = fixture(t, {price: () => ++count === 1 ? cost : {cost_total: {coin_total: 10, quota: 1}}});
  const quote = await service.quote(input);
  const job = service.enqueue({quote_id: quote.quote_id, max_coins: 0, max_quota: 1}, 'cost-change-123');
  await service.drain();
  assert.equal(service.state.jobs[job.id].status, 'failed');
  assert.equal(calls.filter(c => c.endpoint.startsWith(ENDPOINTS.make)).length, 0);
});
test('ambiguous submission remains unknown across restart, no duplicate', async t => {
  const {service, calls, directory, upstream} = fixture(t, {make: () => { throw new Error('lost response'); }});
  const quote = await service.quote(input);
  const request = {quote_id: quote.quote_id, max_coins: 0, max_quota: 1};
  const job = service.enqueue(request, 'unknown-123');
  await service.drain();
  assert.equal(service.state.jobs[job.id].status, 'unknown');
  const recovered = new Service(directory, upstream);
  assert.equal(recovered.enqueue(request, 'unknown-123').status, 'unknown');
  await recovered.drain();
  assert.equal(calls.filter(c => c.endpoint.startsWith(ENDPOINTS.make)).length, 1);
});
test('HTTP auth, validation and async response', async t => {
  const {service} = fixture(t);
  const server = createServer(service, 'test-secret');
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/avatars')).status, 401);
  const headers = {Authorization: 'Bearer test-secret', 'Content-Type': 'application/json'};
  assert.equal((await fetch(base + '/quotes', {method: 'POST', headers, body: '{bad'})).status, 400);
  const quoteResponse = await fetch(base + '/quotes', {method: 'POST', headers, body: JSON.stringify(input)});
  const quote = await quoteResponse.json();
  const result = await fetch(base + '/videos', {method: 'POST', headers: {...headers, 'Idempotency-Key': 'http-test-123'}, body: JSON.stringify({quote_id: quote.quote_id, max_coins: 0, max_quota: 1})});
  assert.equal(result.status, 202);
  const job = await result.json();
  assert.match(job.status_url, /^\/tasks\//);
  await service.drain();
});
