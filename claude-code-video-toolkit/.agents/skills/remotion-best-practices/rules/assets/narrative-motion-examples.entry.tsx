import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame} from 'remotion';
import {DataChange, LayoutReflow, RelationshipDiagram} from './narrative-motion-examples';

/** 教学数据，非本期事实；窗口长短只改变动作安排，不生成等待或循环。 */
const TeachingScene: React.FC<{windowFrames: number}> = ({windowFrames}) => {
  const frame = useCurrentFrame();
  const start = Math.round(windowFrames * 0.12), complete = Math.round(windowFrames * 0.64);
  const labelStyle = {fontSize: 26, color: '#f1f4fa', margin: '0 0 20px'};
  const panel: React.CSSProperties = {boxSizing: 'border-box', width: 388, height: 420, padding: 12,
    border: '1px solid #354253', borderRadius: 16};
  return <AbsoluteFill style={{backgroundColor: '#0c1420', padding: 36,
    fontFamily: 'PingFang SC, Noto Sans CJK SC, sans-serif'}}>
    <h1 style={{fontSize: 36, color: '#f1f4fa', margin: '0 0 12px'}}>从内容关系生成运动 · 教学数据</h1>
    <div style={{color: '#8f9bad', fontSize: 22, marginBottom: 36}}>短窗口合并动作，长窗口保留读图；完成后稳定展示</div>
    <div style={{display: 'flex', gap: 20}}>
      <section style={panel}><h2 style={labelStyle}>同尺度数值变化</h2>
        <DataChange frame={frame} startFrame={start} completeFrame={complete} width={360} height={300}
          label="处理量" fromValue={120} toValue={180} range={[0, 240]} unit="件／小时" />
      </section>
      <section style={panel}><h2 style={labelStyle}>连接与重点逐步建立</h2>
        <RelationshipDiagram frame={frame} width={360} height={300} fontSize={22} nodes={[
          {id: 'input', label: '输入', x: 10, y: 20, width: 100, height: 60, startFrame: 0, completeFrame: start},
          {id: 'process', label: '处理', x: 220, y: 20, width: 110, height: 60, startFrame: start, completeFrame: Math.round(windowFrames * 0.32)},
          {id: 'result', label: '结果', x: 220, y: 200, width: 110, height: 60, startFrame: Math.round(windowFrames * 0.32), completeFrame: complete},
        ]} edges={[
          {id: 'a', fromId: 'input', toId: 'process', startFrame: start, completeFrame: Math.round(windowFrames * 0.32)},
          {id: 'b', fromId: 'process', toId: 'result', startFrame: Math.round(windowFrames * 0.32), completeFrame: complete},
        ]} emphasis={[{nodeId: 'input', frame: 0}, {nodeId: 'process', frame: start}, {nodeId: 'result', frame: Math.round(windowFrames * 0.32)}]} />
      </section>
      <section style={panel}><h2 style={labelStyle}>同一对象连续重排</h2>
        <LayoutReflow frame={frame} startFrame={start} completeFrame={complete} width={360} height={300}
          items={[
            {id: 'a', label: '对象 A', from: {x: 100, y: 25, width: 140, height: 70}, to: {x: 20, y: 25, width: 300, height: 70}},
            {id: 'b', label: '对象 B', color: '#f0b965', from: {x: 20, y: 175, width: 140, height: 70}, to: {x: 20, y: 125, width: 140, height: 70}},
            {id: 'c', label: '对象 C', color: '#dc7285', from: {x: 180, y: 175, width: 140, height: 70}, to: {x: 180, y: 225, width: 140, height: 70}},
          ]} />
      </section>
    </div>
    <div style={{color: '#8f9bad', fontSize: 20, marginTop: 32}}>这些组件提供计算方法；对象、布局、数据与触发点由本期口播决定。</div>
  </AbsoluteFill>;
};

export const NarrativeMotionExamplesRoot: React.FC = () => <>
  <Composition id="NarrativeShort" component={TeachingScene} durationInFrames={54} fps={30} width={1280} height={720}
    defaultProps={{windowFrames: 54}} />
  <Composition id="NarrativeLong" component={TeachingScene} durationInFrames={162} fps={30} width={1280} height={720}
    defaultProps={{windowFrames: 162}} />
</>;

registerRoot(NarrativeMotionExamplesRoot);
