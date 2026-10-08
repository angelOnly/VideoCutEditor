import {Composition} from 'remotion';
import {FinanceEpisode, FinanceScene} from './FinancialDialogue';
import {timeline} from './timeline';
import {validateTimeline} from './validateTimeline';

// 入口检查数据有效性；推荐值只提示，实际布局由逐帧检查和审片确认。
const recommendations = validateTimeline(timeline);
if (recommendations.length) console.warn(JSON.stringify({status: 'recommendation', issues: recommendations}));

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="FinanceEpisode"
      component={FinanceEpisode}
      durationInFrames={timeline.totalFrames}
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
