import {AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame} from 'remotion';

const asset = (path: string) => staticFile(`template-assets/${path}`);

export const TemplateMotion: React.FC<{src: string; holdLastFrame?: boolean}> = ({src, holdLastFrame}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{background: '#050c14', opacity}}>
      <OffthreadVideo
        src={asset(src)}
        style={{width: '100%', height: '100%', objectFit: 'cover'}}
        {...(holdLastFrame ? {pauseWhenBuffering: true} : {})}
      />
    </AbsoluteFill>
  );
};
