import {AbsoluteFill, Freeze, OffthreadVideo, interpolate, staticFile, useCurrentFrame} from 'remotion';

const asset = (path: string) => staticFile(`template-assets/${path}`);

export const TemplateMotion: React.FC<{src: string; holdLastFrame?: boolean; muted: boolean; frames?: number}> = ({src, holdLastFrame, muted, frames = 67}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{background: '#050c14', opacity}}>
      {holdLastFrame && frame >= frames
        ? <Freeze frame={frames - 1}><OffthreadVideo muted src={asset(src)} style={{width: '100%', height: '100%', objectFit: 'cover'}} /></Freeze>
        : <OffthreadVideo muted={muted} src={asset(src)} volume={.18} style={{width: '100%', height: '100%', objectFit: 'cover'}} />}
    </AbsoluteFill>
  );
};
