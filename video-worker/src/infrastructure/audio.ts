import path from 'node:path';
import { runtimePaths } from './runtime-paths.js';
import { mkdir, copyFile, chmod, access } from 'node:fs/promises';
import type { Lease } from '../domain/task.js';
import { AppError } from '../domain/task.js';
import type { Config } from '../config.js';
import type { Workspace } from './workspace.js';
import { Queue } from './queue.js';
import { digest } from '../domain/scene.js';
import { hashFile, writeJson } from './files.js';
import type { Sandbox } from './sandbox.js';
export async function prepareAudio(
  config: Config,
  queue: Queue,
  l: Lease,
  w: Workspace,
  signal: AbortSignal,
  sandbox: Sandbox,
) {
  if (l.run.stage !== 'render') return;
  const paths = runtimePaths(config, w.root);
  const audioDir = path.join(w.root, 'input/audio');
  await mkdir(audioDir, { recursive: true });
  await chmod(audioDir, config.executor === 'host' ? 0o700 : 0o777);
  const clips: any[] = [];
  for (const scene of l.run.input.dataList) {
    if (!w.task.renderSelection.sceneIds.includes(scene.id)) continue;
    const destination = path.join(audioDir, `${scene.id}.wav`);
    if (w.taskConfig.narration) {
      if (scene.narrationStartTime === undefined || scene.narrationEndTime === undefined)
        throw new AppError('AUDIO_ALIGNMENT_REQUIRED', `${scene.id} 缺少预配音对齐区间`);
      const original = (
        await queue.db.query(
          "SELECT plan FROM plan_versions WHERE task_id=$1 AND kind='analysis' ORDER BY version DESC LIMIT 1",
          [l.run.task_id],
        )
      ).rows[0]?.plan?.dataList?.find((s: any) => s.id === scene.id);
      if (!original || original.content !== scene.content)
        throw new AppError(
          'NARRATION_TEXT_CHANGED',
          '已修改预配音对应文本，请重新提交包含匹配音频的分析任务',
        );
      const a = w.assets.find((a) => a.assetId === w.taskConfig.narration.assetId);
      await sandbox.tool(
        l,
        w,
        [
          'ffmpeg',
          '-nostdin',
          '-v',
          'error',
          '-y',
          '-i',
          path.join(paths.job, a.path),
          '-ss',
          String(scene.narrationStartTime),
          '-t',
          String(scene.narrationEndTime - scene.narrationStartTime),
          '-vn',
          '-ar',
          '48000',
          '-ac',
          '2',
          path.join(paths.job, 'input/audio', scene.id + '.wav'),
        ],
        signal,
      );
    } else {
      if (!process.env.DOUBAO_TTS_API_KEY)
        throw new AppError('TTS_CONFIG_MISSING', '服务未配置配音凭据');
      const inputHash = digest({
        text: scene.content,
        tts: w.taskConfig.tts,
        runtime: config.runtimeVersion,
      });
      const cached = await queue.withLease(l, async (q) => {
        const previous = (
          await q.query('SELECT * FROM external_calls WHERE task_id=$1 AND input_hash=$2', [
            l.run.task_id,
            inputHash,
          ])
        ).rows[0];
        if (previous) {
          if (previous.state !== 'succeeded')
            throw new AppError('EXTERNAL_RESULT_UNKNOWN', '配音请求结果待核对，禁止重复提交');
          return previous.result;
        }
        await q.query(
          "INSERT INTO external_calls(task_id,input_hash,run_id,state) VALUES($1,$2,$3,'pending')",
          [l.run.task_id, inputHash, l.run.id],
        );
        return null;
      });
      const cache = path.join(config.dataRoot, l.run.task_id, 'audio-cache', inputHash + '.wav');
      await mkdir(path.dirname(cache), { recursive: true });
      await chmod(path.dirname(cache), config.executor === 'host' ? 0o700 : 0o777);
      if (cached) {
        if ((await hashFile(cache)) !== cached.sha256)
          throw new AppError('AUDIO_CACHE_INVALID', '已付费配音缓存丢失或损坏，需要人工核对');
      } else {
        try {
          const requestFile = path.join(audioDir, `${scene.id}.request.json`);
          await writeJson(requestFile, {
            text: scene.content,
            voiceId: w.taskConfig.tts.voiceId,
            resourceId: w.taskConfig.tts.resourceId,
          });
          await chmod(requestFile, 0o444);
          await sandbox.tool(
            l,
            w,
            [
              'python3',
              path.join(paths.toolkit, 'tools/worker_tts.py'),
              '--request',
              path.join(paths.job, 'input/audio', scene.id + '.request.json'),
              '--output',
              path.join(
                runtimePaths(config, w.root, path.dirname(cache)).audioCache,
                path.basename(cache),
              ),
            ],
            signal,
            path.dirname(cache),
            true,
          );
          const sha256 = await hashFile(cache);
          await queue.withLease(l, async (q) => {
            await q.query(
              "UPDATE external_calls SET state='succeeded',result=$3 WHERE task_id=$1 AND input_hash=$2",
              [l.run.task_id, inputHash, { sha256 }],
            );
          });
        } catch (e) {
          await queue.db.query(
            "UPDATE external_calls SET state='unknown' WHERE task_id=$1 AND input_hash=$2 AND state='pending'",
            [l.run.task_id, inputHash],
          );
          throw new AppError(
            'EXTERNAL_RESULT_UNKNOWN',
            '配音未确认完成；已记录请求，不自动重复付费',
          );
        }
      }
      await copyFile(cache, destination);
    }
    const probe = JSON.parse(
      await sandbox.tool(
        l,
        w,
        [
          'ffprobe',
          '-v',
          'error',
          '-show_format',
          '-of',
          'json',
          path.join(paths.job, 'input/audio', scene.id + '.wav'),
        ],
        signal,
      ),
    );
    const duration = Number(probe.format.duration);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new AppError('AUDIO_INVALID', '配音时长无效');
    await chmod(destination, 0o444);
    clips.push({
      id: scene.id,
      path: `input/audio/${scene.id}.wav`,
      sha256: await hashFile(destination),
      durationSec: duration,
      text: scene.content,
    });
  }
  await writeJson(path.join(w.root, 'input/audio-manifest.json'), { clips });
  await chmod(path.join(w.root, 'input/audio-manifest.json'), 0o444);
}
