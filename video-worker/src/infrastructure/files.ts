import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  readFile,
  realpath,
  open,
  rename,
  lstat,
  cp,
  readdir,
  chown,
} from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../domain/task.js';
export async function hashFile(file: string) {
  const h = createHash('sha256');
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest('hex');
}
export const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
export async function writeJson(file: string, value: any) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const h = await open(tmp, 'wx', 0o600);
  try {
    await h.writeFile(JSON.stringify(value, null, 2) + '\n');
    await h.sync();
  } finally {
    await h.close();
  }
  await rename(tmp, file);
}
export function within(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
export async function safeFile(root: string, relative: string) {
  if (path.isAbsolute(relative) || !within(root, path.resolve(root, relative)))
    throw new AppError('PATH_FORBIDDEN', '文件路径越界');
  const resolved = await realpath(path.join(root, relative));
  const resolvedRoot = await realpath(root);
  if (!within(resolvedRoot, resolved)) throw new AppError('PATH_FORBIDDEN', '文件链接越界');
  const st = await lstat(resolved);
  if (!st.isFile() || st.size === 0) throw new AppError('ASSET_UNAVAILABLE', '文件不存在或为空');
  return resolved;
}
export async function copyTree(source: string, dest: string) {
  // Session/cache trees are untrusted; never follow symlinks into another job or the host.
  await cp(source, dest, {
    recursive: true,
    dereference: false,
    filter: async (p) => !(await lstat(p)).isSymbolicLink(),
  });
}

export async function ownTree(root: string, uidSpec: string) {
  if (process.getuid?.() !== 0) return;
  const [uid, gid] = uidSpec.split(':').map(Number);
  if (!Number.isInteger(uid) || !Number.isInteger(gid))
    throw new Error('RUNNER_UID must be uid:gid');
  async function visit(file: string) {
    const st = await lstat(file);
    if (st.isSymbolicLink()) return;
    await chown(file, uid, gid);
    if (st.isDirectory())
      for (const child of await readdir(file)) await visit(path.join(file, child));
  }
  await visit(root);
}
