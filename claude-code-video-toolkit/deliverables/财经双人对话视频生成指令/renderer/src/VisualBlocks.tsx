import type {CSSProperties} from 'react';
import {Easing, interpolate} from 'remotion';
import type {VisualBlock} from './types';
import {visualExtensions} from './visualExtensions';
import {motionFrames} from './motion';

const text = (v: unknown) => typeof v === 'string' ? v : '';
const items = (v: unknown) => Array.isArray(v) ? v as string[] : [];
const arrive = (frame: number, start = 0, duration = 13) => duration === 0 ? (frame >= start ? 1 : 0) : interpolate(frame, [start, start + duration], [0, 1],
  {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
const colors = ['#49c7df', '#f6bc4a', '#63d9a3', '#ef5258'];
const box: CSSProperties = {border: '1px solid #49c7df66', borderRadius: 16,
  background: 'linear-gradient(145deg, rgba(20,31,46,.96), rgba(9,15,25,.92))', padding: 22, boxSizing: 'border-box', overflowWrap: 'anywhere', minWidth: 0};
const slots: Record<string, CSSProperties> = {
  full: {inset: 0}, top: {left: 0, right: 0, top: 0, height: '46%'},
  bottom: {left: 0, right: 0, bottom: 0, height: '46%'},
  left: {left: 0, top: 0, bottom: 0, width: '48%'},
  right: {right: 0, top: 0, bottom: 0, width: '48%'},
};

const Block: React.FC<{block: VisualBlock; frame: number}> = ({block, frame}) => {
  const p = block.props;
  const local = frame - block.startFrame;
  const length = block.endFrameExclusive - block.startFrame;
  const duration = (start: number, fallback: number) => motionFrames(length - start, block.animationFrames, fallback);
  const entry = arrive(local, 0, duration(0, 13));
  const list = items(p.items);
  // itemFrames 相对组件起点，由真实配音边界换算；不是按总时长平均分配。
  const itemFrames = (p.itemFrames ?? []) as number[];
  const itemStyle = (index: number): CSSProperties => {
    const progress = arrive(local, itemFrames[index], duration(itemFrames[index], 13));
    return {opacity: progress, transform: `translateY(${(1 - progress) * 20}px)`};
  };
  let body: React.ReactNode;
  const Extension = visualExtensions[block.kind]?.component;
  if (Extension) {
    body = <Extension block={block} frame={local} />;
  } else if (block.kind === 'metric') {
    body = <div style={{...box, width: '100%', textAlign: 'center'}}>
      <div style={{color: '#95a8bd', fontSize: 19}}>{text(p.label)}</div>
      <div style={{color: colors[0], fontSize: 42, fontWeight: 800, marginTop: 9}}>{text(p.value)}</div>
      <div style={{color: '#d5deea', fontSize: 18, marginTop: 8}}>{text(p.detail)}</div>
    </div>;
  } else if (['comparison', 'flow', 'layers', 'labels'].includes(block.kind)) {
    body = <div style={{width: '100%', display: 'grid', gap: 16,
      gridTemplateColumns: block.kind === 'layers' ? '1fr' : `repeat(${Number(p.columns) || Math.min(list.length, block.kind === 'labels' ? 2 : 3)}, minmax(0, 1fr))`}}>
      {list.map((item, index) => <div key={index} style={{...box, ...itemStyle(index), color: colors[index % colors.length],
        marginLeft: block.kind === 'layers' ? Math.min(index, 5) * 24 : 0, fontSize: 27, fontWeight: 700, padding: block.kind === 'layers' ? '13px 22px' : 22}}>
        <span style={{marginRight: 14}}>{block.kind === 'labels' ? '✓' : block.kind === 'flow' ? `${index + 1} →` : block.kind === 'layers' ? `0${index + 1}` : index ? 'B' : 'A'}</span>{item}
      </div>)}
    </div>;
  } else if (block.kind === 'trend') {
    // 只有两个端点时展示端点变化，不捏造中间时间序列。
    const progress = arrive(local, Number(p.revealFrame), duration(Number(p.revealFrame), 28));
    body = <div style={{...box, width: '100%'}}>
      <div style={{color: '#95a8bd', fontSize: 23}}>{text(p.label)}</div>
      <div style={{display: 'flex', alignItems: 'center', gap: 36, marginTop: 24}}>
        <strong style={{color: colors[0], fontSize: 64}}>{text(p.from)}</strong>
        <div style={{flex: 1, height: 4, background: '#455a70'}}><div style={{height: 9, width: `${progress * 100}%`, background: colors[3], boxShadow: '0 0 18px #ef5258'}} /></div>
        <strong style={{opacity: progress, color: colors[3], fontSize: 76}}>{text(p.to)}</strong>
      </div>
    </div>;
  } else if (block.kind === 'line') {
    const values = p.values as number[];
    const min = Math.min(...values), range = Math.max(...values) - min || 1;
    const points = values.map((value, index) => `${32 + index * 836 / (values.length - 1)},${155 - (value - min) / range * 125}`).join(' ');
    const progress = arrive(local, Number(p.revealFrame), duration(Number(p.revealFrame), 45));
    body = <div style={{width: '100%', height: '100%', minHeight: 170, color: '#aebdce', fontSize: 22}}>
      {text(p.label)}
      <svg viewBox="0 0 900 200" style={{width: '100%', height: '80%'}}>
        <line x1="32" x2="868" y1="155" y2="155" stroke="#42566e" />
        <polyline points={points} fill="none" stroke="#49c7df" strokeWidth="6" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
        {values.map((value, index) => <text key={index} x={32 + index * 836 / (values.length - 1)} y="192"
          textAnchor={index === 0 ? 'start' : index === values.length - 1 ? 'end' : 'middle'} fill="#aebdce" fontSize="17">{items(p.labels)[index]} {value}{text(p.unit)}</text>)}
      </svg>
    </div>;
  } else if (block.kind === 'gauge' || block.kind === 'ring') {
    const value = Number(p.value);
    const progress = arrive(local, Number(p.revealFrame), duration(Number(p.revealFrame), 26)) * value;
    body = <div style={{...box, width: '100%', color: '#d5deea', fontSize: 25}}>
      <div>{text(p.label)}</div>
      {block.kind === 'ring' ? <div style={{margin: '18px auto', width: 130, height: 130, borderRadius: '50%',
        background: `conic-gradient(#49c7df 0 ${progress}%, #27394d ${progress}% 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{background: '#0d1828', width: 98, height: 98, borderRadius: '50%', display: 'grid', placeItems: 'center'}}>{value}%</div>
      </div> : <>
        <div style={{height: 35, marginTop: 20, borderRadius: 28, background: '#1a2b43', position: 'relative'}}>
          <div style={{width: `${progress}%`, height: '100%', borderRadius: 28, background: 'linear-gradient(90deg, #49c7df, #63d9a3)'}} />
          <div style={{position: 'absolute', left: `${Number(p.threshold)}%`, top: -7, bottom: -7, borderLeft: '3px dashed #ef5258'}} />
        </div>
        <div style={{marginTop: 12, color: colors[2]}}>{value}% <span style={{float: 'right', color: colors[3]}}>阈值 {Number(p.threshold)}%</span></div>
      </>}
      <div style={{fontSize: 22, marginTop: 12}}>{text(p.detail)}</div>
    </div>;
  } else {
    body = <div style={{...box, width: '100%', borderLeft: '4px solid #ef5258'}}>
      <div style={{color: '#ef5258', fontSize: 20, marginBottom: 18}}>{text(p.label)}</div>
      <div style={{color: '#f5f9ff', fontSize: 38, lineHeight: 1.5, fontWeight: 800}}>{text(p.text)}</div>
    </div>;
  }
  return <div data-block={block.id} style={{position: 'absolute', ...slots[block.slot ?? 'full'], display: 'flex',
    alignItems: 'center', opacity: entry, transform: `translateY(${(1 - entry) * 20}px)`}}>
    <div data-visual-surface data-overlay={block.intentionalOverlap ? 'true' : 'false'} style={{width: '100%', minWidth: 0}}>{body}</div>
  </div>;
};

export const VisualBlocks: React.FC<{blocks: VisualBlock[]; frame: number; title: string; label: string}> = ({blocks, frame, title, label}) => (
  <div data-dashboard style={{position: 'absolute', top: 280, left: 58, right: 58, bottom: 190, overflow: 'hidden',
    border: '1px solid rgba(133,158,187,.25)', borderRadius: 23,
    background: 'linear-gradient(145deg, rgba(13,22,34,.94), rgba(8,14,23,.8))'}}>
    <div style={{position: 'absolute', top: 25, left: 42, right: 42}}>
      <div style={{color: '#ef5258', fontSize: 16, letterSpacing: 3, fontWeight: 800}}>{label}</div>
      <div data-fit style={{marginTop: 9, color: '#f1f6fb', fontSize: 37, fontWeight: 800, lineHeight: 1.15, maxHeight: 96, overflowWrap: 'anywhere'}}>{title}</div>
    </div>
    <div style={{position: 'absolute', top: 160, left: 68, right: 68, bottom: 30}}>
      {blocks.filter((b) => frame >= b.startFrame && frame < b.endFrameExclusive).map((block) => <Block key={block.id} block={block} frame={frame} />)}
    </div>
  </div>
);
