import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
const serviceRoot = fileURLToPath(new URL('../', import.meta.url));
const tenantSchema = z.object({
  id: z.string().min(1),
  apiKey: z.string().min(16),
  inputRoot: z.string(),
  exportRoot: z.string(),
  allowedInputPrefixes: z.array(z.string()).min(1),
  callbackBaseUrl: z.string().url(),
  callbackSecret: z.string().min(16),
});
export type Tenant = z.infer<typeof tenantSchema>;
export interface Config {
  databaseUrl: string;
  port: number;
  mediaRoot: string;
  dataRoot: string;
  toolkitRoot: string;
  tenants: Tenant[];
  leaseSeconds: number;
  timeoutSeconds: number;
  maxAttempts: number;
  repairRounds: number;
  runnerImage: string;
  dockerNetwork: string;
  dockerUid: string;
  dockerMemory: string;
  dockerCpus: string;
  codexModel?: string;
  codexApiKey?: string;
  codexBaseUrl?: string;
  ttsVoice: string;
  ttsResourceId: string;
  python: string;
  templates: Record<string, { path: string; version: string }>;
  runtimeVersion: string;
}
export function loadConfig(): Config {
  const mediaRoot = process.env.MEDIA_ROOT ?? '/home/ops/jiangzb/videos';
  const tenants = z
    .array(tenantSchema)
    .min(1)
    .parse(
      JSON.parse(
        readFileSync(
          process.env.TENANTS_FILE ?? path.join(serviceRoot, 'config/tenants.json'),
          'utf8',
        ),
      ),
    );
  if (
    new Set(tenants.map((t) => t.id)).size !== tenants.length ||
    new Set(tenants.map((t) => t.apiKey)).size !== tenants.length
  )
    throw Error('Duplicate tenant id/key');
  const templates = JSON.parse(
    readFileSync(path.join(serviceRoot, 'config/templates.json'), 'utf8'),
  );
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  return {
    databaseUrl: process.env.DATABASE_URL,
    port: Number(process.env.PORT ?? 8080),
    mediaRoot,
    dataRoot: process.env.DATA_ROOT ?? '/home/ops/jiangzb/video-worker-data',
    toolkitRoot:
      process.env.TOOLKIT_ROOT ?? path.resolve(serviceRoot, '../claude-code-video-toolkit'),
    tenants,
    leaseSeconds: 60,
    timeoutSeconds: 14400,
    maxAttempts: 3,
    repairRounds: 10,
    runnerImage: process.env.RUNNER_IMAGE ?? 'videocut-runner:0.1.0',
    dockerNetwork: process.env.RUNNER_NETWORK ?? 'bridge',
    dockerUid: process.env.RUNNER_UID ?? '1000:1000',
    dockerMemory: process.env.RUNNER_MEMORY ?? '4g',
    dockerCpus: process.env.RUNNER_CPUS ?? '2',
    codexModel: process.env.CODEX_MODEL,
    codexApiKey: process.env.CODEX_API_KEY,
    codexBaseUrl: process.env.CODEX_BASE_URL,
    ttsVoice: process.env.TTS_VOICE ?? 'zh_female_xiaohe_uranus_bigtts',
    ttsResourceId: process.env.DOUBAO_TTS_RESOURCE_ID ?? 'seed-tts-2.0',
    python: process.env.PYTHON ?? 'python3',
    templates,
    runtimeVersion: JSON.parse(
      readFileSync(path.join(serviceRoot, 'config/runtime-version.json'), 'utf8'),
    ).version,
  };
}
