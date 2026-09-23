import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
const tenantSchema = z.object({
  id: z.string().min(1),
  inputRoot: z.string(),
  exportRoot: z.string(),
  allowedInputPrefixes: z.array(z.string()).min(1),
  callbackBaseUrl: z.string().url(),
  callbackSecret: z.string().min(16),
});
export type Tenant = z.infer<typeof tenantSchema>;
export interface Config {
  executor: 'host';
  executionProtocol?: 'video-pipeline-io/1' | 'video-two-stage/1';
  customTemplateApiBaseUrl?: string;
  customTemplatePackageOrigins: string[];
  codexPath: string;
  codexHome: string;
  hostBrowser: string;
  hostMemory: string;
  hostCpus: number;
  hostTasksMax: number;
  databaseUrl: string;
  port: number;
  mediaRoot: string;
  dataRoot: string;
  toolkitRoot: string;
  tenants: Tenant[];
  leaseSeconds: number;
  timeoutSeconds: number;
  maxAttempts: number;
  hostFingerprint?: string;
  codexModel?: string;
  codexReasoningEffort?:
    'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | 'persistent';
  codexBaseUrl?: string;
  ttsVoice: string;
  ttsVoices?: Record<string, string>;
  ttsResourceId: string;
  python: string;
  templates: Record<
    string,
    {
      path?: string;
      version?: string;
      archivePath?: string;
      document?: string;
      attachments?: { assetId: string; url: string; kind: string }[];
    }
  >;
  runtimeVersion: string;
}
export function loadConfig(envFile = path.resolve(serviceRoot, '../.env')): Config {
  // Compose injects the same root file. Direct Node entrypoints load it here;
  // explicit process/container environment always takes precedence.
  if (existsSync(envFile)) loadEnvFile(envFile);
  const mediaRoot = process.env.MEDIA_ROOT ?? '/home/ops/jiangzb/videos';
  const tenants = z
    .array(tenantSchema)
    .min(1)
    .parse(
      process.env.TENANTS_FILE
        ? JSON.parse(readFileSync(process.env.TENANTS_FILE, 'utf8'))
        : [
            {
              id: process.env.IFENG_TENANT_ID ?? 'ifeng',
              inputRoot: process.env.IFENG_INPUT_ROOT || mediaRoot,
              exportRoot: process.env.IFENG_EXPORT_ROOT || mediaRoot,
              allowedInputPrefixes: (process.env.IFENG_ALLOWED_INPUT_PREFIXES ?? 'input')
                .split(',')
                .map((p) => p.trim())
                .filter(Boolean),
              callbackBaseUrl: process.env.IFENG_CALLBACK_BASE_URL,
              callbackSecret: process.env.IFENG_CALLBACK_SECRET,
            },
          ],
    );
  if (tenants.length !== 1) throw Error('无鉴权模式仅支持一个租户');
  if (new Set(tenants.map((t) => t.id)).size !== tenants.length) throw Error('Duplicate tenant id');
  const templates = JSON.parse(
    readFileSync(path.join(serviceRoot, 'config/templates.json'), 'utf8'),
  );
  const databaseUrl =
    process.env.DATABASE_URL ||
    (process.env.POSTGRES_PASSWORD
      ? `postgresql://videocut:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}@127.0.0.1:${z.coerce
          .number()
          .int()
          .min(1)
          .max(65535)
          .parse(process.env.POSTGRES_HOST_PORT ?? 15432)}/videocut`
      : undefined);
  if (!databaseUrl) throw Error('DATABASE_URL or POSTGRES_PASSWORD is required');
  const hostRuntimeFile = path.join(serviceRoot, 'config/host-runtime.json');
  const hostRuntime = existsSync(hostRuntimeFile)
    ? JSON.parse(readFileSync(hostRuntimeFile, 'utf8'))
    : {};
  if (process.env.TEMPLATE_API_URL)
    throw Error('TEMPLATE_API_URL 已停用，请配置定制 ZIP 服务或本地 ZIP');
  return {
    executionProtocol: z
      .enum(['video-pipeline-io/1', 'video-two-stage/1'])
      .transform(() => 'video-pipeline-io/1' as const)
      .parse(process.env.WORKER_PROTOCOL ?? 'video-pipeline-io/1'),
    customTemplateApiBaseUrl: process.env.CUSTOM_TEMPLATE_API_BASE_URL || undefined,
    customTemplatePackageOrigins: (process.env.CUSTOM_TEMPLATE_PACKAGE_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(z.string().url().parse(origin)).origin),
    hostBrowser:
      process.env.REMOTION_BROWSER_EXECUTABLE || hostRuntime.browser || '/usr/bin/chromium',
    executor: z.literal('host').parse(process.env.WORKER_EXECUTOR ?? 'host'),
    codexPath: process.env.CODEX_PATH || path.join(serviceRoot, 'node_modules/.bin/codex'),
    codexHome: process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    hostMemory: z
      .string()
      .regex(/^\d+[MG]$/)
      .parse(process.env.HOST_TASK_MEMORY ?? '4G'),
    hostCpus: z.coerce
      .number()
      .positive()
      .max(64)
      .parse(process.env.HOST_TASK_CPUS ?? 2),
    hostTasksMax: z.coerce
      .number()
      .int()
      .min(32)
      .max(4096)
      .parse(process.env.HOST_TASK_PIDS ?? 256),
    databaseUrl,
    port: Number(process.env.PORT ?? 8080),
    mediaRoot,
    dataRoot: process.env.DATA_ROOT ?? '/home/ops/jiangzb/video-worker-data',
    toolkitRoot:
      process.env.TOOLKIT_ROOT ?? path.resolve(serviceRoot, '../claude-code-video-toolkit'),
    tenants,
    leaseSeconds: 60,
    timeoutSeconds: 14400,
    maxAttempts: 3,
    codexModel: process.env.CODEX_MODEL || undefined,
    codexReasoningEffort: z
      .enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'])
      .optional()
      .parse(process.env.CODEX_REASONING_EFFORT || undefined),
    codexBaseUrl: process.env.CODEX_BASE_URL || undefined,
    ttsVoice:
      process.env.TTS_VOICE || process.env.DOUBAO_TTS_SPEAKER || 'zh_female_xiaohe_uranus_bigtts',
    ttsVoices: process.env.TTS_VOICES
      ? z.record(z.string().min(1), z.string().min(1)).parse(JSON.parse(process.env.TTS_VOICES))
      : undefined,
    ttsResourceId: process.env.DOUBAO_TTS_RESOURCE_ID ?? 'seed-tts-2.0',
    python: process.env.PYTHON || path.join(serviceRoot, '.venv/bin/python3'),
    templates,
    runtimeVersion: JSON.parse(
      readFileSync(path.join(serviceRoot, 'config/runtime-version.json'), 'utf8'),
    ).version,
  };
}
