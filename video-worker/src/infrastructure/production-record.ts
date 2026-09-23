import path from 'node:path';
import { copyFile, mkdir, stat, chmod, rm } from 'node:fs/promises';
import { AppError, type Lease } from '../domain/task.js';
import type { Workspace } from './workspace.js';
import { hashFile, safeFile } from './files.js';
// 只交接显式文件。交接目录位于模型可写任务目录之外，供上传重试使用。
export async function productionRecord(w: Workspace, l: Lease, outcome: any) {
  const root = path.join(path.dirname(w.root), 'deliveries', l.run.id, String(l.token));
  await mkdir(root, { recursive: true });
  const files = [];
  for (const item of outcome.files) {
    const source = await safeFile(w.root, item.path);
    const extension = path.extname(source) || '.bin';
    if (!/^\.[a-zA-Z0-9]+$/.test(extension))
      throw new AppError('RESULT_PROTOCOL_INVALID', '文件扩展名无效');
    const destination = path.join(root, item.id + extension);
    const before = await stat(source);
    const hash = await hashFile(source);
    await copyFile(source, destination);
    const after = await stat(source);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.ino !== after.ino ||
      hash !== (await hashFile(destination)) ||
      hash !== (await hashFile(source))
    ) {
      await rm(destination, { force: true });
      throw new AppError('FILE_HANDOFF_FAILED', '文件交接期间发生变化，请停止写入后重新提交');
    }
    await chmod(destination, 0o400);
    files.push({ ...item, source: destination, sha256: hash, extension });
  }
  return { outcome, files };
}
