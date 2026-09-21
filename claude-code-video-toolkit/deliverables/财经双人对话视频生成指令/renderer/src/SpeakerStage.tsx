import {Img, interpolate, staticFile} from 'remotion';
import type {Speaker} from './types';

const asset = (path: string) => staticFile(`template-assets/${path}`);

export const SpeakerStage: React.FC<{speaker: Speaker; frame: number}> = ({speaker, frame}) => {
  const femaleActive = speaker === 'female-host';
  const settle = interpolate(frame, [0, 16], [0.9, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const portrait = (active: boolean, side: 'left' | 'right') => ({
    position: 'absolute' as const,
    [side]: 8,
    bottom: -6,
    width: 610,
    height: 770,
    objectFit: 'contain' as const,
    objectPosition: 'bottom center',
    opacity: active ? 1 : 0.28,
    filter: active ? 'drop-shadow(0 24px 28px #000b)' : 'grayscale(.76) brightness(.58)',
    transform: `scale(${(active ? 1 : 0.8) * settle})`,
    transformOrigin: `bottom ${side}`,
    transition: 'opacity 160ms linear',
  });
  return (
    <>
      <Img src={asset('assets/images/hosts/male-chief.png')} style={portrait(!femaleActive, 'left')} />
      <Img src={asset('assets/images/hosts/female-host.png')} style={portrait(femaleActive, 'right')} />
    </>
  );
};
