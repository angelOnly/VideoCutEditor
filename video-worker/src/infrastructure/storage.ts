import { mkdir, copyFile, rename, open, stat, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config, Tenant } from '../config.js';
import { hashFile, safeFile, within } from './files.js';
import { AppError } from '../domain/task.js';
export class Storage {
  constructor(private config: Config) {}
  async input(tenant: Tenant, url: string) {
    if (!within(tenant.inputRoot, url))
      throw new AppError('PATH_FORBIDDEN', '素材必须位于调用方媒体根目录');
    const relative = path.relative(tenant.inputRoot, url);
    if (!tenant.allowedInputPrefixes.some((p) => within(p, relative)))
      throw new AppError('PATH_FORBIDDEN', '素材目录未授权');
    let file: string;
    try {
      file = await safeFile(this.config.mediaRoot, relative);
    } catch (e: any) {
      if (['ENOENT', 'EACCES', 'EPERM'].includes(e.code))
        throw new AppError('ASSET_UNAVAILABLE', '素材文件不存在或不可读取');
      throw e;
    }
    const actual = path.relative(
      await (await import('node:fs/promises')).realpath(this.config.mediaRoot),
      file,
    );
    if (!tenant.allowedInputPrefixes.some((p) => within(p, actual)))
      throw new AppError('PATH_FORBIDDEN', '素材链接指向未授权目录');
    return { file, relative };
  }
  export(tenant: Tenant, key: string) {
    if (!within(this.config.mediaRoot, path.join(this.config.mediaRoot, key)))
      throw new AppError('PATH_FORBIDDEN', '结果路径越界');
    // 缺少服务地址时阻止交付，避免再次向客户端返回服务器磁盘路径。
    if (!this.config.mediaPublicBaseUrl)
      throw new AppError(
        'MEDIA_URL_NOT_CONFIGURED',
        '请配置 Worker 服务地址 MEDIA_PUBLIC_BASE_URL',
      );
    const base = new URL(this.config.mediaPublicBaseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      ['localhost', '127.0.0.1', '[::1]', '0.0.0.0', '[::]'].includes(base.hostname)
    )
      throw new AppError('MEDIA_URL_INVALID', '媒体地址必须是客户端可访问的 Worker HTTP 服务地址');
    return new URL(`media/${key}`, base.toString().replace(/\/$/, '') + '/').toString();
  }
  async publish(
    tenant: Tenant,
    taskKey: string,
    runId: string,
    token: number,
    sceneId: string,
    source: string,
    extension = '.mp4',
  ) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(sceneId) || !/^\.[a-zA-Z0-9]+$/.test(extension))
      throw new AppError('PATH_FORBIDDEN', '发布文件名无效');
    const key = path.posix.join(
      'tasks',
      taskKey,
      'results',
      `${runId}-${token}`,
      `${sceneId}${extension}`,
    );
    const target = path.join(this.config.mediaRoot, key);
    const url = this.export(tenant, key);
    await mkdir(path.dirname(target), { recursive: true });
    const tmp = target + '.' + randomUUID() + '.tmp';
    await copyFile(source, tmp);
    const h = await open(tmp, 'r');
    await h.sync();
    await h.close();
    const sha256 = await hashFile(tmp);
    if (sha256 !== (await hashFile(source)))
      throw new AppError('PUBLISH_HASH_MISMATCH', '文件复制校验失败');
    await chmod(tmp, 0o444);
    await rename(tmp, target);
    const dir = await open(path.dirname(target), 'r');
    await dir.sync();
    await dir.close();
    return { key, url, sha256, sizeBytes: (await stat(target)).size };
  }
}
