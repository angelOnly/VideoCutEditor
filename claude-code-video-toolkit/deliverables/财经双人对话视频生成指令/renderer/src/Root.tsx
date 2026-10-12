import {Composition, getInputProps} from 'remotion';
import {FinanceScene} from './FinancialDialogue';
import {validateBlocks} from './validateTimeline';
import type {DialogueScene, FinanceTimeline} from './types';

type Props = {scene: DialogueScene; timeline: FinanceTimeline; withBgm: boolean};

// 正式输入只由工具注入；共同源码不再保存全片内容或设计记录。
export const RemotionRoot: React.FC = () => {
  const props = getInputProps() as Props;
  if (!props.scene || !props.timeline) throw new Error('请先派生当前分镜执行参数');
  const {scene, timeline} = props;
  validateBlocks(scene.visualBlocks, scene.frames);
  for (const chapter of timeline.chapters) validateBlocks(chapter.visualBlocks, chapter.endFrameExclusive - chapter.from);
  if (scene.captions.some(c => c.startFrame < 0 || c.endFrameExclusive > scene.frames || c.startFrame >= c.endFrameExclusive)) throw new Error('字幕边界无效');
  return <Composition id="FinanceScene" component={FinanceScene}
    durationInFrames={scene.frames} fps={timeline.fps} width={timeline.width} height={timeline.height}
    defaultProps={props} />;
};
