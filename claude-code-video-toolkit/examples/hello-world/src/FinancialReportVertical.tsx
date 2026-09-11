import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import timingSource from '../public/audio/financial-vertical-v1/timeline.json';

type Chapter = 'opening' | 'research' | 'factory' | 'cash' | 'metrics' | 'risk' | 'signals' | 'closing';
type Utterance = {
  id: string;
  role: 'male';
  chapter: Chapter;
  text: string;
  file: string;
  start_seconds: number;
  duration_seconds: number;
  start_frame: number;
  duration_frames: number;
};

const timing = timingSource as unknown as {
  fps: number;
  total_frames: number;
  total_seconds: number;
  utterances: Utterance[];
};

const fps = 30;
export const FINANCIAL_VERTICAL_DURATION_FRAMES = timing.total_frames;
const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const appear = (frame: number, start = 0, duration = 16) => interpolate(frame, [start, start + duration], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});

const inRange = (frame: number, start: number, end: number) => interpolate(frame, [start, end], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
});

const chapterMeta: Record<Chapter, { step: string; name: string; color: string }> = {
  opening: { step: '01', name: '异常数字', color: '#ef565c' },
  research: { step: '02', name: '研发验证', color: '#56d5ee' },
  factory: { step: '03', name: '产能赌注', color: '#f5bf55' },
  cash: { step: '04', name: '资金来源', color: '#67d7a5' },
  metrics: { step: '05', name: '三张压力表', color: '#56d5ee' },
  risk: { step: '06', name: '风险阈值', color: '#ef565c' },
  signals: { step: '07', name: 'Q3 验证', color: '#f5bf55' },
  closing: { step: '08', name: '结论', color: '#ef565c' },
};

const conclusions: Record<string, string> = {
  '01-hook-revenue': '营收降 14.8%，净利跌 73.1%',
  '02-hook-investment': '研发和建厂，却在同步加速',
  '03-hook-question': '钱为什么还在往外投？',
  '04-premise': '关键不是下滑，而是未来回报',
  '04a-investment-loop': '投入必须形成验证闭环',
  '05-research-open': '第一笔钱：研发费率 4.32%',
  '06-tech-transition': '液压制动，走向电子与线控',
  '06a-tech-gate': '先过整车厂测试与认证',
  '07-tech-window': '技术窗口，可能只剩两三年',
  '08-tech-stakes': '下一代门票，还是旧产品续命？',
  '09-oem-proof': 'Q3 主机厂定点，是第一道验证',
  '09a-oem-meaning': '定点不等于收入，但通向量产',
  '10-oem-result': '有定点，研发才进入订单验证',
  '11-factory-open': '第二笔钱：0.4 亿在建工程',
  '12-factory-future': '买的是 2027—2028 供给能力',
  '13-factory-share': '产能洗牌后，龙头才有机会',
  '13a-factory-condition': '订单填不满，产能就是成本',
  '14-cash-premise': '现金流必须撑到需求回暖',
  '15-cash-source': '钱来自现金，还是新增借款？',
  '15a-cash-discipline': '转型能花钱，不能无限透支',
  '16-metrics-open': '周转率 1.53 次，处于下沿',
  '17-metrics-safe': 'Capex 与存货，暂未越线',
  '18-metrics-risk': '转固后，80% 是风险阈值',
  '19-risk-pressure': '折旧、闲置与跌价，一起压利润',
  '20-q3-open': 'Q3 不只盯一个利润数字',
  '21-q3-list': '五个信号，决定投入成败',
  '22-conclusion': '提前卡位，还是埋下利润压力？',
  '23-brand-close': '把每一笔投入，拆成验证信号',
};

const PhoenixMark: React.FC<{ size?: number }> = ({ size = 34 }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="42" fill="none" stroke="#ef565c" strokeWidth="10" strokeDasharray="184 80" transform="rotate(-38 50 50)" />
    <circle cx="50" cy="50" r="26" fill="none" stroke="#ef565c" strokeWidth="10" strokeDasharray="112 52" transform="rotate(105 50 50)" />
    <path d="M34 58c12 6 25 0 31-16-1 20-15 32-31 26-9-4-13-13-11-23 1 5 5 10 11 13Z" fill="#ef565c" />
  </svg>
);

const GrainBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame % 420) * 0.15;
  return <AbsoluteFill style={{ background: '#040912', overflow: 'hidden' }}>
    <AbsoluteFill style={{ opacity: 0.34, backgroundImage: 'linear-gradient(rgba(80,116,151,.17) 1px, transparent 1px), linear-gradient(90deg, rgba(80,116,151,.17) 1px, transparent 1px)', backgroundSize: '54px 54px', backgroundPosition: `${drift}px ${drift * .52}px` }} />
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 77% 12%, rgba(22,106,135,.26), transparent 28%), radial-gradient(circle at 9% 83%, rgba(177,43,53,.20), transparent 35%), linear-gradient(180deg, rgba(3,10,20,.18), rgba(2,7,13,.65))' }} />
    <AbsoluteFill style={{ opacity: 0.12, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 5px, rgba(255,255,255,.04) 6px)' }} />
  </AbsoluteFill>;
};

const ArchiveHeader: React.FC<{ utterance: Utterance }> = ({ utterance }) => {
  const meta = chapterMeta[utterance.chapter];
  const frame = useCurrentFrame();
  const pulse = 0.62 + Math.sin(frame / 15) * 0.2;
  return <div style={{ position: 'absolute', top: 56, left: 56, right: 56, height: 78, display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(169,198,224,.26)', fontFamily: fontStack, zIndex: 8 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}><PhoenixMark size={36} /><div style={{ color: '#f1f7fc', fontSize: 27, fontWeight: 800, letterSpacing: 1 }}>财报档案</div></div>
    <div style={{ marginLeft: 18, color: '#7e9ab4', fontSize: 15, letterSpacing: 3 }}>F.REPORT / 01</div>
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: meta.color, fontSize: 17, letterSpacing: 2, fontWeight: 800 }}>{meta.step} {meta.name}</span><span style={{ width: 9, height: 9, borderRadius: 99, background: meta.color, boxShadow: `0 0 16px ${meta.color}`, opacity: pulse }} /></div>
  </div>;
};

const OutlineFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ position: 'absolute', top: 166, left: 48, right: 48, height: 1186, overflow: 'hidden', borderRadius: 30, border: '1px solid rgba(143,176,207,.38)', background: 'linear-gradient(145deg, rgba(10,23,37,.86), rgba(5,13,23,.72))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 35px 80px rgba(0,0,0,.20)' }}>
  <div style={{ position: 'absolute', top: 0, left: 0, width: 160, height: 5, background: '#ef565c' }} />
  <div style={{ position: 'absolute', top: 0, left: 176, width: 90, height: 5, background: '#47cce8' }} />
  {children}
</div>;

const DataChip: React.FC<{ label: string; value: string; color: string; local: number; delay: number; note?: string }> = ({ label, value, color, local, delay, note }) => {
  const p = appear(local, delay, 15);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 20}px)`, border: `1px solid ${color}88`, background: 'rgba(6,17,29,.74)', borderRadius: 18, padding: '18px 19px 17px', boxShadow: `0 0 24px ${color}13`, minWidth: 225 }}>
    <div style={{ color: '#a1b4c9', fontSize: 18 }}>{label}</div>
    <div style={{ marginTop: 7, color, fontSize: 38, fontWeight: 800, letterSpacing: -.8 }}>{value}</div>
    {note && <div style={{ marginTop: 5, color: '#d2deea', fontSize: 15 }}>{note}</div>}
  </div>;
};

const OpeningVisual: React.FC<{ local: number; id: string }> = ({ local, id }) => {
  const rise = appear(local, 14, 42);
  const premise = id === '04-premise' || id === '04a-investment-loop';
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 65, left: 44, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>金麒麟 / 财报异常扫描</div>
    <svg viewBox="0 0 960 830" style={{ position: 'absolute', left: 28, right: 28, top: 158, height: 840 }}>
      <defs><linearGradient id="up" x1="0" x2="1"><stop stopColor="#42cde8"/><stop offset="1" stopColor="#f5bf55"/></linearGradient></defs>
      <line x1="70" y1="650" x2="890" y2="650" stroke="#6f8499" strokeWidth="2" opacity=".46" />
      <g opacity={premise ? .54 : 1}>
        {[0, 1, 2, 3, 4, 5].map((item) => { const h = 300 - item * 40; const p = inRange(rise, item * .11, Math.min(1, item * .11 + .36)); return <rect key={item} x={100 + item * 76} y={650 - h * p} width="45" height={h * p} rx="8" fill="#ef565c" opacity={.92 - item * .09} />; })}
        <polyline points="92,310 184,364 272,412 356,458 440,524 528,612" fill="none" stroke="#ef565c" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="514,600 558,600 536,655" fill="#ef565c" />
      </g>
      <g transform={`translate(${premise ? 48 : 0}, ${premise ? -6 : 0})`}>
        {[0, 1, 2, 3, 4].map((item) => { const h = 100 + item * 72; const p = inRange(rise, .32 + item * .1, Math.min(1, .68 + item * .1)); return <rect key={item} x={570 + item * 52} y={650 - h * p} width="31" height={h * p} rx="7" fill="url(#up)" />; })}
        <polyline points="570,568 638,512 704,470 768,388 864,284" fill="none" stroke="#44cdec" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
        <polygon points="846,282 892,274 873,323" fill="#44cdec" />
        <circle cx="687" cy="590" r="47" fill="#0b2132" stroke="#55d6ee" strokeWidth="5" /><circle cx="687" cy="590" r="18" fill="#55d6ee" opacity=".8" />
      </g>
      {premise && <g opacity={appear(local, 20, 18)}><path d="M210 758 C370 704, 596 704, 766 758" fill="none" stroke="#f5bf55" strokeWidth="7" strokeDasharray="15 14" /><circle cx="485" cy="731" r="31" fill="#f5bf55" /><path d="M473 731h24M485 719v24" stroke="#07111c" strokeWidth="5" /></g>}
    </svg>
    {!premise && <div style={{ position: 'absolute', top: 780, left: 66, right: 66, display: 'flex', gap: 13 }}><DataChip label="营业收入" value="−14.8%" color="#ef565c" local={local} delay={0} /><DataChip label="归母净利" value="−73.1%" color="#ef565c" local={local} delay={18} /><DataChip label="在建工程" value="+139.6%" color="#f5bf55" local={local} delay={36} /></div>}
  </AbsoluteFill>;
};

const ResearchVisual: React.FC<{ local: number; id: string }> = ({ local, id }) => {
  const p = appear(local, 0, 18);
  const proof = id.startsWith('09') || id === '10-oem-result';
  const spin = local * 5;
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>研发档案 / 制动技术路线</div>
    <svg viewBox="0 0 960 920" style={{ position: 'absolute', left: 25, top: 135, width: 930, height: 880 }}>
      <defs><filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
      <g transform={`translate(245 490) rotate(${spin})`} opacity={p}><circle r="175" fill="#102130" stroke="#d7e4ee" strokeWidth="16"/><circle r="122" fill="#07131f" stroke="#5f7b91" strokeWidth="13" strokeDasharray="10 12"/><circle r="50" fill="#162b3b" stroke="#dfeaf1" strokeWidth="12"/><path d="M-212 -58h75c36 0 52 42 26 70l-58 61h-68z" fill="#dce7ee" stroke="#6f899c" strokeWidth="8"/></g>
      <path d="M420 490 C510 460 540 376 628 374 S758 444 810 330" fill="none" stroke="#4bd2ec" strokeWidth="12" strokeDasharray="22 15" filter="url(#glow)" opacity={p} />
      <g transform="translate(665 315)" opacity={appear(local, 20, 18)}><rect x="-110" y="-94" width="220" height="188" rx="24" fill="#102b3d" stroke="#4bd2ec" strokeWidth="7"/><rect x="-52" y="-52" width="104" height="104" rx="12" fill="#0a1724" stroke="#67d7a5" strokeWidth="5"/><path d="M-160 -43h50M-160 0h50M-160 43h50M110 -43h50M110 0h50M110 43h50" stroke="#4bd2ec" strokeWidth="10"/><circle r="20" fill="#67d7a5" filter="url(#glow)" /></g>
      <path d="M420 700 C510 665 625 670 794 700" fill="none" stroke="#344d63" strokeWidth="3" /><text x="128" y="760" fill="#8da5ba" fontSize="25">传统液压</text><text x="615" y="760" fill="#61d9ee" fontSize="25">电子 / 线控</text>
      {proof && <g opacity={appear(local, 18, 12)} transform="translate(486 146)"><rect x="-155" y="-58" width="310" height="116" rx="17" fill="#0b1c29" stroke="#f5bf55" strokeWidth="6"/><path d="M-105 0h52l14 19 18-38 20 40 18-22h80" fill="none" stroke="#f5bf55" strokeWidth="7"/><text x="-75" y="-22" fill="#f4f8fb" fontSize="29" fontWeight="bold">主机厂定点</text></g>}
    </svg>
    <div style={{ position: 'absolute', left: 64, right: 64, bottom: 68, display: 'flex', justifyContent: 'space-between' }}><DataChip label="研发费用率" value="4.32%" color="#55d6ee" local={local} delay={0} note="二季度" /><DataChip label="验证节点" value="Q3 定点" color="#f5bf55" local={local} delay={22} note="订单验证" /></div>
  </AbsoluteFill>;
};

const FactoryVisual: React.FC<{ local: number; id: string }> = ({ local, id }) => {
  const build = appear(local, 4, 42);
  const condition = id === '13a-factory-condition';
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>产能档案 / 供给能力</div>
    <svg viewBox="0 0 960 910" style={{ position: 'absolute', top: 130, left: 24, width: 930, height: 900 }}>
      <path d="M82 734 H880" stroke="#4d6378" strokeWidth="4" /><path d="M115 706 H850" stroke="#f5bf55" strokeWidth="10" strokeDasharray="10 16" opacity={.8} />
      {[0, 1, 2, 3, 4, 5, 6].map((index) => { const x = 116 + index * 97; const y = 700 - (index % 3) * 19; const o = inRange(build, index * .1, Math.min(1, index * .1 + .3)); return <g key={index} opacity={o} transform={`translate(${x} ${y})`}><rect width="68" height="47" rx="8" fill="#dce7ec" stroke="#668095" strokeWidth="4"/><rect x="10" y="12" width="17" height="12" fill="#173247"/><rect x="41" y="12" width="17" height="12" fill="#173247"/></g>; })}
      <g opacity={build} transform={`translate(255 ${540 - build * 105})`}><rect x="0" y="0" width="280" height="165" fill="#dfe8ed" stroke="#627d91" strokeWidth="7"/><path d="M0 54h280M0 108h280M70 0v165M140 0v165M210 0v165" stroke="#7d94a5" strokeWidth="5"/><path d="M-14 0L30 -64 H256 L296 0" fill="#b9cbd6" stroke="#627d91" strokeWidth="7"/><rect x="182" y="-132" width="38" height="68" fill="#dfe8ed" stroke="#627d91" strokeWidth="6"/><rect x="225" y="-163" width="34" height="99" fill="#dfe8ed" stroke="#627d91" strokeWidth="6"/></g>
      <g opacity={appear(local, 40, 18)}><path d="M590 520 C652 404 737 342 838 262" fill="none" stroke={condition ? '#ef565c' : '#f5bf55'} strokeWidth="8" strokeDasharray="18 15" /><circle cx="620" cy="494" r="22" fill="#f5bf55"/><circle cx="738" cy="365" r="22" fill="#f5bf55"/><circle cx="838" cy="262" r="25" fill={condition ? '#ef565c' : '#67d7a5'} /></g>
      <text x="565" y="578" fill="#a6bacb" fontSize="24">今天投入</text><text x="746" y="225" fill="#f5bf55" fontSize="24">未来供给</text>
    </svg>
    <div style={{ position: 'absolute', left: 64, right: 64, bottom: 67, display: 'flex', gap: 16 }}><DataChip label="在建工程" value="0.4 亿" color="#f5bf55" local={local} delay={0} note="期末规模"/><DataChip label="同比变化" value="+139.6%" color="#ef565c" local={local} delay={20} note="逆势扩产"/><DataChip label="目标周期" value="2027—28" color="#67d7a5" local={local} delay={36} note="供给能力"/></div>
  </AbsoluteFill>;
};

const CashVisual: React.FC<{ local: number }> = ({ local }) => {
  const p = appear(local, 0, 20);
  const pulse = (local % 55) / 55;
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>资金档案 / 现金流来源</div>
    <svg viewBox="0 0 960 950" style={{ position: 'absolute', top: 128, left: 24, width: 930, height: 920 }}>
      <defs><linearGradient id="cashBlue" x1="0" x2="1"><stop stopColor="#47cce8"/><stop offset="1" stopColor="#67d7a5"/></linearGradient><linearGradient id="cashRed" x1="0" x2="1"><stop stopColor="#ef565c"/><stop offset="1" stopColor="#9f2d3c"/></linearGradient></defs>
      <g opacity={p}><rect x="70" y="325" width="210" height="250" rx="35" fill="#102a3b" stroke="#55d6ee" strokeWidth="7"/><path d="M76 494h198v44c0 17-14 31-31 31H107c-17 0-31-14-31-31z" fill="#47cce8" opacity=".75"/><ellipse cx="175" cy="325" rx="105" ry="34" fill="#0c1e2c" stroke="#55d6ee" strokeWidth="7"/><text x="113" y="635" fill="#55d6ee" fontSize="25">自有现金</text></g>
      <g opacity={p}><rect x="680" y="325" width="210" height="250" rx="35" fill="#2b1420" stroke="#ef565c" strokeWidth="7"/><path d="M686 446h198v92c0 17-14 31-31 31H717c-17 0-31-14-31-31z" fill="#ef565c" opacity=".68"/><ellipse cx="785" cy="325" rx="105" ry="34" fill="#261321" stroke="#ef565c" strokeWidth="7"/><text x="730" y="635" fill="#ef565c" fontSize="25">新增借款</text></g>
      <path d="M280 444 C385 444 383 676 480 676 C575 676 575 444 680 444" fill="none" stroke="#405a70" strokeWidth="25" strokeLinecap="round"/><path d="M280 444 C385 444 383 676 480 676 C575 676 575 444 680 444" fill="none" stroke="#f5bf55" strokeWidth="7" strokeDasharray="22 17" strokeDashoffset={-local * 3}/>
      <g transform="translate(480 676)" opacity={appear(local, 19, 15)}><circle r="76" fill="#132a3c" stroke="#f5bf55" strokeWidth="8"/><circle r="35" fill="#f5bf55" opacity=".88"/><path d="M-18 0h36M0-18v36" stroke="#07131d" strokeWidth="7"/><text x="-45" y="120" fill="#f5bf55" fontSize="25">扩产资金</text></g>
      <circle cx={328 + pulse * 140} cy={510 + Math.sin(pulse * Math.PI) * 116} r="12" fill="url(#cashBlue)"/><circle cx={632 - pulse * 140} cy={510 + Math.sin(pulse * Math.PI) * 116} r="12" fill="url(#cashRed)"/>
    </svg>
    <div style={{ position: 'absolute', left: 64, right: 64, bottom: 85, padding: '22px 25px', borderRadius: 16, color: '#dce8f1', border: '1px solid rgba(245,191,85,.55)', background: 'rgba(10,22,33,.75)', fontSize: 25, textAlign: 'center', opacity: appear(local, 28, 16) }}>扩产能否成立，不只看工厂；还要看现金安全垫。</div>
  </AbsoluteFill>;
};

const Gauge: React.FC<{ cx: number; cy: number; value: number; color: string; title: string; amount: string; note: string; local: number; delay: number }> = ({ cx, cy, value, color, title, amount, note, local, delay }) => {
  const p = appear(local, delay, 16);
  const angle = -120 + value * 240 * p;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + Math.cos(rad) * 112;
  const ny = cy + Math.sin(rad) * 112;
  return <g opacity={p} transform={`translate(0 ${(1 - p) * 22})`}><path d={`M ${cx - 120} ${cy + 70} A 138 138 0 0 1 ${cx + 120} ${cy + 70}`} fill="none" stroke="#263d51" strokeWidth="25" strokeLinecap="round"/><path d={`M ${cx - 120} ${cy + 70} A 138 138 0 0 1 ${cx + 120} ${cy + 70}`} fill="none" stroke={color} strokeWidth="25" strokeLinecap="round" strokeDasharray={`${value * 433} 433`} /><line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#f4f8fb" strokeWidth="8" strokeLinecap="round"/><circle cx={cx} cy={cy} r="15" fill={color}/><text x={cx} y={cy + 128} textAnchor="middle" fill="#a8b9c8" fontSize="22">{title}</text><text x={cx} y={cy + 166} textAnchor="middle" fill={color} fontWeight="bold" fontSize="38">{amount}</text><text x={cx} y={cy + 198} textAnchor="middle" fill="#dce8f2" fontSize="18">{note}</text></g>;
};

const MetricsVisual: React.FC<{ local: number }> = ({ local }) => <AbsoluteFill style={{ fontFamily: fontStack }}>
  <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>运营档案 / 三张压力表</div>
  <svg viewBox="0 0 960 900" style={{ position: 'absolute', top: 165, left: 24, width: 930, height: 860 }}>
    <Gauge cx={205} cy={350} value={.42} color="#55d6ee" title="固定资产周转" amount="1.53 次" note="正常区间下沿" local={local} delay={0}/>
    <Gauge cx={480} cy={350} value={.656} color="#f5bf55" title="Capex 强度" amount="65.6%" note="暂未越线" local={local} delay={24}/>
    <Gauge cx={755} cy={350} value={.448} color="#67d7a5" title="存货营收比" amount="44.8%" note="仍在区间内" local={local} delay={48}/>
    <line x1="542" y1="182" x2="542" y2="255" stroke="#ef565c" strokeWidth="7" strokeDasharray="10 9"/><text x="558" y="200" fill="#ef565c" fontSize="20">80% 风险线</text>
    <g opacity={appear(local, 72, 16)}><path d="M122 705 H838" stroke="#415b71" strokeWidth="5"/><path d="M122 705 H590" stroke="#67d7a5" strokeWidth="13"/><circle cx="590" cy="705" r="14" fill="#67d7a5"/><text x="123" y="760" fill="#acc0d0" fontSize="22">效率</text><text x="445" y="760" fill="#acc0d0" fontSize="22">投入强度</text><text x="740" y="760" fill="#acc0d0" fontSize="22">库存风险</text></g>
  </svg>
</AbsoluteFill>;

const RiskVisual: React.FC<{ local: number }> = ({ local }) => {
  const blocks = appear(local, 15, 30);
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>风险档案 / 转固后的压力</div>
    <svg viewBox="0 0 960 920" style={{ position: 'absolute', top: 142, left: 24, width: 930, height: 900 }}>
      <path d="M92 740 H868" stroke="#4c6479" strokeWidth="4"/>
      <g opacity={appear(local, 0, 16)}><path d="M155 700 V356 M225 700 V310 M295 700 V390 M365 700 V258" stroke="#8fa7b9" strokeWidth="12"/><path d="M120 475 H398 M120 588 H398 M155 356 H365 M225 310 H365" stroke="#8fa7b9" strokeWidth="8"/><path d="M160 334 H332" stroke="#f5bf55" strokeWidth="5" strokeDasharray="10 9"/></g>
      <g transform={`translate(${Math.max(0, 1 - blocks) * -82} 0)`} opacity={blocks}>{[0, 1, 2, 3, 4, 5].map((item) => <rect key={item} x={500 + (item % 3) * 88} y={620 - Math.floor(item / 3) * 88} width="79" height="79" rx="8" fill="#dfe8ed" stroke="#70889a" strokeWidth="6"/>)}</g>
      <path d="M470 315 H862" stroke="#ef565c" strokeWidth="8" strokeDasharray="12 12" opacity={appear(local, 30, 15)}/><text x="622" y="284" fill="#ef565c" fontSize="26">Capex 80% 警戒</text>
      {[0, 1, 2].map((item) => { const p = appear(local, 43 + item * 16, 12); return <g key={item} transform={`translate(${178 + item * 232} ${280 + (1 - p) * -92})`} opacity={p}><rect x="-50" y="0" width="100" height="82" rx="10" fill="#ef565c"/><path d="M-20 30h40M-8 18v24" stroke="#fff" strokeWidth="7"/><text x="0" y="114" textAnchor="middle" fill="#e5eef5" fontSize="21">{['折旧', '闲置', '跌价'][item]}</text></g>; })}
    </svg>
  </AbsoluteFill>;
};

const SignalsVisual: React.FC<{ local: number }> = ({ local }) => {
  const signalItems = ['电子刹车定点', '扩产资金来源', '营收 4.5 亿', '在建工程转固', '存货跌价准备'];
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>Q3 档案 / 验证清单</div>
    <div style={{ position: 'absolute', top: 220, left: 66, right: 66, display: 'grid', gridTemplateColumns: '1fr', gap: 19 }}>{signalItems.map((item, index) => { const p = appear(local, 12 + index * 38, 15); return <div key={item} style={{ minHeight: 113, display: 'flex', alignItems: 'center', gap: 22, padding: '0 25px', border: '1px solid rgba(103,215,165,.72)', borderRadius: 18, background: 'linear-gradient(110deg, rgba(10,28,39,.92), rgba(10,21,33,.74))', boxShadow: `0 0 ${18 + index * 2}px rgba(103,215,165,.12)`, opacity: p, transform: `translateX(${(1 - p) * 36}px)` }}><div style={{ width: 48, height: 48, borderRadius: '50%', background: '#67d7a5', color: '#07141c', fontWeight: 900, fontSize: 29, lineHeight: '48px', textAlign: 'center' }}>{index + 1}</div><div style={{ color: '#edf6fb', fontSize: 31, fontWeight: 800 }}>{item}</div><div style={{ marginLeft: 'auto', width: 11, height: 11, borderRadius: '50%', background: '#67d7a5', boxShadow: '0 0 13px #67d7a5' }} /></div>; })}</div>
  </AbsoluteFill>;
};

const ClosingVisual: React.FC<{ local: number; id: string }> = ({ local, id }) => {
  const p = appear(local, 0, 18);
  return <AbsoluteFill style={{ fontFamily: fontStack }}>
    <div style={{ position: 'absolute', top: 66, left: 45, color: '#dce8f3', fontSize: 20, letterSpacing: 3 }}>结论档案 / 投入的分叉</div>
    <svg viewBox="0 0 960 900" style={{ position: 'absolute', top: 160, left: 24, width: 930, height: 880 }}>
      <g opacity={p}><circle cx="480" cy="610" r="72" fill="#152b3c" stroke="#f5bf55" strokeWidth="8"/><circle cx="480" cy="610" r="28" fill="#f5bf55"/><path d="M480 535 V276 C480 216 405 186 268 160" fill="none" stroke="#59d6ec" strokeWidth="18" strokeLinecap="round"/><path d="M480 535 V276 C480 216 555 186 692 160" fill="none" stroke="#ef565c" strokeWidth="18" strokeLinecap="round"/><circle cx="260" cy="158" r="50" fill="#103143" stroke="#59d6ec" strokeWidth="7"/><circle cx="700" cy="158" r="50" fill="#351523" stroke="#ef565c" strokeWidth="7"/><text x="260" y="250" fill="#59d6ec" fontSize="29" textAnchor="middle">订单兑现</text><text x="700" y="250" fill="#ef565c" fontSize="29" textAnchor="middle">利润压力</text><text x="480" y="726" fill="#f5bf55" fontSize="24" textAnchor="middle">Q3 验证</text></g>
    </svg>
    {id === '23-brand-close' && <div style={{ position: 'absolute', left: 0, right: 0, top: 420, textAlign: 'center', opacity: appear(local, 12, 18) }}><div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 18 }}><PhoenixMark size={62}/><span style={{ color: '#f5f8fb', fontWeight: 800, fontSize: 63, letterSpacing: 2 }}>财报<span style={{ color: '#ef565c', margin: '0 10px' }}>│</span>揭秘室</span></div><div style={{ marginTop: 22, color: '#adc0d1', fontSize: 25, letterSpacing: 3 }}>原创财经解读栏目</div></div>}
  </AbsoluteFill>;
};

const MainVisual: React.FC<{ utterance: Utterance; local: number }> = ({ utterance, local }) => {
  if (utterance.chapter === 'opening') return <OpeningVisual local={local} id={utterance.id} />;
  if (utterance.chapter === 'research') return <ResearchVisual local={local} id={utterance.id} />;
  if (utterance.chapter === 'factory') return <FactoryVisual local={local} id={utterance.id} />;
  if (utterance.chapter === 'cash') return <CashVisual local={local} />;
  if (utterance.chapter === 'metrics') return <MetricsVisual local={local} />;
  if (utterance.chapter === 'risk') return <RiskVisual local={local} />;
  if (utterance.chapter === 'signals') return <SignalsVisual local={local} />;
  return <ClosingVisual local={local} id={utterance.id} />;
};

const ConclusionStrip: React.FC<{ utterance: Utterance; local: number }> = ({ utterance, local }) => {
  const p = appear(local, 0, 12);
  return <div style={{ position: 'absolute', left: 48, right: 48, top: 1380, minHeight: 128, display: 'flex', alignItems: 'center', padding: '20px 29px', overflow: 'hidden', borderRadius: 19, background: '#f2f5f7', boxShadow: '0 16px 42px rgba(0,0,0,.19)', opacity: p, transform: `translateY(${(1 - p) * 17}px)`, fontFamily: fontStack }}><div style={{ width: 7, alignSelf: 'stretch', marginRight: 20, borderRadius: 99, background: chapterMeta[utterance.chapter].color }} /><div style={{ color: '#0d1722', fontSize: 35, lineHeight: 1.24, fontWeight: 850, letterSpacing: .2 }}>{conclusions[utterance.id] ?? utterance.text}</div></div>;
};

const BottomQuestion: React.FC = () => <div style={{ position: 'absolute', left: 55, right: 55, bottom: 48, fontFamily: fontStack }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: 11, color: '#ef565c', fontSize: 16, letterSpacing: 3, fontWeight: 800 }}><span style={{ display: 'inline-block', width: 36, height: 3, background: '#ef565c' }}/>财报档案 01</div>
  <div style={{ marginTop: 12, color: '#f1f6f9', fontSize: 38, lineHeight: 1.13, fontWeight: 850 }}>利润跌 73%，为什么还在加码？</div>
  <div style={{ marginTop: 17, display: 'flex', alignItems: 'center', gap: 9, color: '#8ea5bb', fontSize: 18 }}><PhoenixMark size={25}/><span>财报揭秘室</span><span style={{ marginLeft: 'auto', color: '#53697d', fontSize: 14 }}>公开财报数据整理 · 不构成投资建议</span></div>
  <div style={{ marginTop: 20, height: 4, background: 'rgba(129,158,183,.3)', borderRadius: 5 }}><div style={{ width: '100%', height: '100%', background: 'linear-gradient(90deg, #ef565c 0 62%, #53d1ea 62% 78%, #f5bf55 78% 100%)', borderRadius: 5 }} /></div>
</div>;

const OutroCard: React.FC<{ utterance: Utterance; local: number }> = ({ utterance, local }) => {
  if (utterance.id !== '23-brand-close') return null;
  const p = appear(local, 0, 16);
  return <AbsoluteFill style={{ zIndex: 12, background: 'rgba(3,9,17,.30)', opacity: p }}><div style={{ position: 'absolute', bottom: 73, left: 0, right: 0, textAlign: 'center', color: '#a7baca', fontFamily: fontStack, fontSize: 20, letterSpacing: 2 }}>本期解读到这里</div></AbsoluteFill>;
};

const ExactSfx: React.FC = () => {
  const events = [
    { frame: 26, file: 'bearish-drop-short.wav', volume: .2 },
    { frame: 352, file: 'data-tick-soft.wav', volume: .18 },
    { frame: 756, file: 'section-tech-sweep.wav', volume: .15 },
    { frame: 1389, file: 'headline-land.wav', volume: .17 },
    { frame: 1727, file: 'section-tech-sweep.wav', volume: .15 },
    { frame: 2458, file: 'data-tick-crisp.wav', volume: .17 },
    { frame: 4473, file: 'risk-alert.wav', volume: .15 },
    { frame: 4842, file: 'headline-land.wav', volume: .16 },
  ];
  return <>{events.map((event) => <Sequence key={`${event.file}-${event.frame}`} from={event.frame}><Audio src={staticFile(`audio/financial-dialogue-v3/sfx/${event.file}`)} volume={event.volume}/></Sequence>)}</>;
};

export const FinancialReportVertical: React.FC = () => {
  const frame = useCurrentFrame();
  const active = [...timing.utterances].reverse().find((item) => frame >= item.start_frame) ?? timing.utterances[0];
  const local = Math.max(0, frame - active.start_frame);
  const isFinal = active.chapter === 'closing';
  return <AbsoluteFill style={{ background: '#040912' }}>
    <GrainBackground />
    {!isFinal && <><ArchiveHeader utterance={active} /><OutlineFrame><MainVisual utterance={active} local={local}/></OutlineFrame><ConclusionStrip utterance={active} local={local}/><BottomQuestion /></>}
    {isFinal && <><ClosingVisual local={local} id={active.id}/><ConclusionStrip utterance={active} local={local}/><OutroCard utterance={active} local={local}/></>}
    {timing.utterances.map((item) => <Sequence key={item.id} from={item.start_frame} durationInFrames={item.duration_frames}><Audio src={staticFile(`audio/financial-vertical-v1/scenes/${item.file}`)} /></Sequence>)}
    <ExactSfx />
  </AbsoluteFill>;
};
