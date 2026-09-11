import { createHash } from 'node:crypto';
import type { Scene } from '../contracts/ifeng.js';
export function stable(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .filter((k) => value[k] !== undefined)
        .map((k) => JSON.stringify(k) + ':' + stable(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const digest = (value: any) => createHash('sha256').update(stable(value)).digest('hex');
export function sceneHash(scene: Scene, hashes: Record<string, string>, config: any) {
  const copy = structuredClone(scene);
  delete copy.durationSource;
  // Human explanation and external mount roots do not affect rendered pixels.
  delete copy.visualPlan.selectionReason;
  copy.visualPlan.description = '';
  for (const a of [...copy.extraData.videoInfoList, ...copy.extraData.picInfoList])
    a.url = hashes[a.assetId] ?? 'MISSING';
  return digest({ scene: copy, config });
}
