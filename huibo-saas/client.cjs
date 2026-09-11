const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const [method = 'GET', route = '/session', file, key] = process.argv.slice(2);
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('使用本地 API 路径');
  const token = fs.readFileSync(path.join(__dirname, '.data/api-key'), 'utf8').trim();
  const response = await fetch(`http://127.0.0.1:${process.env.HUIBO_PORT || 8788}${route}`, {
    method, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(key ? {'Idempotency-Key': key} : {})},
    body: method === 'POST' ? (file ? fs.readFileSync(file, 'utf8') : '{}') : undefined,
    signal: AbortSignal.timeout(45000),
  });
  console.log(JSON.stringify(await response.json(), null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
