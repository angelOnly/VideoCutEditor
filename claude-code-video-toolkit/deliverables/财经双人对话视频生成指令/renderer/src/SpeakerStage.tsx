import {Easing, Img, interpolate, staticFile} from 'remotion';
import type {Speaker} from './types';

const meta = (speaker: Speaker) => speaker === 'female-host'
  ? {name: '财小策', role: '提问与验证', accent: '#ef5258'}
  : {name: '室长', role: '拆解与判断', accent: '#49c7df'};

const Avatar: React.FC<{speaker: Speaker; active: boolean}> = ({speaker, active}) => {
  const size = active ? 130 : 64;
  const {accent} = meta(speaker);
  return <div data-avatar={active ? 'active' : 'idle'} style={{width: size, height: size, flexShrink: 0,
    padding: Math.max(3, size * .045), borderRadius: '50%', boxSizing: 'border-box',
    background: active ? accent : '#2a3849', boxShadow: active ? `0 0 36px ${accent}9b` : 'none'}}>
    <div style={{height: '100%', overflow: 'hidden', borderRadius: '50%'}}>
      <Img src={staticFile(`template-assets/assets/images/hosts/${speaker}.png`)} style={{width: '100%', height: '100%',
        objectFit: 'cover', objectPosition: speaker === 'female-host' ? '50% 9%' : '50% 10%', transform: 'scale(1.36)'}} />
    </div>
  </div>;
};

// 保留参考片的头像比例、裁切和观点卡，禁止根据稿件重新放大人物。
export const SpeakerStage: React.FC<{speaker: Speaker; frame: number; summary: string}> = ({speaker, frame, summary}) => {
  const female = speaker === 'female-host';
  const inactive: Speaker = female ? 'male-chief' : 'female-host';
  const {name, role, accent} = meta(speaker);
  const p = interpolate(frame, [0, 13], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return <>
    <div style={{position: 'absolute', top: 124, [female ? 'right' : 'left']: 52, display: 'flex',
      flexDirection: female ? 'row-reverse' : 'row', alignItems: 'center', gap: 17, zIndex: 15, opacity: p,
      transform: `translateX(${(1 - p) * (female ? 28 : -28)}px) scale(${.84 + p * .16})`, transformOrigin: female ? 'right top' : 'left top'}}>
      <Avatar speaker={speaker} active />
      <div data-keyline style={{width: 540, boxSizing: 'border-box', padding: '15px 21px 17px', border: `1px solid ${accent}91`,
        borderRadius: 18, background: 'linear-gradient(145deg, rgba(13,22,35,.97), rgba(8,14,24,.93))', boxShadow: `0 12px 34px ${accent}22`}}>
        <div style={{display: 'flex', justifyContent: 'space-between', color: '#eff6ff', fontSize: 23, fontWeight: 800}}>
          {name}<span style={{color: '#92a8bd', fontSize: 14}}>{role}</span>
        </div>
        <div data-fit style={{maxHeight: 72, marginTop: 9, borderLeft: `4px solid ${accent}`, paddingLeft: 12, color: '#f5f9ff', fontSize: 29,
          lineHeight: 1.2, fontWeight: 800, overflowWrap: 'anywhere'}}>{summary}</div>
      </div>
    </div>
    <div style={{position: 'absolute', top: 150, [female ? 'left' : 'right']: 58, display: 'flex',
      flexDirection: female ? 'row' : 'row-reverse', alignItems: 'center', gap: 10, opacity: .3}}>
      <Avatar speaker={inactive} active={false} /><span style={{color: '#9caec0', fontSize: 17}}>{meta(inactive).name}</span>
    </div>
  </>;
};
