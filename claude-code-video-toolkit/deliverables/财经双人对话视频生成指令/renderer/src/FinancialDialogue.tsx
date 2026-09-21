import {AbsoluteFill, Audio, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {ChapterTransition} from './ChapterTransition';
import {TemplateMotion} from './FinancialIntros';
import {SpeakerStage} from './SpeakerStage';
import {SubtitleLayer} from './SubtitleLayer';
import type {DialogueScene, FinanceTimeline} from './types';
import {VisualBlocks} from './VisualBlocks';

const asset = (path: string) => staticFile(`template-assets/${path}`);

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{background: 'radial-gradient(circle at 50% 38%, #153a59 0%, #07111e 56%, #02060b 100%)'}}>
      <AbsoluteFill
        style={{
          opacity: 0.18,
          backgroundImage: 'linear-gradient(#4ad2e822 1px, transparent 1px), linear-gradient(90deg, #4ad2e822 1px, transparent 1px)',
          backgroundSize: '58px 58px',
          backgroundPosition: `${frame * 0.08}px ${frame * 0.035}px`,
        }}
      />
    </AbsoluteFill>
  );
};

const SceneAudio: React.FC<{scene: DialogueScene; bgm?: FinanceTimeline['bgm']; bgmOffset?: number}> = ({scene, bgm, bgmOffset = 0}) => (
  <>
    {bgm ? <Audio src={asset(bgm.src)} loop startFrom={bgmOffset} volume={bgm.volume ?? 0.11} /> : null}
    {scene.utterances.map((utterance) => (
      <Sequence key={utterance.id} from={utterance.startFrame} durationInFrames={utterance.endFrameExclusive - utterance.startFrame}>
        <Audio src={staticFile(utterance.src)} />
      </Sequence>
    ))}
    {(scene.sfx ?? []).map((cue, index) => (
      <Sequence key={`${cue.src}-${index}`} from={cue.frame} durationInFrames={90}>
        <Audio src={asset(cue.src)} volume={cue.volume ?? 0.2} />
      </Sequence>
    ))}
  </>
);

export const FinanceScene: React.FC<{scene: DialogueScene; bgm?: FinanceTimeline['bgm']; bgmOffset?: number}> = ({scene, bgm, bgmOffset}) => {
  const frame = useCurrentFrame();
  if (scene.intro) return <TemplateMotion src={scene.intro.src} />;
  if (scene.outro) return <TemplateMotion src={scene.outro.src} holdLastFrame />;
  if (scene.chapter && frame < scene.chapter.frames)
    return <ChapterTransition title={scene.chapter.title} duration={scene.chapter.frames} />;
  const summaryOpacity = interpolate(frame, [12, 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill>
      <Background />
      <div style={{position: 'absolute', left: 58, top: 38, color: '#7cebf5', fontSize: 24, fontWeight: 800, letterSpacing: 3, zIndex: 5}}>
        财报揭秘室 <span style={{color: '#9ab2c1', fontWeight: 400}}>· AI STRATEGY</span>
      </div>
      <Img src={asset('assets/images/brand/logo-dark.png')} style={{position: 'absolute', right: 44, top: 30, width: 168, height: 68, objectFit: 'contain', filter: 'brightness(2)', zIndex: 5}} />
      <SpeakerStage speaker={scene.speaker} frame={frame} />
      <VisualBlocks blocks={scene.visualBlocks} frame={frame} />
      <div style={{position: 'absolute', bottom: 142, left: scene.speaker === 'male-chief' ? 440 : 735, maxWidth: 650, opacity: summaryOpacity, padding: '15px 25px', borderLeft: '5px solid #5ee5f1', borderRadius: 10, background: 'linear-gradient(90deg, #082239ed, #123752ed)', color: '#f1fbff', fontSize: 31, fontWeight: 800, lineHeight: 1.35, zIndex: 6}}>
        {scene.summary}
      </div>
      <SubtitleLayer captions={scene.captions} frame={frame} />
      <div style={{position: 'absolute', left: 58, bottom: 27, width: 240, height: 4, background: '#2d526b', zIndex: 8}}>
        <div style={{height: '100%', width: `${interpolate(frame, [0, scene.frames], [0, 100], {extrapolateRight: 'clamp'})}%`, background: '#5ee5f1'}} />
      </div>
      <SceneAudio scene={scene} bgm={bgm} bgmOffset={bgmOffset} />
    </AbsoluteFill>
  );
};

export const FinanceEpisode: React.FC<{timeline: FinanceTimeline}> = ({timeline}) => (
  <AbsoluteFill>
    {timeline.bgm ? <Audio src={asset(timeline.bgm.src)} loop volume={timeline.bgm.volume ?? 0.11} /> : null}
    {timeline.scenes.map((scene) => (
      <Sequence key={scene.id} from={scene.from} durationInFrames={scene.frames}>
        <FinanceScene scene={scene} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
