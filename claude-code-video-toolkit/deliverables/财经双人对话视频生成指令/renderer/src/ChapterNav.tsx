import type {Chapter} from './types';

export const ChapterNav: React.FC<{chapters: Chapter[]; frame: number; totalFrames: number}> = ({chapters, frame, totalFrames}) => {
  const active = chapters.find((chapter) => frame >= chapter.from && frame < chapter.endFrameExclusive);
  // 多章节只展示当前及相邻主题，保留全片进度。
  const activeIndex = Math.max(0, chapters.findIndex((c) => c.id === active?.id));
  const first = Math.max(0, Math.min(activeIndex - 1, chapters.length - 3));
  const visible = chapters.length <= 6 ? chapters : chapters.slice(first, first + 3);
  const progress = Math.max(0, Math.min(100, frame / Math.max(1, totalFrames - 1) * 100));
  return <div data-chapter-nav style={{position: 'absolute', left: 48, right: 48, bottom: 20, height: 100}}>
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 76, color: '#aebdce', fontSize: 20, textAlign: 'center'}}>{active?.summary}</div>
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 50, color: '#71869d', fontSize: 14, textAlign: 'center'}}>本内容仅供信息参考，不构成投资建议。市场有风险，决策需谨慎。</div>
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 12, display: 'flex', minHeight: 26, border: '1px solid #3c4c60', background: 'rgba(8,13,22,.82)'}}>
      {visible.map((chapter) => <div data-fit key={chapter.id} style={{flex: 1, minWidth: 0, maxHeight: 52, overflowWrap: 'anywhere', borderRight: '1px solid #3c4c60',
        color: active?.id === chapter.id ? '#07101b' : '#9baabd', fontSize: 16, fontWeight: 800, textAlign: 'center', lineHeight: '26px',
        background: active?.id === chapter.id ? '#e8eef5' : 'transparent'}}>{chapter.label}</div>)}
    </div>
    <div style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, borderRadius: 4, background: '#334357'}}>
      <div data-episode-progress style={{width: `${progress}%`, height: '100%', borderRadius: 4, background: '#ef5258', boxShadow: '0 0 12px #ef5258'}} />
    </div>
  </div>;
};
