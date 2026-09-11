import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';

type Accent = 'red' | 'cyan' | 'amber' | 'green';

type Metric = {
  label: string;
  value: string;
  note: string;
  accent: Accent;
  cue: number;
};

type CaptionCue = { text: string; from: number; until: number };

type Scene = {
  id: string;
  chapter: string;
  eyebrow: string;
  headline: string;
  takeaway: string;
  frames: number;
  visual: 'hook' | 'contrast' | 'ratio' | 'technology' | 'construction' | 'cash' | 'efficiency' | 'capex' | 'inventory' | 'checklist';
  metrics: Metric[];
  visualCues: number[];
  captions: CaptionCue[];
};

const colors: Record<Accent, string> = {
  red: '#ff4f70',
  cyan: '#36dff2',
  amber: '#f7b84b',
  green: '#57d6a2',
};

const scenes: Scene[] = [
  {
    id: '01',
    chapter: '异常信号',
    eyebrow: '金麒麟 · Q2 财报解读',
    headline: '利润收缩，钱为什么还在往外花？',
    takeaway: '三个反常数字，同时出现',
    frames: 469,
    visual: 'hook',
    metrics: [
      { label: '营业收入', value: '−14.8%', note: '规模收缩', accent: 'red', cue: 0.3 },
      { label: '归母净利润', value: '−73.1%', note: '利润承压', accent: 'red', cue: 3.1 },
      { label: '研发费用率', value: '+1.02pct', note: '逆势上升', accent: 'cyan', cue: 6.2 },
    ],
    visualCues: [0.3, 6.2, 12.6],
    captions: [
      { text: '营收降了 14.8%', from: 0.3, until: 2.9 },
      { text: '净利跌了 73.1%', from: 3.1, until: 5.8 },
      { text: '研发费用率却涨了一个百分点', from: 6.2, until: 8.8 },
      { text: '在建工程飙升 139.6%', from: 9.1, until: 12.0 },
      { text: '利润收缩，钱为什么还在往外花？', from: 12.6, until: 15.3 },
    ],
  },
  {
    id: '02',
    chapter: '核心矛盾',
    eyebrow: '国内汽车刹车片龙头',
    headline: '一边利润几乎清零，一边研发建厂加速',
    takeaway: '市占率 15%–20%，正在押注下一阶段',
    frames: 446,
    visual: 'contrast',
    metrics: [
      { label: '市场位置', value: '15%–20%', note: '国内龙头', accent: 'cyan', cue: 3.2 },
      { label: '账本左侧', value: '利润↓', note: '当期压力', accent: 'red', cue: 6.3 },
      { label: '账本右侧', value: '投入↑', note: '研发 · 建厂', accent: 'amber', cue: 9.5 },
    ],
    visualCues: [6.3, 9.5, 12.3],
    captions: [
      { text: '金麒麟，国内汽车刹车片龙头', from: 0.4, until: 3.0 },
      { text: '市占率 15% 到 20%', from: 3.2, until: 5.8 },
      { text: '一边是利润几乎清零', from: 6.3, until: 8.9 },
      { text: '一边是研发建厂加速花钱', from: 9.5, until: 11.9 },
      { text: '两个相反的方向，到底指向什么？', from: 12.3, until: 14.5 },
    ],
  },
  {
    id: '03',
    chapter: '研发投入',
    eyebrow: '研发费用率 · Q2',
    headline: '营收下降，研发费用却不降反增',
    takeaway: '研发费用率被动抬升，但方向比数字更重要',
    frames: 494,
    visual: 'ratio',
    metrics: [
      { label: '研发费用率', value: '4.32%', note: 'Q2', accent: 'cyan', cue: 3.6 },
      { label: '同比变化', value: '+1.02pct', note: '费用率上升', accent: 'green', cue: 6.7 },
      { label: '营业收入', value: '−14.8%', note: '分母收缩', accent: 'red', cue: 11.7 },
    ],
    visualCues: [3.6, 11.7, 14.0],
    captions: [
      { text: '先看研发费用率', from: 0.4, until: 3.3 },
      { text: '二季度是 4.32%', from: 3.6, until: 6.3 },
      { text: '同比提升 1.02 个百分点', from: 6.7, until: 9.0 },
      { text: '单看好像也没有很高', from: 9.3, until: 11.4 },
      { text: '但营收降了 14.8%', from: 11.7, until: 13.7 },
      { text: '研发费用却不降反增', from: 14.0, until: 16.1 },
    ],
  },
  {
    id: '04',
    chapter: '技术转型',
    eyebrow: '产品路线切换',
    headline: '从液压制动，转向电子刹车与线控制动',
    takeaway: '技术窗口只剩 2–3 年，Q3 看主机厂定点',
    frames: 757,
    visual: 'technology',
    metrics: [
      { label: '旧路线', value: '液压制动', note: '传统产品', accent: 'cyan', cue: 4.1 },
      { label: '新路线', value: '电子刹车', note: '线控制动', accent: 'green', cue: 7.8 },
      { label: '验证节点', value: 'Q3', note: '主机厂定点', accent: 'amber', cue: 22.4 },
    ],
    visualCues: [4.1, 7.8, 12.5, 22.4],
    captions: [
      { text: '盘式刹车片正在转型', from: 0.5, until: 3.7 },
      { text: '从传统液压制动', from: 4.1, until: 7.2 },
      { text: '向电子刹车和线控制动转型', from: 7.8, until: 11.9 },
      { text: '技术窗口只剩 2 到 3 年', from: 12.5, until: 15.0 },
      { text: '上半年费用增长大概率投向这里', from: 15.3, until: 18.8 },
      { text: '投错方向，就是方向性浪费', from: 19.2, until: 22.0 },
      { text: 'Q3 关键看主机厂定点', from: 22.4, until: 24.9 },
    ],
  },
  {
    id: '05',
    chapter: '产能建设',
    eyebrow: '在建工程',
    headline: '营收和利润萎缩，新工厂仍在推进',
    takeaway: '今天的 Capex，对应 2027–2028 的供给能力',
    frames: 528,
    visual: 'construction',
    metrics: [
      { label: '在建工程', value: '0.4 亿', note: '期末规模', accent: 'amber', cue: 2.5 },
      { label: '同比增速', value: '+139.6%', note: '投入加速', accent: 'amber', cue: 5.0 },
      { label: '产能周期', value: '1–2 年', note: '未来供给', accent: 'cyan', cue: 11.5 },
    ],
    visualCues: [2.5, 8.3, 14.4],
    captions: [
      { text: '再看在建工程', from: 0.3, until: 2.2 },
      { text: '0.4 亿', from: 2.5, until: 4.5 },
      { text: '同比涨 139.6%', from: 5.0, until: 7.8 },
      { text: '营收和利润萎缩，新工厂仍在推进', from: 8.3, until: 11.1 },
      { text: '产能周期 1 到 2 年', from: 11.5, until: 14.0 },
      { text: '对应 2027 到 2028 年的供给能力', from: 14.4, until: 17.2 },
    ],
  },
  {
    id: '06',
    chapter: '现金流',
    eyebrow: '转型的底线',
    headline: '份额提升的前提，是现金流撑到需求回暖',
    takeaway: '不只看钱花了多少，更要看钱从哪里来',
    frames: 583,
    visual: 'cash',
    metrics: [
      { label: '行业洗牌', value: '份额↑', note: '龙头机会', accent: 'green', cue: 4.5 },
      { label: '自有现金', value: '安全垫', note: '正在消耗', accent: 'cyan', cue: 15.8 },
      { label: '新增借款', value: '杠杆', note: '融资来源', accent: 'amber', cue: 17.8 },
    ],
    visualCues: [4.5, 15.8, 17.8],
    captions: [
      { text: '技术转型会淘汰跟不上的小厂', from: 0.4, until: 4.1 },
      { text: '活下来的龙头份额会更高', from: 4.5, until: 7.5 },
      { text: '前提是现金流能撑到需求回暖', from: 7.9, until: 10.9 },
      { text: '不要只看在建工程是否继续涨', from: 11.3, until: 13.7 },
      { text: '更要看钱从哪来', from: 14.0, until: 15.4 },
      { text: '自有现金在消耗安全垫', from: 15.8, until: 17.5 },
      { text: '新增借款再加杠杆', from: 17.8, until: 19.1 },
    ],
  },
  {
    id: '07',
    chapter: '资产效率',
    eyebrow: '固定资产周转率',
    headline: '周转率 1.53 次，仍在正常区间下沿',
    takeaway: '若 Q3 营收回到 4.5 亿以上，效率将自然修复',
    frames: 691,
    visual: 'efficiency',
    metrics: [
      { label: '周转率', value: '1.53 次', note: '正常区间下沿', accent: 'cyan', cue: 2.4 },
      { label: '参考区间', value: '1.5–3.0', note: '行业正常', accent: 'green', cue: 7.5 },
      { label: 'Q3 目标', value: '4.5 亿+', note: '营收修复', accent: 'amber', cue: 18.4 },
    ],
    visualCues: [2.4, 7.5, 18.4],
    captions: [
      { text: '再从行业角度看几个数据', from: 0.4, until: 2.1 },
      { text: '固定资产周转率 1.53 次', from: 2.4, until: 4.7 },
      { text: '在行业正常区间', from: 5.0, until: 7.2 },
      { text: '处在 1.5 到 3.0 次的下沿', from: 7.5, until: 9.8 },
      { text: '营收下降是主因', from: 10.2, until: 12.8 },
      { text: '说明在主动削减低效产能', from: 14.6, until: 17.9 },
      { text: 'Q3 营收回到 4.5 亿以上', from: 18.4, until: 20.9 },
      { text: '周转率将自然修复', from: 21.2, until: 22.7 },
    ],
  },
  {
    id: '08',
    chapter: '资本开支',
    eyebrow: 'Capex 强度',
    headline: '65.6% 仍在安全范围，但要防转固冲击',
    takeaway: '在建工程转固后，折旧与闲置产能可能同时到来',
    frames: 626,
    visual: 'capex',
    metrics: [
      { label: 'Capex 强度', value: '65.6%', note: '当前安全', accent: 'green', cue: 0.4 },
      { label: '风险阈值', value: '80%+', note: '转固后警惕', accent: 'red', cue: 14.7 },
      { label: '关键节点', value: '转 固', note: 'Q3 关注', accent: 'amber', cue: 19.0 },
    ],
    visualCues: [2.3, 9.1, 14.7, 19.0],
    captions: [
      { text: 'Capex 强度 65.6%', from: 0.4, until: 2.0 },
      { text: '每赚一块钱，对应六毛五的机器设备', from: 2.3, until: 5.4 },
      { text: '目前仍在安全范围', from: 5.8, until: 8.6 },
      { text: '但在建工程大规模转固，营收又跟不上', from: 11.3, until: 14.2 },
      { text: '强度可能跳升到 80% 以上', from: 14.7, until: 16.2 },
      { text: '折旧和产能闲置会同时冲击报表', from: 16.5, until: 18.7 },
      { text: 'Q3 关注在建工程转固时间节点', from: 19.0, until: 20.4 },
    ],
  },
  {
    id: '09',
    chapter: '存货质量',
    eyebrow: '库存与跌价准备',
    headline: '存货营收比 44.8%，当前仍在正常区间',
    takeaway: '钢价继续下行时，重点看原材料跌价准备',
    frames: 541,
    visual: 'inventory',
    metrics: [
      { label: '存货营收比', value: '44.8%', note: '正常区间', accent: 'cyan', cue: 2.6 },
      { label: '库存结构', value: '原材料', note: '订单生产', accent: 'green', cue: 10.0 },
      { label: '风险观察', value: '跌价准备', note: '钢价下行', accent: 'amber', cue: 16.3 },
    ],
    visualCues: [2.6, 10.0, 16.3],
    captions: [
      { text: '最后是存货', from: 0.3, until: 2.2 },
      { text: '存货营收比 44.8%', from: 2.6, until: 4.6 },
      { text: '仍在正常区间', from: 5.0, until: 6.8 },
      { text: '刹车片按订单生产', from: 7.2, until: 9.5 },
      { text: '库存以原材料为主', from: 10.0, until: 11.8 },
      { text: '产成品积压风险不高', from: 12.2, until: 13.9 },
      { text: '钢价继续下行，要看跌价准备', from: 14.2, until: 17.6 },
    ],
  },
  {
    id: '10',
    chapter: 'Q3 清单',
    eyebrow: '下一份财报，看五个点',
    headline: '别只盯利润表，验证这五个变化',
    takeaway: '财报揭秘室 · 拆解关键信号',
    frames: 553,
    visual: 'checklist',
    metrics: [
      { label: '电子刹车', value: '定点 / 扩产', note: '研发兑现', accent: 'green', cue: 4.0 },
      { label: '资金来源', value: '现金 / 借款', note: '安全边际', accent: 'cyan', cue: 6.5 },
      { label: '其他节点', value: '4.5 亿 · 转固 · 存货', note: 'Q3 验证', accent: 'amber', cue: 9.0 },
    ],
    visualCues: [4.0, 6.5, 9.0, 11.8, 14.0],
    captions: [
      { text: '综合来看，Q3 要盯五个点', from: 0.4, until: 2.1 },
      { text: '主机厂电子刹车定点扩产', from: 4.0, until: 6.0 },
      { text: '资金来源结构', from: 6.5, until: 8.5 },
      { text: '营收是否回到 4.5 亿以上', from: 9.0, until: 11.4 },
      { text: '在建工程转固节点', from: 11.8, until: 13.6 },
      { text: '存货跌价准备变化', from: 14.0, until: 15.6 },
      { text: '每期三分钟，拆解财报里的关键信号', from: 16.2, until: 18.1 },
    ],
  },
];

export const FINANCE_DURATION_FRAMES = scenes.reduce((total, scene) => total + scene.frames, 0);
const sceneStarts = scenes.reduce<number[]>((starts, scene) => {
  starts.push(starts.length === 0 ? 0 : starts[starts.length - 1] + scenes[starts.length - 1].frames);
  return starts;
}, []);

const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const pop = (frame: number, delay: number) => interpolate(frame, [delay, delay + 16], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});

const cueFrame = (seconds: number) => Math.round(seconds * 30);

const Cue: React.FC<{ from: number; children: React.ReactNode; distance?: number }> = ({ from, children, distance = 22 }) => {
  const frame = useCurrentFrame();
  const progress = pop(frame, cueFrame(from));
  return <div style={{ opacity: progress, transform: `translateY(${(1 - progress) * distance}px)` }}>{children}</div>;
};

const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const shift = (frame % 180) * 0.45;
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#050b18' }}>
      <AbsoluteFill
        style={{
          opacity: 0.55,
          backgroundImage:
            'linear-gradient(rgba(72, 108, 158, 0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(72, 108, 158, 0.12) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          backgroundPosition: `${shift}px ${shift * 0.35}px`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 8% 100%, rgba(22, 77, 154, 0.55), transparent 35%), radial-gradient(circle at 94% 10%, rgba(0, 161, 188, 0.34), transparent 29%), radial-gradient(circle at 50% 50%, rgba(31, 44, 100, 0.24), transparent 54%)',
        }}
      />
      <div style={{ position: 'absolute', inset: 0, boxShadow: 'inset 0 0 180px rgba(0,0,0,0.75)' }} />
    </AbsoluteFill>
  );
};

const MetricCard: React.FC<{ metric: Metric }> = ({ metric }) => {
  const frame = useCurrentFrame();
  const progress = pop(frame, cueFrame(metric.cue));
  const accent = colors[metric.accent];
  return (
    <div
      style={{
        flex: 1,
        minHeight: 188,
        padding: '26px 30px',
        borderRadius: 22,
        border: `1px solid ${accent}80`,
        background: 'linear-gradient(135deg, rgba(18,31,60,0.95), rgba(8,14,32,0.84))',
        boxShadow: `0 0 28px ${accent}24, inset 0 1px 0 rgba(255,255,255,0.05)`,
        opacity: progress,
        transform: `translateY(${(1 - progress) * 36}px) scale(${0.94 + progress * 0.06})`,
      }}
    >
      <div style={{ color: '#a8b7d3', fontSize: 25, letterSpacing: 1 }}>{metric.label}</div>
      <div style={{ color: accent, fontSize: 60, fontWeight: 800, lineHeight: 1.15, marginTop: 12 }}>{metric.value}</div>
      <div style={{ color: '#dce6f8', fontSize: 22, marginTop: 12 }}>{metric.note}</div>
    </div>
  );
};

const LineChart: React.FC<{ color: string; values: number[]; second?: number[]; from: number }> = ({ color, values, second, from }) => {
  const frame = useCurrentFrame();
  const drawStart = cueFrame(from);
  const draw = interpolate(frame, [drawStart, drawStart + 120], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const toPoint = (value: number, index: number) => `${80 + index * 175},${315 - value * 2.35}`;
  const points = values.map(toPoint).join(' ');
  const secondPoints = second?.map(toPoint).join(' ');
  return (
    <svg width="100%" height="360" viewBox="0 0 900 360" style={{ overflow: 'visible' }}>
      {[60, 130, 200, 270, 340].map((y) => <line key={y} x1="58" y1={y} x2="830" y2={y} stroke="rgba(151,178,224,0.13)" strokeWidth="1" />)}
      <polyline points={points} fill="none" stroke={color} strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - draw} />
      {secondPoints && <polyline points={secondPoints} fill="none" stroke="#ff4f70" strokeWidth="5" strokeDasharray="10 11" strokeLinejoin="round" pathLength="1" strokeDashoffset={1 - draw} />}
      {values.map((value, index) => <circle key={index} cx={80 + index * 175} cy={315 - value * 2.35} r="8" fill={color} opacity={draw} />)}
      {['Q4', 'Q1', 'Q2', 'Q3', 'Q4'].map((label, index) => <text key={label} x={80 + index * 175} y="350" fill="#8595b4" fontSize="20" textAnchor="middle" fontFamily={fontStack}>{label}</text>)}
    </svg>
  );
};

const VisualPanel: React.FC<{ scene: Scene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const enter = pop(frame, cueFrame(scene.visualCues[0] ?? 0));
  const panelStyle: React.CSSProperties = {
    position: 'relative',
    height: 365,
    marginTop: 35,
    borderRadius: 28,
    border: '1px solid rgba(117, 148, 205, 0.30)',
    background: 'linear-gradient(135deg, rgba(14, 28, 62, 0.92), rgba(7, 14, 35, 0.82))',
    overflow: 'hidden',
    opacity: enter,
    transform: `translateY(${(1 - enter) * 24}px)`,
  };
  const glowStyle: React.CSSProperties = { position: 'absolute', inset: 0, background: 'radial-gradient(circle at 70% 0%, rgba(54,223,242,0.13), transparent 44%)' };
  if (scene.visual === 'hook' || scene.visual === 'contrast') {
    const isHook = scene.visual === 'hook';
    return (
      <div style={panelStyle}>
        <div style={glowStyle} />
        <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 85, padding: '0 70px' }}>
          <Cue from={scene.visualCues[0]}><div style={{ textAlign: 'right', width: 470 }}><div style={{ color: '#ff4f70', fontSize: 42, fontWeight: 800 }}>{isHook ? '规模收缩' : '利润承压'}</div><div style={{ color: '#dce6f8', fontSize: 26, marginTop: 18 }}>{isHook ? '营收先行下滑' : '向下的当期结果'}</div></div></Cue>
          <Cue from={scene.visualCues[2]}><div style={{ color: '#ff4f70', fontSize: 78, fontWeight: 800, textShadow: '0 0 24px #ff4f7099' }}>VS</div></Cue>
          <Cue from={scene.visualCues[1]}><div style={{ textAlign: 'left', width: 470 }}><div style={{ color: '#f7b84b', fontSize: 42, fontWeight: 800 }}>{isHook ? '研发投入' : '研发 · 建厂'}</div><div style={{ color: '#dce6f8', fontSize: 26, marginTop: 18 }}>{isHook ? '费用率逆势上升' : '向上的长期投入'}</div></div></Cue>
        </div>
      </div>
    );
  }
  if (scene.visual === 'ratio') return <div style={panelStyle}><div style={glowStyle} /><div style={{ padding: '12px 50px' }}><LineChart color="#36dff2" values={[46, 52, 59, 69, 78]} second={[58, 66, 73, 81, 88]} from={scene.visualCues[0]} /><Cue from={scene.visualCues[1]}><div style={{ position: 'absolute', right: 55, top: 35, color: '#ff4f70', fontSize: 23 }}>营收 ↓</div></Cue><Cue from={scene.visualCues[2]}><div style={{ position: 'absolute', right: 55, top: 75, color: '#36dff2', fontSize: 23 }}>研发费用率 ↑</div></Cue></div></div>;
  if (scene.visual === 'technology') {
    const arrow = interpolate(frame, [cueFrame(scene.visualCues[1]), cueFrame(scene.visualCues[1]) + 60], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return <div style={panelStyle}><div style={glowStyle} /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 50 }}><Cue from={scene.visualCues[0]}><div style={{ padding: '42px 56px', border: '1px solid #36dff280', borderRadius: 20, color: '#cde7ef', fontSize: 38 }}>传统液压制动</div></Cue><Cue from={scene.visualCues[1]}><div style={{ color: '#57d6a2', fontSize: 75, transform: `scaleX(${arrow})`, transformOrigin: 'left' }}>→</div></Cue><Cue from={scene.visualCues[1]}><div style={{ padding: '42px 56px', border: '1px solid #57d6a2', borderRadius: 20, color: '#fff', fontSize: 38, boxShadow: '0 0 34px #57d6a236' }}>电子刹车 / 线控制动</div></Cue></div><Cue from={scene.visualCues[2]}><div style={{ position: 'absolute', right: 48, bottom: 32, color: '#f7b84b', fontSize: 26, fontWeight: 700 }}>技术窗口：2–3 年</div></Cue></div>;
  }
  if (scene.visual === 'construction') return <div style={panelStyle}><div style={glowStyle} /><div style={{ padding: '10px 48px' }}><LineChart color="#f7b84b" values={[22, 32, 45, 64, 92]} from={scene.visualCues[0]} /><Cue from={scene.visualCues[1]}><div style={{ position: 'absolute', top: 48, right: 55, color: '#f7b84b', fontWeight: 800, fontSize: 36 }}>建设投入加速</div></Cue></div></div>;
  if (scene.visual === 'cash') return <div style={panelStyle}><div style={glowStyle} /><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', height: '100%', padding: '0 80px' }}><Cue from={scene.visualCues[0]}><FlowNode title="行业洗牌" desc="龙头份额上升" color="#57d6a2" /></Cue><Cue from={scene.visualCues[1]}><div style={{ color: '#cbd7ef', fontSize: 64 }}>→</div></Cue><Cue from={scene.visualCues[1]}><FlowNode title="自有现金" desc="消耗安全垫" color="#36dff2" /></Cue><Cue from={scene.visualCues[2]}><div style={{ color: '#cbd7ef', fontSize: 64 }}>＋</div></Cue><Cue from={scene.visualCues[2]}><FlowNode title="新增借款" desc="增加杠杆" color="#f7b84b" /></Cue></div></div>;
  if (scene.visual === 'efficiency') return <div style={panelStyle}><div style={glowStyle} /><div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 95 }}><Cue from={scene.visualCues[0]}><Gauge from={scene.visualCues[0]} /></Cue><Cue from={scene.visualCues[1]}><div><div style={{ color: '#dce6f8', fontSize: 28, letterSpacing: 2 }}>行业正常区间</div><div style={{ color: '#57d6a2', fontSize: 60, fontWeight: 800, marginTop: 14 }}>1.5 — 3.0 次</div><div style={{ color: '#9faccc', fontSize: 26, marginTop: 22 }}>当前处于下沿，等待营收修复</div></div></Cue></div><Cue from={scene.visualCues[2]}><div style={{ position: 'absolute', right: 48, bottom: 30, color: '#f7b84b', fontSize: 25, fontWeight: 700 }}>Q3 4.5 亿+ → 周转率修复</div></Cue></div>;
  if (scene.visual === 'capex') return <div style={panelStyle}><div style={glowStyle} /><ThresholdBar from={scene.visualCues[0]} thresholdFrom={scene.visualCues[2]} /></div>;
  if (scene.visual === 'inventory') return <div style={panelStyle}><div style={glowStyle} /><div style={{ padding: '10px 48px' }}><LineChart color="#36dff2" values={[57, 54, 50, 47, 45]} from={scene.visualCues[0]} /><Cue from={scene.visualCues[2]}><div style={{ position: 'absolute', top: 46, right: 52, color: '#f7b84b', fontSize: 28 }}>钢价下行 → 关注跌价准备</div></Cue></div></div>;
  return <div style={panelStyle}><div style={glowStyle} /><Checklist cues={scene.visualCues} /></div>;
};

const FlowNode: React.FC<{ title: string; desc: string; color: string }> = ({ title, desc, color }) => <div style={{ width: 255, padding: '30px 20px', borderRadius: 20, border: `1px solid ${color}99`, textAlign: 'center', background: 'rgba(10,20,45,0.72)', boxShadow: `0 0 25px ${color}24` }}><div style={{ color, fontSize: 31, fontWeight: 800 }}>{title}</div><div style={{ color: '#c4d0e9', fontSize: 22, marginTop: 13 }}>{desc}</div></div>;

const Gauge: React.FC<{ from: number }> = ({ from }) => {
  const frame = useCurrentFrame();
  const angle = interpolate(frame, [cueFrame(from), cueFrame(from) + 110], [-115, -6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <div style={{ width: 300, height: 190, border: '22px solid #1b315e', borderBottom: 0, borderRadius: '300px 300px 0 0', position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', width: 120, height: 9, background: '#36dff2', left: 92, bottom: 0, transformOrigin: 'left center', transform: `rotate(${angle}deg)`, boxShadow: '0 0 20px #36dff2' }} /><div style={{ position: 'absolute', color: '#fff', fontSize: 43, fontWeight: 800, bottom: 23, left: 72 }}>1.53</div></div>;
};

const ThresholdBar: React.FC<{ from: number; thresholdFrom: number }> = ({ from, thresholdFrom }) => {
  const frame = useCurrentFrame();
  const width = interpolate(frame, [cueFrame(from), cueFrame(from) + 90], [0, 65.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const threshold = pop(frame, cueFrame(thresholdFrom));
  return <div style={{ padding: '80px 110px' }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#b7c5df', fontSize: 26 }}><span>安全范围</span><span style={{ color: '#ff4f70', opacity: threshold }}>风险阈值 80%</span></div><div style={{ height: 62, borderRadius: 31, background: '#15264c', marginTop: 22, overflow: 'hidden', position: 'relative' }}><div style={{ height: '100%', width: `${width}%`, background: 'linear-gradient(90deg, #36dff2, #57d6a2)', borderRadius: 31, boxShadow: '0 0 28px #36dff278' }} /><div style={{ position: 'absolute', left: '80%', top: -11, bottom: -11, borderLeft: '4px dashed #ff4f70', opacity: threshold }} /></div><div style={{ marginTop: 24, color: '#57d6a2', fontWeight: 800, fontSize: 55 }}>65.6%</div></div>;
};

const Checklist: React.FC<{ cues: number[] }> = ({ cues }) => {
  const items = ['电子刹车定点与扩产', '资金来源结构', '营收能否回到 4.5 亿+', '在建工程转固节点', '存货跌价准备'];
  const frame = useCurrentFrame();
  return <div style={{ padding: '34px 70px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 40px' }}>{items.map((item, index) => { const done = pop(frame, cueFrame(cues[index] ?? cues[cues.length - 1])); return <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 17, opacity: done, transform: `translateX(${(1 - done) * 18}px)` }}><div style={{ width: 30, height: 30, borderRadius: 8, border: '2px solid #57d6a2', color: '#57d6a2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>✓</div><div style={{ color: '#e8eefb', fontSize: 27 }}>{item}</div></div>; })}</div>;
};

const LiveCaption: React.FC<{ captions: CaptionCue[] }> = ({ captions }) => {
  const frame = useCurrentFrame();
  const seconds = frame / 30;
  const active = captions.find((caption) => seconds >= caption.from && seconds < caption.until);
  if (!active) return null;
  const progress = pop(frame, cueFrame(active.from));
  return <div style={{ position: 'absolute', left: 110, right: 110, bottom: 132, textAlign: 'center', color: '#eff4ff', fontSize: 40, fontWeight: 700, opacity: progress, transform: `translateY(${(1 - progress) * 14}px)`, textShadow: '0 3px 18px rgba(0,0,0,0.7)' }}>{active.text}</div>;
};

const Progress: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const progress = ((sceneStarts[index] + frame) / FINANCE_DURATION_FRAMES) * 100;
  return <div style={{ position: 'absolute', left: 70, right: 70, bottom: 45, fontFamily: fontStack }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#8292b2', fontSize: 17, letterSpacing: 1.5 }}><span>财报揭秘室 · 金麒麟 Q2</span><span>{String(index + 1).padStart(2, '0')} / 10</span></div><div style={{ marginTop: 14, height: 4, background: 'rgba(137,157,197,0.26)', borderRadius: 4 }}><div style={{ height: '100%', width: `${progress}%`, background: '#ff4f70', boxShadow: '0 0 12px #ff4f70', borderRadius: 4 }} /></div></div>;
};

const FinanceScene: React.FC<{ scene: Scene; index: number }> = ({ scene, index }) => {
  const frame = useCurrentFrame();
  const title = pop(frame, cueFrame(scene.captions[0].from));
  const titleExit = interpolate(frame, [scene.frames - 22, scene.frames], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.quad) });
  return <AbsoluteFill style={{ fontFamily: fontStack }}><GridBackground /><div style={{ position: 'absolute', top: 50, left: 70, color: '#f0f4ff', fontSize: 27, fontWeight: 800, letterSpacing: 1 }}>财报<span style={{ color: '#ff4f70' }}>｜</span>揭秘室</div><div style={{ position: 'absolute', top: 53, right: 70, color: '#7f91b3', fontSize: 18, letterSpacing: 2 }}>AI FINANCIAL DECODER</div><div style={{ position: 'absolute', top: 116, left: 70, right: 70, height: 1, background: 'linear-gradient(90deg, #ff4f70 0 18%, rgba(255,255,255,0.15) 18% 100%)' }} /><div style={{ position: 'absolute', left: 115, right: 115, top: 165, opacity: title * titleExit }}><div style={{ color: colors[scene.metrics[0].accent], fontSize: 24, fontWeight: 700, letterSpacing: 4 }}>{scene.id} · {scene.chapter}</div><div style={{ color: '#9aaccc', fontSize: 23, marginTop: 12 }}>{scene.eyebrow}</div><div style={{ color: '#f5f8ff', maxWidth: 1440, fontSize: 56, lineHeight: 1.22, fontWeight: 800, marginTop: 23, letterSpacing: 1 }}>{scene.headline}</div><div style={{ display: 'flex', gap: 24, marginTop: 40 }}>{scene.metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}</div><VisualPanel scene={scene} /></div><LiveCaption captions={scene.captions} /><Progress index={index} /></AbsoluteFill>;
};

export const FinancialReportPreview: React.FC = () => {
  let start = 0;
  return <AbsoluteFill style={{ backgroundColor: '#050b18' }}><Audio src={staticFile('audio/financial-report-narration.mp3')} />{scenes.map((scene, index) => { const currentStart = start; start += scene.frames; return <Sequence key={scene.id} from={currentStart} durationInFrames={scene.frames}><FinanceScene scene={scene} index={index} /></Sequence>; })}</AbsoluteFill>;
};
