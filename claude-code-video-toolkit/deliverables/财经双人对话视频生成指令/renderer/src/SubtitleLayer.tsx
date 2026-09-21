import type { CSSProperties } from 'react';
import type { Caption } from './types';

const captionStyle: CSSProperties = {
  position: 'absolute',
  left: 118,
  right: 118,
  bottom: 57,
  minHeight: 78,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  color: '#f7fbff',
  fontFamily: 'PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, sans-serif',
  fontSize: 34,
  fontWeight: 600,
  lineHeight: 1.42,
  letterSpacing: 0.6,
  textShadow: '0 2px 12px #02070dcc',
  zIndex: 8,
};

export const SubtitleLayer: React.FC<{captions: Caption[]; frame: number}> = ({captions, frame}) => {
  const caption = captions.find(
    (item) => frame >= item.startFrame && frame < item.endFrameExclusive,
  );
  if (!caption) return null;
  return <div style={captionStyle}>{caption.text}</div>;
};
