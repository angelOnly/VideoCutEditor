import {AbsoluteFill, Easing, interpolate, useCurrentFrame} from 'remotion';

export const ChapterTransition: React.FC<{title: string; duration: number}> = ({title, duration}) => {
  const frame = useCurrentFrame();
  // 短转场按自身区间压缩进退场，避免固定插值点倒序。
  const last = Math.max(1, duration - 1);
  const progress = duration <= 2 ? 1 : interpolate(frame / last, [0, .3, .7, 1], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
  });
  return (
    <AbsoluteFill
      style={{
        background: 'radial-gradient(circle at 50% 45%, #153858 0%, #07111d 55%, #02060a 100%)',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#edfaff',
        fontFamily: 'PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif',
      }}
    >
      <div
        style={{
          opacity: progress,
          transform: `translateY(${(1 - progress) * 20}px)`,
          textAlign: 'center',
          borderTop: '2px solid #57e0ef',
          borderBottom: '2px solid #57e0ef',
          padding: '30px 86px',
        }}
      >
        <div style={{fontSize: 22, color: '#74e9f3', letterSpacing: 6, marginBottom: 18}}>
          FINANCE INSIGHT / CHAPTER
        </div>
        <div data-fit style={{fontSize: 58, fontWeight: 800, maxWidth: 1480, maxHeight: 240, overflowWrap: 'anywhere'}}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};
