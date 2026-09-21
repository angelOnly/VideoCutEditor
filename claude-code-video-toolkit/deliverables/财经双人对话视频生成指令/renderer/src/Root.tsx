import {Composition} from 'remotion';
import {FinanceEpisode, FinanceScene} from './FinancialDialogue';
import {timeline} from './timeline';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="FinanceEpisode"
      component={FinanceEpisode}
      durationInFrames={Math.max(1, timeline.totalFrames)}
      fps={timeline.fps}
      width={timeline.width}
      height={timeline.height}
      defaultProps={{timeline}}
    />
    {timeline.scenes.map((scene) => (
      <Composition
        key={scene.id}
        id={`FinanceScene_${scene.id}`}
        component={FinanceScene}
        durationInFrames={scene.frames}
        fps={timeline.fps}
        width={timeline.width}
        height={timeline.height}
        defaultProps={{scene, bgm: timeline.bgm, bgmOffset: scene.from}}
      />
    ))}
  </>
);
