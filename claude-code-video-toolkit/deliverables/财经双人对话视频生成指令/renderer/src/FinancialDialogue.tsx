import {AbsoluteFill, Audio, Freeze, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {ChapterTransition} from './ChapterTransition';
import {ChapterNav} from './ChapterNav';
import {TemplateMotion} from './FinancialIntros';
import {SpeakerStage} from './SpeakerStage';
import {SubtitleLayer} from './SubtitleLayer';
import type {DialogueScene, FinanceTimeline} from './types';
import {VisualBlocks} from './VisualBlocks';
import {LayoutGuard} from './LayoutGuard';

const asset = (path: string) => staticFile(`template-assets/${path}`);

const Background: React.FC<{frame: number}> = ({frame}) => {
  const drift = frame * .23;
  return <AbsoluteFill style={{overflow: 'hidden', background: '#060b14'}}>
    <AbsoluteFill style={{opacity: .35, backgroundImage: 'linear-gradient(rgba(94,118,154,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(94,118,154,.12) 1px, transparent 1px)',
      backgroundSize: '84px 84px', backgroundPosition: `${drift}px ${drift * .42}px`}} />
    <AbsoluteFill style={{background: 'radial-gradient(circle at 72% 14%, rgba(19,114,136,.22), transparent 28%), radial-gradient(circle at 12% 88%, rgba(159,33,47,.20), transparent 35%)'}} />
    <div style={{position: 'absolute', top: 0, left: 0, right: 0, height: 7, background: 'linear-gradient(90deg, #ef454a 0 27%, #233044 27% 100%)'}} />
  </AbsoluteFill>;
};

const SceneAudio: React.FC<{scene: DialogueScene}> = ({scene}) => <>
  {scene.intro && !scene.intro.muted ? <Sequence from={scene.intro.fromFrame ?? 0} durationInFrames={scene.intro.frames ?? 67}>
    <Audio src={asset(scene.intro.src)} volume={.18} />
  </Sequence> : null}
  {scene.utterances.map((utterance) => <Sequence key={utterance.id} from={utterance.startFrame} durationInFrames={utterance.endFrameExclusive - utterance.startFrame}>
    <Audio src={staticFile(utterance.src)} />
  </Sequence>)}
  {(scene.sfx ?? []).map((cue, index) => <Sequence key={index} from={cue.frame} durationInFrames={cue.durationFrames ?? ((scene.contentFrames ?? scene.frames) - cue.frame)}>
    <Audio src={asset(cue.src)} volume={cue.volume ?? .2} />
  </Sequence>)}
</>;

const BodyVisual: React.FC<{scene: DialogueScene; timeline: FinanceTimeline; frame: number}> = ({scene, timeline, frame}) => {
  if (scene.intro && frame >= (scene.intro.fromFrame ?? 0)) return <Sequence from={scene.intro.fromFrame ?? 0} durationInFrames={scene.frames - (scene.intro.fromFrame ?? 0)}>
    <TemplateMotion {...scene.intro} muted holdLastFrame />
  </Sequence>;
  if (scene.chapter && frame < scene.chapter.frames) return <ChapterTransition title={scene.chapter.title} duration={scene.chapter.frames} />;
  // 单镜导出与全片共用绝对帧；章节图解、进度不会在切句后归零。
  const absolute = scene.from + frame;
  const chapter = timeline.chapters.find((item) => absolute >= item.from && absolute < item.endFrameExclusive);
  if (!chapter) throw new Error(`缺少覆盖正文的章节：${scene.id}`);
  const localBlocks = scene.visualBlocks.length > 0;
  return <AbsoluteFill>
    <Background frame={absolute} />
    <div style={{position: 'absolute', left: 58, top: 38, color: '#dce7f2', fontSize: 24, fontWeight: 800, letterSpacing: 3}}>财报揭秘室</div>
    <Img src={asset('assets/images/brand/logo-dark.png')} style={{position: 'absolute', right: 44, top: 30, width: 168, height: 68, objectFit: 'contain'}} />
    <SpeakerStage speaker={scene.speaker} frame={frame - (scene.chapter?.frames ?? 0)} summary={scene.summary} />
    <VisualBlocks blocks={localBlocks ? scene.visualBlocks : chapter.visualBlocks} frame={localBlocks ? frame : absolute - chapter.from} title={chapter.title} label={chapter.label} />
    <ChapterNav chapters={timeline.chapters} frame={absolute} totalFrames={timeline.totalFrames} />
  </AbsoluteFill>;
};

// 完整时间轴定位原正文镜头，单镜导出也能保持前镜的最终状态。
const HeldBody: React.FC<{timeline: FinanceTimeline; holdFrame: number}> = ({timeline, holdFrame}) => {
  const source = timeline.scenes.find((item) => holdFrame >= item.from && holdFrame < item.from + item.frames);
  if (!source) throw new Error('结束语保持帧没有对应正文分镜');
  const local = holdFrame - source.from;
  // 先保持当前镜头第 0 帧，再用负起点恢复正文局部时间。
  // 直接 Freeze 到 local 会被更短的结束语 Composition 截断，单镜导出尤其明显。
  return <Freeze frame={0}><Sequence from={-local} durationInFrames={local + 1} layout="none">
    <BodyVisual scene={source} timeline={timeline} frame={local} />
  </Sequence></Freeze>;
};

export const FinanceScene: React.FC<{scene: DialogueScene; timeline: FinanceTimeline; withBgm?: boolean}> = ({scene, timeline, withBgm = false}) => {
  const frame = useCurrentFrame();
  const absolute = scene.from + frame;
  const ending = timeline.ending;
  const narrationEnd = ending?.narrationEndFrame ?? timeline.totalFrames;
  const soundFrames = Math.max(0, Math.min(scene.contentFrames ?? scene.frames, narrationEnd - scene.from));
  // 片尾区间只是静态无声占位，最终封装前由共享工具换成完整本地片尾。
  const holding = ending?.holdFrame !== undefined && absolute > ending.holdFrame;
  const placeholder = ending !== undefined && absolute >= narrationEnd;
  const heldFrame = ending?.holdFrame ?? narrationEnd - 1;
  return <AbsoluteFill style={{fontFamily: 'PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif'}}>
    <LayoutGuard frame={frame} />
    {holding || placeholder ? <HeldBody timeline={timeline} holdFrame={heldFrame} /> : <BodyVisual scene={scene} timeline={timeline} frame={frame} />}
    {/* 字幕与所有声音在 Freeze 外继续，口播结束后不延伸到片尾占位。 */}
    {!placeholder ? <SubtitleLayer captions={scene.captions} frame={frame} /> : null}
    {soundFrames > 0 ? <Sequence durationInFrames={soundFrames}><SceneAudio scene={scene} /></Sequence> : null}
    {soundFrames > 0 && withBgm && timeline.bgm ? <Sequence from={-scene.from} durationInFrames={scene.from + soundFrames}>
      <Audio src={asset(timeline.bgm.src)} loop volume={timeline.bgm.volume ?? .11} />
    </Sequence> : null}
  </AbsoluteFill>;
};

export const FinanceEpisode: React.FC<{timeline: FinanceTimeline}> = ({timeline}) => <AbsoluteFill>
  {timeline.scenes.map((scene) => <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames}>
    <FinanceScene scene={scene} timeline={timeline} withBgm />
  </Sequence>)}
</AbsoluteFill>;
