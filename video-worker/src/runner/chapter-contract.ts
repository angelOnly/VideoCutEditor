import { hashFile, readJson, safeFile } from '../infrastructure/files.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 确认稿是边界；编排和 brief 不能自行扩大分镜范围或编造音频锚点。 */
export async function validateChapterBrief(root: string, runId: string, brief: any) {
  const read = async (relative: string) => readJson(await safeFile(root, relative));
  const request = await read(`render/${runId}/request.json`);
  if (request.runId !== runId || request.stage !== 'render') throw Error('章节父请求无效');
  const confirmationPath = await safeFile(root, request.confirmation?.planFile);
  const confirmationHash = await hashFile(confirmationPath);
  if (confirmationHash !== request.confirmation?.planSha256) throw Error('确认稿摘要不匹配');
  const confirmation = await readJson(confirmationPath);
  const direction = await read(`render/${runId}/direction.json`);
  const timeline = await read(`render/${runId}/timeline.json`);
  const sceneOrder = confirmation.scenes.map((s: any) => s.id);
  if (
    direction.confirmationSha256 !== confirmationHash ||
    !same(direction.sceneOrder, sceneOrder) ||
    !same(
      timeline.scenes.map((s: any) => s.id),
      sceneOrder,
    )
  )
    throw Error('编排或时间轴不符合确认分镜顺序');
  if (brief.directionVersion == null || brief.directionVersion !== direction.directionVersion)
    throw Error('章节编排版本已过期');
  if (!Array.isArray(direction.chapters) || !direction.chapters.length) throw Error('编排缺少章节');
  const chapterIds = new Set<string>(),
    assigned = new Set<string>();
  for (const chapter of direction.chapters) {
    if (
      typeof chapter.chapterId !== 'string' ||
      chapterIds.has(chapter.chapterId) ||
      !Array.isArray(chapter.sceneIds) ||
      !chapter.sceneIds.length
    )
      throw Error('编排章节身份重复或无效');
    chapterIds.add(chapter.chapterId);
    for (const scene of chapter.sceneIds) {
      if (!sceneOrder.includes(scene) || assigned.has(scene)) throw Error('章节分镜越界或交叉');
      assigned.add(scene);
    }
  }
  if (!same([...assigned], sceneOrder)) throw Error('章节没有按确认顺序完整覆盖分镜');
  const chapter = direction.chapters.find((c: any) => c.chapterId === brief.chapterId);
  if (!chapter || !same(chapter.sceneIds, brief.sceneIds)) throw Error('brief 不属于指定章节范围');
  const expected: any[] = [];
  for (const sceneId of brief.sceneIds) {
    const scene = timeline.scenes.find((s: any) => s.id === sceneId);
    const confirmed = confirmation.scenes.find((s: any) => s.id === sceneId);
    if (
      !Array.isArray(scene.utterances) ||
      scene.utterances.map((u: any) => u.text).join('') !== confirmed.text
    )
      throw Error('真实时间轴口播与确认稿不一致');
    const offset = scene.startFrame ?? scene.from;
    const utteranceIds = new Set<string>();
    for (const u of scene.utterances) {
      if (
        typeof u.id !== 'string' ||
        utteranceIds.has(u.id) ||
        !Number.isSafeInteger(offset) ||
        !Number.isSafeInteger(u.startFrame) ||
        !Number.isSafeInteger(u.endFrameExclusive) ||
        u.startFrame < 0 ||
        u.endFrameExclusive <= u.startFrame ||
        u.endFrameExclusive > scene.frames
      )
        throw Error('音频窗口无效');
      utteranceIds.add(u.id);
      expected.push({
        utteranceId: u.id,
        sceneId,
        text: u.text,
        startFrame: u.startFrame,
        endFrameExclusive: u.endFrameExclusive,
        globalStartFrame: offset + u.startFrame,
        globalEndFrameExclusive: offset + u.endFrameExclusive,
        audioSha256: await hashFile(await safeFile(root, u.audioPath)),
      });
    }
  }
  if (
    !Array.isArray(brief.audioAnchors) ||
    brief.audioAnchors.length !== expected.length ||
    expected.some((anchor, i) =>
      Object.keys(anchor).some((k) => anchor[k] !== brief.audioAnchors[i]?.[k]),
    )
  )
    throw Error('章节音频锚点与真实音频时间轴不一致');
  return direction;
}
