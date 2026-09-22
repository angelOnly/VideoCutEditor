import {AbsoluteFill, Audio, Img, Sequence, staticFile, useCurrentFrame} from 'remotion';
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
  {scene.utterances.map((utterance) => <Sequence key={utterance.id} from={utterance.startFrame} durationInFrames={utterance.endFrameExclusive - utterance.startFrame}>
    <Audio src={staticFile(utterance.src)} />
  </Sequence>)}
  {(scene.sfx ?? []).map((cue, index) => <Sequence key={index} from={cue.frame} durationInFrames={cue.durationFrames ?? ((scene.contentFrames ?? scene.frames) - cue.frame)}>
    <Audio src={asset(cue.src)} volume={cue.volume ?? .2} />
  </Sequence>)}
</>;

const SceneVisual: React.FC<{scene: DialogueScene; timeline: FinanceTimeline; frame: number}> = ({scene, timeline, frame}) => {
  if (scene.intro && frame >= (scene.intro.fromFrame ?? 0)) return <><Sequence from={scene.intro.fromFrame ?? 0} durationInFrames={scene.frames - (scene.intro.fromFrame ?? 0)}>
    <TemplateMotion {...scene.intro} holdLastFrame />
  </Sequence><SubtitleLayer captions={scene.captions} frame={frame} /></>;
  if (scene.outro) return <><TemplateMotion {...scene.outro} holdLastFrame /><SubtitleLayer captions={scene.captions} frame={frame} /></>;
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
    <SubtitleLayer captions={scene.captions} frame={frame} />
    <ChapterNav chapters={timeline.chapters} frame={absolute} totalFrames={timeline.totalFrames} />
  </AbsoluteFill>;
};

export const FinanceScene: React.FC<{scene: DialogueScene; timeline: FinanceTimeline; withBgm?: boolean}> = ({scene, timeline, withBgm = false}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{fontFamily: 'PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif'}}>
    <LayoutGuard frame={frame} />
    <SceneVisual scene={scene} timeline={timeline} frame={frame} />
    {/* 音频独立于画面分支，片尾和章节转场不能吞掉配音或音效。 */}
    <Sequence durationInFrames={scene.contentFrames ?? scene.frames}><SceneAudio scene={scene} /></Sequence>
    {withBgm && timeline.bgm ? <Sequence from={-scene.from} durationInFrames={scene.from + (scene.contentFrames ?? scene.frames)}>
      <Audio src={asset(timeline.bgm.src)} loop volume={timeline.bgm.volume ?? .11} />
    </Sequence> : null}
  </AbsoluteFill>;
};

export const FinanceEpisode: React.FC<{timeline: FinanceTimeline}> = ({timeline}) => <AbsoluteFill>
  {timeline.scenes.map((scene) => <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames}>
    <FinanceScene scene={scene} timeline={timeline} withBgm />
  </Sequence>)}
</AbsoluteFill>;
