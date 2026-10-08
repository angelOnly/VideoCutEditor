import React from 'react';

/** 所有 frame 均为组件局部帧；调用方根据真实口播传入动作窗口。 */
export type MotionWindow = {startFrame: number; completeFrame: number};
export type Point = {x: number; y: number};
export type MotionTheme = {
  fontFamily?: string;
  fontSize?: number;
  foreground?: string;
  muted?: string;
  accent?: string;
};

const themeDefaults = {
  fontFamily: 'PingFang SC, Noto Sans CJK SC, sans-serif',
  fontSize: 24,
  foreground: '#f1f4fa',
  muted: '#8f9bad',
  accent: '#59d5cd',
};

export const motionProgress = (frame: number, window: MotionWindow): number => {
  if (![frame, window.startFrame, window.completeFrame].every(Number.isFinite) ||
      window.completeFrame < window.startFrame) throw new Error('动作窗口必须有限且有序');
  // 即时变化没有插值区间；开始前保持原态，开始后直接到终态。
  if (window.completeFrame === window.startFrame) return frame < window.startFrame ? 0 : 1;
  return Math.max(0, Math.min(1, (frame - window.startFrame) / (window.completeFrame - window.startFrame)));
};

export type DataChangeProps = MotionTheme & MotionWindow & {
  frame: number;
  width: number;
  height: number;
  label: string;
  fromValue: number;
  toValue: number;
  range: [number, number];
  unit: string;
  precision?: number;
};

export const dataChangeState = (p: DataChangeProps) => {
  const [min, max] = p.range;
  if (![min, max, p.fromValue, p.toValue, p.width, p.height].every(Number.isFinite) ||
      min >= max || min > 0 || max < 0 || p.width < 180 || p.height < 140 ||
      p.fromValue < min || p.fromValue > max || p.toValue < min || p.toValue > max) {
    throw new Error('数据范围须包含零点与真实端点，尺寸须足够展示标签');
  }
  const progress = motionProgress(p.frame, p);
  const value = p.fromValue + (p.toValue - p.fromValue) * progress;
  const position = (n: number) => 32 + (n - min) / (max - min) * (p.width - 64);
  return {progress, value, zero: position(0), point: position(value), oldPoint: position(p.fromValue)};
};

/** 同一个 value 同时驱动数值和长度；负数、零值也使用同一尺度。 */
export const DataChange: React.FC<DataChangeProps> = (p) => {
  const t = {...themeDefaults, ...p};
  const s = dataChangeState(p);
  const y = p.height * 0.48;
  return <svg width={p.width} height={p.height} style={{fontFamily: t.fontFamily}}>
    <text x={32} y={36} fill={t.foreground} fontSize={t.fontSize}>{p.label}</text>
    <line x1={32} x2={p.width - 32} y1={y + 64} y2={y + 64} stroke={t.muted} />
    <line x1={s.zero} x2={s.zero} y1={y - 14} y2={y + 72} stroke={t.muted} strokeDasharray="4 6" />
    <rect x={Math.min(s.zero, s.oldPoint)} y={y} width={Math.abs(s.oldPoint - s.zero)} height={48}
      fill="none" stroke={t.muted} strokeDasharray="5 5" />
    <rect x={Math.min(s.zero, s.point)} y={y} width={Math.abs(s.point - s.zero)} height={48} fill={t.accent} />
    <circle cx={s.point} cy={y + 24} r={5} fill={t.foreground} />
    <text x={32} y={y - 28} fill={t.foreground} fontSize={t.fontSize * 1.5}
      style={{fontVariantNumeric: 'tabular-nums'}}>{s.value.toFixed(p.precision ?? 0)} {p.unit}</text>
    <text x={32} y={y + 100} fill={t.muted} fontSize={t.fontSize * 0.7}>{p.range[0]}</text>
    <text x={p.width - 32} y={y + 100} textAnchor="end" fill={t.muted} fontSize={t.fontSize * 0.7}>{p.range[1]} {p.unit}</text>
  </svg>;
};

export type DiagramNode = Point & MotionWindow & {id: string; label: string; width: number; height: number};
export type DiagramEdge = MotionWindow & {
  id: string;
  fromId: string;
  toId: string;
  /** 中间折点可省略；首尾连接点自动从节点边缘计算。 */
  via?: Point[];
  directed?: boolean;
};

const boundaryPoint = (node: DiagramNode, toward: Point): Point => {
  const center = {x: node.x + node.width / 2, y: node.y + node.height / 2};
  const dx = toward.x - center.x, dy = toward.y - center.y;
  const factor = Math.max(Math.abs(dx) / (node.width / 2), Math.abs(dy) / (node.height / 2));
  if (factor === 0) throw new Error('关系节点不能使用重合中心');
  return {x: center.x + dx / factor, y: center.y + dy / factor};
};

export const connectionPoints = (edge: DiagramEdge, nodes: DiagramNode[]): Point[] => {
  const from = nodes.find(n => n.id === edge.fromId), to = nodes.find(n => n.id === edge.toId);
  if (!from || !to) throw new Error('连接引用了不存在的节点');
  const via = edge.via ?? [];
  const a = {x: from.x + from.width / 2, y: from.y + from.height / 2};
  const b = {x: to.x + to.width / 2, y: to.y + to.height / 2};
  return [boundaryPoint(from, via[0] ?? b), ...via, boundaryPoint(to, via[via.length - 1] ?? a)];
};

export const pointAlongPath = (points: Point[], progress: number) => {
  const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
  const total = lengths.reduce((a, b) => a + b, 0);
  if (!total) throw new Error('连接路径长度必须大于零');
  let remaining = total * Math.max(0, Math.min(1, progress));
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const ratio = lengths[i] ? remaining / lengths[i] : 0;
      const from = points[i], to = points[i + 1];
      return {x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio,
        angle: Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI};
    }
    remaining -= lengths[i];
  }
  throw new Error('连接路径为空');
};

export type RelationshipDiagramProps = MotionTheme & {
  frame: number;
  width: number;
  height: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  emphasis: {nodeId: string; frame: number}[];
};

/** 箭头与描线共用弧长进度，不提前出现在终点；已出现节点一直保留。 */
export const RelationshipDiagram: React.FC<RelationshipDiagramProps> = (p) => {
  const t = {...themeDefaults, ...p};
  if (new Set(p.nodes.map(n => n.id)).size !== p.nodes.length) throw new Error('节点 ID 必须唯一');
  const active = p.emphasis.filter(e => e.frame <= p.frame).at(-1)?.nodeId;
  return <svg width={p.width} height={p.height} style={{fontFamily: t.fontFamily}}>
    {p.edges.map(edge => {
      const progress = motionProgress(p.frame, edge);
      const points = connectionPoints(edge, p.nodes);
      const tip = pointAlongPath(points, progress);
      return <g key={edge.id} opacity={progress > 0 ? 1 : 0}>
        <polyline points={points.map(n => `${n.x},${n.y}`).join(' ')} pathLength={1}
          fill="none" stroke={t.accent} strokeWidth={3} strokeDasharray={1} strokeDashoffset={1 - progress} />
        {edge.directed !== false && <path d="M -10 -6 L 0 0 L -10 6" fill="none" stroke={t.accent} strokeWidth={3}
          transform={`translate(${tip.x} ${tip.y}) rotate(${tip.angle})`} />}
      </g>;
    })}
    {p.nodes.map(node => {
      const progress = motionProgress(p.frame, node);
      return <g key={node.id} opacity={progress} transform={`translate(${node.x} ${node.y})`}>
        <rect width={node.width} height={node.height} rx={12} fill={active === node.id ? '#203c44' : '#172130'}
          stroke={active === node.id ? t.accent : t.muted} strokeWidth={active === node.id ? 3 : 1} />
        <text x={node.width / 2} y={node.height / 2} textAnchor="middle" dominantBaseline="middle"
          fontSize={t.fontSize} fill={t.foreground}>{node.label}</text>
      </g>;
    })}
  </svg>;
};

export type LayoutBox = Point & {width: number; height: number};
export type LayoutItem = {id: string; label: string; color?: string; from: LayoutBox; to: LayoutBox};
export type LayoutReflowProps = MotionTheme & MotionWindow & {
  frame: number;
  width: number;
  height: number;
  items: LayoutItem[];
};

export const interpolateBox = (from: LayoutBox, to: LayoutBox, progress: number): LayoutBox => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
  width: from.width + (to.width - from.width) * progress,
  height: from.height + (to.height - from.height) * progress,
});

/** 相同 key 持续存在，标签跟随中心与尺寸；布局由本期设计传入。 */
export const LayoutReflow: React.FC<LayoutReflowProps> = (p) => {
  const t = {...themeDefaults, ...p};
  const progress = motionProgress(p.frame, p);
  if (new Set(p.items.map(n => n.id)).size !== p.items.length) throw new Error('重排对象 ID 必须唯一');
  return <svg width={p.width} height={p.height} style={{fontFamily: t.fontFamily}}>
    {p.items.map(item => {
      const box = interpolateBox(item.from, item.to, progress);
      return <g key={item.id} transform={`translate(${box.x} ${box.y})`}>
        <rect width={box.width} height={box.height} rx={14} fill="#172130" stroke={item.color ?? t.accent} strokeWidth={2} />
        <text x={box.width / 2} y={box.height / 2} dominantBaseline="middle" textAnchor="middle"
          fill={t.foreground} fontSize={t.fontSize}>{item.label}</text>
      </g>;
    })}
  </svg>;
};
