import type {CSSProperties} from 'react';
import {interpolate} from 'remotion';
import type {VisualBlock} from './types';

const asText = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const asItems = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const box: CSSProperties = {
  background: 'linear-gradient(145deg, rgba(18,52,82,.96), rgba(5,15,28,.94))',
  border: '1px solid rgba(93,229,242,.58)',
  borderRadius: 18,
  boxShadow: '0 18px 45px #0009',
};

const appear = (frame: number, block: VisualBlock) =>
  interpolate(frame, [block.startFrame, block.startFrame + 16], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

export const VisualBlocks: React.FC<{blocks: VisualBlock[]; frame: number}> = ({blocks, frame}) => (
  <div style={{position: 'absolute', left: 520, right: 520, top: 205, minHeight: 420, zIndex: 3}}>
    {blocks.map((block) => {
      if (frame < block.startFrame || frame >= block.endFrameExclusive) return null;
      const opacity = appear(frame, block);
      const transform = `translateY(${(1 - opacity) * 24}px)`;
      const props = block.props;
      if (block.kind === 'metric') {
        return (
          <div key={block.id} style={{...box, opacity, transform, padding: '38px 52px', textAlign: 'center'}}>
            <div style={{fontSize: 23, color: '#99b6ca', letterSpacing: 3}}>{asText(props.label)}</div>
            <div style={{fontSize: 104, lineHeight: 1, color: '#63e7f2', fontWeight: 900, marginTop: 18}}>
              {asText(props.value)}
            </div>
            <div style={{fontSize: 28, color: '#effaff', marginTop: 20}}>{asText(props.detail)}</div>
          </div>
        );
      }
      if (block.kind === 'comparison') {
        const items = asItems(props.items);
        return (
          <div key={block.id} style={{display: 'flex', alignItems: 'center', gap: 22, opacity, transform}}>
            {items.slice(0, 2).map((item, index) => (
              <div key={item} style={{...box, flex: 1, padding: '34px 26px', textAlign: 'center', fontSize: 36, fontWeight: 800, color: index ? '#ffd078' : '#74e8f2'}}>
                {item}
              </div>
            ))}
            <div style={{fontSize: 44, color: '#ff8991'}}>VS</div>
          </div>
        );
      }
      if (block.kind === 'layers' || block.kind === 'flow' || block.kind === 'labels') {
        const items = asItems(props.items);
        return (
          <div key={block.id} style={{display: 'flex', flexDirection: block.kind === 'layers' ? 'column' : 'row', gap: 16, opacity, transform}}>
            {items.map((item, index) => (
              <div
                key={item}
                style={{
                  ...box,
                  flex: 1,
                  marginLeft: block.kind === 'layers' ? index * 38 : 0,
                  padding: '22px 25px',
                  color: index === items.length - 1 ? '#ffd078' : '#dbf8ff',
                  fontSize: 29,
                  fontWeight: 750,
                }}
              >
                {item}{block.kind === 'flow' && index < items.length - 1 ? '  →' : ''}
              </div>
            ))}
          </div>
        );
      }
      if (block.kind === 'trend') {
        return (
          <div key={block.id} style={{...box, opacity, transform, padding: '30px 38px'}}>
            <div style={{fontSize: 24, color: '#a7c6d8'}}>{asText(props.label)}</div>
            <div style={{display: 'flex', alignItems: 'end', gap: 32, marginTop: 28}}>
              <strong style={{fontSize: 80, color: '#72e9f4'}}>{asText(props.from)}</strong>
              <span style={{fontSize: 58, color: '#ff818a'}}>↓</span>
              <strong style={{fontSize: 108, color: '#ff818a'}}>{asText(props.to)}</strong>
            </div>
          </div>
        );
      }
      return (
        <div key={block.id} style={{...box, opacity, transform, padding: '34px 42px', textAlign: 'center'}}>
          <div style={{fontSize: 24, color: '#ff9aa0', letterSpacing: 3}}>{asText(props.label, '重点引用')}</div>
          <div style={{fontSize: 43, lineHeight: 1.45, fontWeight: 800, color: '#f7fbff', marginTop: 18}}>{asText(props.text)}</div>
        </div>
      );
    })}
  </div>
);
