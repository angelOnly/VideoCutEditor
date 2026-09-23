import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { z } from 'zod';
import type { Config } from '../config.js';
import { hashFile, safeFile } from './files.js';
import { AppError } from '../domain/task.js';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_COUNT = 512;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_DETAIL_BYTES = 64 * 1024;

const attachmentSchema = z.object({
  assetId: z.string(),
  url: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'reference', 'source', 'font']),
});
const customTemplateResponseSchema = z
  .object({
    code: z.number(),
    message: z.string(),
    data: z
      .object({
        id: z.number().int().positive(),
        name: z.string().optional().default(''),
        description: z
          .string()
          .nullable()
          .optional()
          .transform((v) => v ?? ''),
        package_name: z.string().min(1).max(512),
        package_url: z.string().url().max(4096),
        updated_at: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

type TemplateFile = { path: string; sha256: string; size: number };
export type FrozenTemplate = {
  id: string;
  version: string;
  content: string;
  attachments: z.infer<typeof attachmentSchema>[];
  source: 'custom_template_api' | 'local_zip';
  archiveSha256?: string;
  frozenPath?: string;
  rootDirectory?: string;
  document?: string;
  files?: TemplateFile[];
  name?: string;
  description?: string;
  updatedAt?: string;
  packageName?: string;
};

function templateError(code: 'TEMPLATE_UNAVAILABLE' | 'TEMPLATE_INVALID', message: string) {
  return new AppError(code, message);
}
function archiveNameError(name: string) {
  const invalid = yauzl.validateFileName(name);
  if (invalid) return invalid;
  if (!name || name.includes('\0')) return '归档路径为空或含空字符';
  const parts = name.replace(/\/$/, '').split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..'))
    return '归档路径不合法';
  return null;
}
function isIgnored(name: string) {
  const parts = name.replace(/\/$/, '').split('/');
  return parts.includes('__MACOSX') || parts.at(-1) === '.DS_Store';
}
function unixSpecialEntry(entry: Entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  return type !== 0 && type !== 0o100000 && type !== 0o040000;
}
async function openZip(file: string) {
  return new Promise<ZipFile>((resolve, reject) =>
    yauzl.open(
      file,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error ?? Error('无法读取 ZIP')) : resolve(zip)),
    ),
  );
}
async function entryStream(zip: ZipFile, entry: Entry) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error || !stream ? reject(error) : resolve(stream),
    ),
  );
}
async function freezeTree(root: string, files: TemplateFile[]) {
  for (const file of files) await chmod(path.join(root, file.path), 0o444);
  async function visit(directory: string): Promise<void> {
    for (const child of await readdir(directory, { withFileTypes: true }))
      if (child.isDirectory()) await visit(path.join(directory, child.name));
    await chmod(directory, 0o555);
  }
  await visit(root);
}
function documentStem(file: string) {
  return path.posix.basename(file, '.md').normalize('NFC');
}

function packageStem(file: string) {
  return path.posix.basename(file, path.posix.extname(file)).normalize('NFC');
}

async function extractArchive(
  archive: string,
  target: string,
  expectedDocument?: string,
  packageName?: string,
) {
  const archiveStat = await stat(archive);
  if (archiveStat.size <= 0 || archiveStat.size > MAX_ARCHIVE_BYTES)
    throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包大小不合法');
  const staging = `${target}.staging-${randomUUID()}`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { mode: 0o700 });
  const files: TemplateFile[] = [];
  const seen = new Set<string>();
  const roots = new Set<string>();
  let entries = 0;
  let expanded = 0;
  let zip: ZipFile | undefined;
  try {
    zip = await openZip(archive);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        zip!.close();
        reject(error);
      };
      zip!.once('error', (error) =>
        fail(templateError('TEMPLATE_INVALID', `模板压缩包无效：${error.message}`)),
      );
      zip!.on('entry', (entry: Entry) => {
        void (async () => {
          try {
            entries++;
            if (entries > MAX_ENTRY_COUNT)
              throw templateError('TEMPLATE_INVALID', '模板文件数量超限');
            const name = entry.fileName;
            const invalid = archiveNameError(name);
            if (invalid) throw templateError('TEMPLATE_INVALID', `模板归档路径无效：${invalid}`);
            if (unixSpecialEntry(entry))
              throw templateError('TEMPLATE_INVALID', '模板归档包含非普通文件');
            if (!isIgnored(name)) {
              if (seen.has(name)) throw templateError('TEMPLATE_INVALID', '模板归档包含重复路径');
              seen.add(name);
              const directory = name.endsWith('/');
              const parts = name.replace(/\/$/, '').split('/');
              if (!directory && parts.length < 2)
                throw templateError('TEMPLATE_INVALID', '模板文件必须位于单一根目录内');
              roots.add(parts[0]);
              if (!directory) {
                if (entry.uncompressedSize > MAX_ENTRY_BYTES)
                  throw templateError('TEMPLATE_INVALID', '模板单文件过大');
                expanded += entry.uncompressedSize;
                if (expanded > MAX_EXPANDED_BYTES)
                  throw templateError('TEMPLATE_INVALID', '模板解压后大小超限');
                const destination = path.join(staging, ...parts);
                await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
                const stream = await entryStream(zip!, entry);
                const output = await open(destination, 'wx', 0o600);
                let written = 0;
                try {
                  for await (const chunk of stream) {
                    written += chunk.length;
                    if (written > entry.uncompressedSize || written > MAX_ENTRY_BYTES)
                      throw templateError('TEMPLATE_INVALID', '模板文件实际大小异常');
                    if (typeof chunk === 'string') await output.write(chunk);
                    else await output.write(chunk);
                  }
                  await output.sync();
                } finally {
                  await output.close();
                }
                if (written !== entry.uncompressedSize)
                  throw templateError('TEMPLATE_INVALID', '模板文件大小校验失败');
                files.push({
                  path: parts.join('/'),
                  sha256: await hashFile(destination),
                  size: written,
                });
              }
            }
            if (!settled) zip!.readEntry();
          } catch (error) {
            fail(error);
          }
        })();
      });
      zip!.once('end', () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      zip!.readEntry();
    });
    if (roots.size !== 1 || !files.length)
      throw templateError('TEMPLATE_INVALID', '模板归档必须包含一个根目录和文件');
    const markdown = files.filter((file) => file.path.toLowerCase().endsWith('.md'));
    // 部分历史 ZIP 的中文文件名未按 UTF-8 标记；仅有一个 Markdown 时可安全回退到该入口。
    const packageDocument = packageName
      ? markdown.find((file) => documentStem(file.path) === packageStem(packageName))?.path
      : undefined;
    const document =
      (expectedDocument
        ? files.find((file) => file.path === expectedDocument)?.path
        : packageDocument) ?? (markdown.length === 1 ? markdown[0].path : undefined);
    if (!document) throw templateError('TEMPLATE_INVALID', '模板归档缺少唯一的 Markdown 入口文件');
    await freezeTree(staging, files);
    await rename(staging, target);
    const rootDirectory = [...roots][0];
    return {
      archiveSha256: await hashFile(archive),
      frozenPath: target,
      rootDirectory,
      document,
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
      content: await readFile(path.join(target, document), 'utf8'),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (error instanceof AppError) throw error;
    throw templateError(
      'TEMPLATE_INVALID',
      `模板压缩包无法解压：${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    zip?.close();
  }
}
async function readText(response: Response, limit: number) {
  const header = Number(response.headers.get('content-length'));
  if (Number.isFinite(header) && header > limit)
    throw templateError('TEMPLATE_UNAVAILABLE', '模板服务响应过大');
  if (!response.body) throw templateError('TEMPLATE_UNAVAILABLE', '模板服务响应为空');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw templateError('TEMPLATE_UNAVAILABLE', '模板服务响应过大');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
async function downloadArchive(url: URL, target: string) {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'error' });
  } catch {
    throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包下载失败');
  }
  if (!response.ok)
    throw templateError('TEMPLATE_UNAVAILABLE', `模板压缩包返回 ${response.status}`);
  const header = Number(response.headers.get('content-length'));
  if (Number.isFinite(header) && (header <= 0 || header > MAX_ARCHIVE_BYTES))
    throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包大小不合法');
  if (!response.body) throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包响应为空');
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const file = await open(target, 'wx', 0o600);
  let bytes = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_ARCHIVE_BYTES) {
        await reader.cancel();
        throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包大小超限');
      }
      await file.write(result.value);
    }
    if (!bytes) throw templateError('TEMPLATE_UNAVAILABLE', '模板压缩包为空');
    await file.sync();
  } finally {
    reader.releaseLock();
    await file.close();
  }
}

export class TemplateProvider {
  constructor(private config: Config) {}
  private packageUrl(url: string) {
    let packageUrl: URL;
    try {
      packageUrl = new URL(url);
    } catch {
      throw templateError('TEMPLATE_INVALID', '模板压缩包地址无效');
    }
    if (!['http:', 'https:'].includes(packageUrl.protocol))
      throw templateError('TEMPLATE_INVALID', '模板压缩包地址协议不支持');
    const allowed = new Set<string>(this.config.customTemplatePackageOrigins);
    allowed.add(new URL(this.config.customTemplateApiBaseUrl!).origin);
    if (!allowed.has(packageUrl.origin))
      throw templateError('TEMPLATE_INVALID', '模板压缩包地址不在允许来源内');
    return packageUrl;
  }
  private async custom(id: string, frozenPath: string): Promise<FrozenTemplate> {
    if (!/^[1-9]\d*$/.test(id))
      throw templateError('TEMPLATE_INVALID', '定制化模板 ID 必须为正整数');
    const endpoint = new URL(
      `/api/custom-templates/${encodeURIComponent(id)}`,
      this.config.customTemplateApiBaseUrl,
    );
    let response: Response;
    try {
      response = await fetch(endpoint, {
        signal: AbortSignal.timeout(15000),
        redirect: 'error',
        // 模板详情仍由平台鉴权；令牌只从受保护的部署配置读取。
        headers: this.config.customTemplateApiBearerToken
          ? { authorization: `Bearer ${this.config.customTemplateApiBearerToken}` }
          : undefined,
      });
    } catch {
      throw templateError('TEMPLATE_UNAVAILABLE', '定制化模板详情请求失败');
    }
    if (!response.ok)
      throw templateError('TEMPLATE_UNAVAILABLE', `定制化模板详情返回 ${response.status}`);
    let raw: unknown;
    try {
      raw = JSON.parse(await readText(response, MAX_DETAIL_BYTES));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw templateError('TEMPLATE_INVALID', '定制化模板详情不是有效 JSON');
    }
    const parsed = customTemplateResponseSchema.safeParse(raw);
    if (!parsed.success) throw templateError('TEMPLATE_INVALID', '定制化模板详情字段无效');
    if (parsed.data.code !== 0 || !parsed.data.data)
      throw templateError('TEMPLATE_UNAVAILABLE', '定制化模板详情返回业务失败');
    const detail = parsed.data.data;
    if (detail.id !== Number(id)) throw templateError('TEMPLATE_INVALID', '定制化模板 ID 不一致');
    const archive = `${frozenPath}.download-${randomUUID()}.zip`;
    try {
      const packageUrl = this.packageUrl(detail.package_url);
      await downloadArchive(packageUrl, archive);
      const extracted = await extractArchive(archive, frozenPath, undefined, detail.package_name);
      return {
        id,
        version: `sha256:${extracted.archiveSha256}`,
        source: 'custom_template_api',
        attachments: [],
        name: detail.name,
        description: detail.description,
        updatedAt: detail.updated_at,
        packageName: detail.package_name,
        ...extracted,
      };
    } finally {
      await rm(archive, { force: true });
    }
  }
  async read(id: string, frozenPath?: string): Promise<FrozenTemplate> {
    if (this.config.customTemplateApiBaseUrl) {
      if (!frozenPath) throw templateError('TEMPLATE_UNAVAILABLE', '缺少模板冻结目录');
      return this.custom(id, frozenPath);
    }
    const entry = this.config.templates[id];
    if (!entry) throw new AppError('TEMPLATE_UNAVAILABLE', '未配置模板文件');
    if (entry.archivePath) {
      if (!frozenPath) throw templateError('TEMPLATE_UNAVAILABLE', '缺少模板冻结目录');
      const archive = await safeFile(this.config.toolkitRoot, entry.archivePath);
      const extracted = await extractArchive(archive, frozenPath, entry.document);
      return {
        id,
        version: `sha256:${extracted.archiveSha256}`,
        source: 'local_zip',
        attachments: [],
        packageName: path.basename(entry.archivePath),
        ...extracted,
      };
    }
    throw new AppError('TEMPLATE_UNAVAILABLE', '模板必须显式配置 ZIP');
  }
}
