// Development receiver only: logs callbacks and acknowledges them, without HMAC verification.
import { createServer } from 'node:http';
const paths = new Set([
  '/ai_video_director/getAiVideoEditingAnalysisDataCallback',
  '/ai_video_director/getAiVideoEditingDataCallback',
]);
createServer(async (req, res) => {
  const reply = (statusCode, status, msg) => {
    res.writeHead(statusCode, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status, msg }));
  };
  if (req.method !== 'POST' || !paths.has(req.url)) return reply(404, 1, 'not found');
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) return reply(413, 1, 'body too large');
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    console.log(JSON.stringify({ path: req.url, eventId: req.headers['x-event-id'], body }));
    reply(200, 0, 'test received');
  } catch {
    reply(400, 1, 'invalid request');
  }
}).listen(Number(process.env.PORT ?? 9000), '0.0.0.0');
