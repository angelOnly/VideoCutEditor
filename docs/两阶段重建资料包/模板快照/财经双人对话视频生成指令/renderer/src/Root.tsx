import {Composition} from 'remotion';
import {FinanceEpisode, FinanceScene} from './FinancialDialogue';
import {timeline} from './timeline';
import {validateTimeline} from './validateTimeline';

// 入口即检查，缺少章节、长字幕或重叠组件不能悄悄渲染交付。
validateTimeline(timeline);

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
    {timeline.scenes.map((scene, index) => (
      <Composition
        key={scene.id}
        id={`FinanceScene-${index + 1}`}
        component={FinanceScene}
        durationInFrames={scene.frames}
        fps={timeline.fps}
        width={timeline.width}
        height={timeline.height}
        defaultProps={{scene, timeline, withBgm: true}}
      />
    ))}
  </>
);
