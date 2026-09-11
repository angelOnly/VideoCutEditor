import path from 'node:path';
import type { Config } from '../config.js';
export function runtimePaths(config: Config, root: string, cacheDir?: string) {
  return config.executor === 'host'
    ? { job: root, toolkit: config.toolkitRoot, audioCache: cacheDir ?? '' }
    : { job: '/workspace/job', toolkit: '/opt/toolkit', audioCache: '/audio-cache' };
}
export function toolkitPath(config: Config, relative: string) {
  return path.join(config.executor === 'host' ? config.toolkitRoot : '/opt/toolkit', relative);
}
