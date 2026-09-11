import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
} from 'remotion';

type Role = 'female' | 'male';
type SectionId = 'hook' | 'conflict' | 'research' | 'technology' | 'construction' | 'cash' | 'efficiency' | 'capex' | 'inventory' | 'checklist';

type DialogueLine = {
  id: string;
  role: Role;
  text: string;
  start: number;
  duration: number;
  file: string;
  bubble: boolean;
};

type Section = {
  id: SectionId;
  label: string;
  title: string;
  from: number;
  until: number;
};

const fps = 30;
export const FINANCIAL_DIALOGUE_DURATION_FRAMES = 8828;
const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const dialogue: DialogueLine[] = [
  { id: '001-hook', role: 'female', text: '营收降了14.8%，净利润跌了73.1%，研发费用率却涨了一个百分点；在建工程更是飙升139.6%。利润都在大幅收缩，金麒麟的钱，为什么还在往外花？', start: 0, duration: 15.072, file: '001-hook-female.mp3', bubble: true },
  { id: '002-answer', role: 'male', text: '这正是这份财报最值得拆开的地方。表面看，利润承压；但公司没有同步收缩研发和建厂，反而在为下一轮产品和产能做准备。', start: 15.722, duration: 11.064, file: '002-answer-male.mp3', bubble: true },
  { id: '003-company', role: 'male', text: '金麒麟是国内汽车刹车片龙头，市占率大约15%到20%。但这份财报里，有两个完全相反的方向：一边是利润几乎清零，另一边是研发和建厂都在加速花钱。', start: 27.286, duration: 14.664, file: '003-company-male.mp3', bubble: false },
  { id: '004-contradiction', role: 'female', text: '一边收缩，一边投入。它到底是在主动布局，还是在硬扛压力？', start: 42.25, duration: 5.088, file: '004-contradiction-female.mp3', bubble: true },
  { id: '005-rd-rate', role: 'male', text: '先从研发看。二季度研发费用率是4.32%，同比提升1.02个百分点。单看这个比例，也许不算特别高。', start: 47.688, duration: 10.272, file: '005-rd-rate-male.mp3', bubble: false },
  { id: '006-rd-question', role: 'female', text: '但营收都降了14.8%，研发费用为什么不降反增？', start: 58.24, duration: 4.656, file: '006-rd-question-female.mp3', bubble: true },
  { id: '007-tech-route', role: 'male', text: '因为公司正在经历一次产品路线切换。传统盘式刹车片，正在从液压制动，转向电子刹车和线控制动。', start: 63.176, duration: 9.456, file: '007-tech-route-male.mp3', bubble: false },
  { id: '008-tech-bet', role: 'female', text: '也就是说，这不是普通的产品优化，而是在押注下一代技术？', start: 72.912, duration: 4.848, file: '008-tech-bet-female.mp3', bubble: true },
  { id: '009-tech-window', role: 'male', text: '对。这个技术窗口只剩两到三年。上半年费用的增长，大概率就投向了这里。', start: 78.06, duration: 7.08, file: '009-tech-window-male.mp3', bubble: false },
  { id: '010-tech-risk', role: 'male', text: '但这笔钱值不值得花，要看方向：如果投的是传统产品的小修小补，而不是下一代电子刹车，那就是方向性浪费。', start: 85.36, duration: 9.864, file: '010-tech-risk-male.mp3', bubble: false },
  { id: '011-tech-proof', role: 'female', text: '那我们怎么验证研发不是只花钱、不兑现？', start: 95.524, duration: 3.048, file: '011-tech-proof-female.mp3', bubble: true },
  { id: '012-oem', role: 'male', text: 'Q3要重点看主机厂定点。拿到定点，意味着研发开始进入订单验证和兑现阶段；拿不到，投入的回报周期就要重新评估。', start: 98.852, duration: 10.824, file: '012-oem-male.mp3', bubble: true },
  { id: '013-construction-question', role: 'female', text: '研发之外，还有一个更反常的数据：在建工程期末是0.4亿，同比涨了139.6%。营收和利润都在萎缩，新工厂为什么还在继续推进？', start: 110.176, duration: 12.456, file: '013-construction-question-female.mp3', bubble: true },
  { id: '014-construction-answer', role: 'male', text: '因为产能建设看的是未来，不是当季。一个工厂从投入到释放产能，通常需要一到两年。现在的资本开支，对应的是2027到2028年的供给能力。', start: 122.932, duration: 13.224, file: '014-construction-answer-male.mp3', bubble: false },
  { id: '015-share-question', role: 'female', text: '所以公司是在赌：需求回暖以后，谁先有新产能，谁就能拿更多份额？', start: 136.416, duration: 5.448, file: '015-share-question-female.mp3', bubble: true },
  { id: '016-share-answer', role: 'male', text: '可以这么理解。电子刹车的技术转型，会淘汰跟不上门槛的小厂；活下来的龙头，份额反而可能更高。', start: 142.144, duration: 8.664, file: '016-share-answer-male.mp3', bubble: false },
  { id: '017-cash-question', role: 'female', text: '但前提是，公司得先活到需求回暖。关键问题来了：钱从哪来？', start: 151.158, duration: 5.472, file: '017-cash-question-female.mp3', bubble: true },
  { id: '018-cash-answer', role: 'male', text: '这比在建工程还涨不涨更重要。要看自有现金是不是在消耗安全垫，也要看新增借款是不是在增加杠杆。转型可以花钱，但不能无限透支现金流。', start: 156.91, duration: 13.056, file: '018-cash-answer-male.mp3', bubble: true },
  { id: '019-efficiency-question', role: 'female', text: '除了现金，资产效率怎么样？固定资产周转率是1.53次，听起来不高。', start: 170.416, duration: 6.264, file: '019-efficiency-question-female.mp3', bubble: true },
  { id: '020-efficiency-answer', role: 'male', text: '它处在行业正常区间1.5到3.0次的下沿。营收下降是主要原因，但周转率的降幅小于营收降幅，说明公司是在主动削减低效产能，不是设备闲着、被动空转。', start: 176.96, duration: 14.832, file: '020-efficiency-answer-male.mp3', bubble: false },
  { id: '021-q3-question', role: 'female', text: '如果Q3的营收能修复，效率会回来吗？', start: 192.072, duration: 3.24, file: '021-q3-question-female.mp3', bubble: true },
  { id: '022-q3-answer', role: 'male', text: '如果Q3营收回到4.5亿以上，固定资产周转率会自然修复。这是一个很关键的观察点。', start: 195.592, duration: 7.224, file: '022-q3-answer-male.mp3', bubble: true },
  { id: '023-capex-question', role: 'female', text: '那Capex强度呢？现在是65.6%，也就是每赚一块钱，对应六毛五的机器设备。', start: 203.216, duration: 7.248, file: '023-capex-question-female.mp3', bubble: true },
  { id: '024-capex-answer', role: 'male', text: '目前仍在安全范围。但风险在于，在建工程会逐步转成固定资产。', start: 210.744, duration: 6.672, file: '024-capex-answer-male.mp3', bubble: false },
  { id: '025-capex-risk', role: 'male', text: '如果大规模转固时营收没有跟上，Capex强度可能跳升到80%以上，折旧压力和产能闲置会同时冲击利润表和资产负债表。', start: 217.616, duration: 11.064, file: '025-capex-risk-male.mp3', bubble: true },
  { id: '026-transfer', role: 'female', text: '所以Q3不只是看建了多少，更要看什么时候转固。', start: 228.96, duration: 4.056, file: '026-transfer-female.mp3', bubble: true },
  { id: '027-transfer-answer', role: 'male', text: '没错。转固时间节点，是Q3必须跟踪的变量。', start: 233.266, duration: 4.656, file: '027-transfer-answer-male.mp3', bubble: false },
  { id: '028-inventory-question', role: 'female', text: '最后看库存。存货营收比是44.8%，这部分危险吗？', start: 238.322, duration: 5.472, file: '028-inventory-question-female.mp3', bubble: true },
  { id: '029-inventory-answer', role: 'male', text: '目前仍在正常区间。刹车片按订单生产，库存以原材料为主，产成品积压风险不高。', start: 244.074, duration: 8.28, file: '029-inventory-answer-male.mp3', bubble: true },
  { id: '030-inventory-risk', role: 'male', text: '但如果钢价继续下行，原材料可能出现跌价风险，所以Q3要看存货跌价准备是否增加。', start: 252.554, duration: 8.256, file: '030-inventory-risk-male.mp3', bubble: false },
  { id: '031-summary', role: 'female', text: '总结一下，金麒麟这份财报不是简单的利润下滑，而是一场技术和产能的提前投入。', start: 261.26, duration: 7.056, file: '031-summary-female.mp3', bubble: true },
  { id: '032-checklist', role: 'male', text: 'Q3重点盯五件事：主机厂电子刹车定点与扩产，资金来源结构，营收能不能回到4.5亿以上，在建工程的转固节点，以及存货跌价准备有没有变化。', start: 268.596, duration: 14.808, file: '032-checklist-male.mp3', bubble: true },
  { id: '033-close-question', role: 'female', text: '这五个点，决定它现在的投入，是为未来抢份额，还是把压力留给未来。', start: 283.684, duration: 5.472, file: '033-close-question-female.mp3', bubble: true },
  { id: '034-close', role: 'male', text: '每期三分钟，拆解财报里的关键信号。这里是财报揭秘室。', start: 289.436, duration: 4.824, file: '034-close-male.mp3', bubble: true },
];

const sections: Section[] = [
  { id: 'hook', label: '01 异常信号', title: '利润收缩，钱为什么还在往外花？', from: 0, until: 15.722 },
  { id: 'conflict', label: '02 核心矛盾', title: '一边利润承压，一边研发建厂加速', from: 15.722, until: 47.688 },
  { id: 'research', label: '03 研发投入', title: '营收下行，研发费用却不降反增', from: 47.688, until: 63.176 },
  { id: 'technology', label: '04 技术转型', title: '液压制动，正在转向电子刹车', from: 63.176, until: 110.176 },
  { id: 'construction', label: '05 产能建设', title: '当下 Capex，对应未来供给能力', from: 110.176, until: 151.158 },
  { id: 'cash', label: '06 现金流', title: '份额提升的前提，是现金流撑得住', from: 151.158, until: 170.416 },
  { id: 'efficiency', label: '07 资产效率', title: '周转率处在行业正常区间下沿', from: 170.416, until: 203.216 },
  { id: 'capex', label: '08 资本开支', title: '65.6% 尚安全，转固后才是真考验', from: 203.216, until: 238.322 },
  { id: 'inventory', label: '09 存货质量', title: '库存不危险，原材料跌价才是变量', from: 238.322, until: 261.26 },
  { id: 'checklist', label: '10 Q3 清单', title: '验证这五个变化', from: 261.26, until: 294.26 },
];

const pop = (frame: number, fromSeconds: number, duration = 16) => interpolate(frame, [Math.round(fromSeconds * fps), Math.round(fromSeconds * fps) + duration], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic),
});

const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame % 240) * 0.34;
  return <AbsoluteFill style={{ background: '#070b12', overflow: 'hidden' }}><AbsoluteFill style={{ opacity: 0.55, backgroundImage: 'linear-gradient(rgba(110,130,170,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(110,130,170,.12) 1px, transparent 1px)', backgroundSize: '80px 80px', backgroundPosition: `${drift}px ${drift * .6}px` }} /><AbsoluteFill style={{ background: 'radial-gradient(circle at 79% 13%, rgba(20,122,148,.22), transparent 26%), radial-gradient(circle at 24% 87%, rgba(141,25,42,.16), transparent 34%)' }} /><div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'linear-gradient(90deg, #e84747 0 30%, #202a37 30% 100%)' }} /></AbsoluteFill>;
};

const Avatar: React.FC<{ role: Role; active: boolean }> = ({ role, active }) => {
  const source = role === 'female' ? 'assets/financial-dialogue/female-host.png' : 'assets/financial-dialogue/male-chief.png';
  const accent = role === 'female' ? '#ff515a' : '#47c8df';
  return <div style={{ width: 118, height: 118, borderRadius: '50%', padding: 5, background: active ? accent : '#283646', boxShadow: active ? `0 0 34px ${accent}8c` : 'none', transition: 'none' }}><div style={{ height: '100%', width: '100%', overflow: 'hidden', borderRadius: '50%', background: '#27344d' }}><Img src={staticFile(source)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: role === 'female' ? '50% 9%' : '50% 10%', transform: 'scale(1.4)' }} /></div></div>;
};

const SpeakerPanel: React.FC<{ role: Role; line?: DialogueLine; active: boolean }> = ({ role, line, active }) => {
  const isFemale = role === 'female';
  const accent = isFemale ? '#ff515a' : '#47c8df';
  const name = isFemale ? '财小策' : '室长';
  const title = isFemale ? '小白提问官' : '拆解财报内幕';
  const visible = Boolean(line?.bubble);
  const frame = useCurrentFrame();
  const progress = line ? pop(frame, line.start) : 0;
  const position: React.CSSProperties = isFemale ? { top: 148 } : { bottom: 148 };
  return <div style={{ position: 'absolute', left: 54, width: 420, ...position, opacity: active || visible ? 1 : .48 }}><div style={{ display: 'flex', alignItems: 'center', gap: 18 }}><Avatar role={role} active={active} /><div><div style={{ color: '#edf3ff', fontSize: 29, fontWeight: 800 }}>{name}</div><div style={{ color: '#7d93ae', fontSize: 18, marginTop: 7 }}>{title}</div></div></div>{visible && line && <div style={{ marginLeft: 138, marginTop: -24, minHeight: 93, padding: '22px 24px', borderRadius: 18, border: `1px solid ${accent}99`, background: 'rgba(14,20,29,.94)', boxShadow: `0 12px 34px ${accent}1c`, color: '#e8eef9', fontSize: 25, lineHeight: 1.42, opacity: progress, transform: `translateY(${(1 - progress) * 15}px)` }}><div style={{ color: accent, fontSize: 15, letterSpacing: 2, marginBottom: 8 }}>{isFemale ? 'QUESTION' : 'ANALYSIS'}</div>{line.text}</div>}</div>;
};

const MetricCard: React.FC<{ label: string; value: string; note: string; color: string; from: number }> = ({ label, value, note, color, from }) => {
  const frame = useCurrentFrame();
  const progress = pop(frame, from);
  return <div style={{ flex: 1, minHeight: 138, border: `1px solid ${color}88`, background: 'linear-gradient(135deg, rgba(20,31,45,.97), rgba(11,16,26,.9))', borderRadius: 18, padding: '20px 24px', opacity: progress, transform: `translateY(${(1 - progress) * 24}px)`, boxShadow: `0 0 28px ${color}18` }}><div style={{ color: '#8c9eaf', fontSize: 19 }}>{label}</div><div style={{ color, fontWeight: 800, fontSize: 44, marginTop: 10 }}>{value}</div><div style={{ color: '#ccd5e3', fontSize: 18, marginTop: 8 }}>{note}</div></div>;
};

const PanelShell: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ position: 'absolute', left: 500, right: 62, top: 160, bottom: 115, border: '1px solid rgba(126,155,187,.26)', borderRadius: 24, background: 'linear-gradient(135deg, rgba(13,20,30,.93), rgba(9,14,22,.78))', overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.035)' }}>{children}</div>;

const PanelHeader: React.FC<{ section: Section }> = ({ section }) => <div style={{ position: 'absolute', top: 34, left: 42, right: 42 }}><div style={{ color: '#ff515a', fontWeight: 800, fontSize: 17, letterSpacing: 3 }}>{section.label}</div><div style={{ color: '#f1f5fb', fontWeight: 800, fontSize: 40, marginTop: 12 }}>{section.title}</div></div>;

const HookStage: React.FC = () => {
  const frame = useCurrentFrame();
  return <div style={{ position: 'absolute', left: 42, right: 42, top: 175, display: 'flex', gap: 18 }}><MetricCard label="营业收入" value="−14.8%" note="规模收缩" color="#ff515a" from={.4} /><MetricCard label="归母净利润" value="−73.1%" note="利润承压" color="#ff515a" from={4.4} /><MetricCard label="研发费用率" value="+1.02pct" note="逆势上升" color="#47c8df" from={8.1} /><MetricCard label="在建工程" value="+139.6%" note="投入加速" color="#f6bb4d" from={11.1} /><div style={{ position: 'absolute', left: 0, right: 0, top: 206, textAlign: 'center', color: '#f1f5fb', fontSize: 31, fontWeight: 800, opacity: pop(frame, 13.2) }}>利润收缩，钱为什么还在往外花？</div></div>;
};

const ConflictStage: React.FC = () => {
  const frame = useCurrentFrame();
  const a = pop(frame, 16.2);
  const b = pop(frame, 27.8);
  const vs = pop(frame, 42.25);
  return <div style={{ position: 'absolute', left: 70, right: 70, top: 192, bottom: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 55 }}><div style={{ width: 360, padding: 35, borderRadius: 22, border: '1px solid #ff515a88', opacity: a, transform: `translateX(${(1 - a) * -34}px)`, textAlign: 'center' }}><div style={{ color: '#ff515a', fontSize: 37, fontWeight: 800 }}>利润几乎清零</div><div style={{ color: '#aab8c9', fontSize: 21, marginTop: 16 }}>当期结果承压</div></div><div style={{ color: '#ff515a', fontSize: 70, fontWeight: 800, opacity: vs }}>VS</div><div style={{ width: 360, padding: 35, borderRadius: 22, border: '1px solid #f6bb4d88', opacity: b, transform: `translateX(${(1 - b) * 34}px)`, textAlign: 'center' }}><div style={{ color: '#f6bb4d', fontSize: 37, fontWeight: 800 }}>研发 · 建厂加速</div><div style={{ color: '#aab8c9', fontSize: 21, marginTop: 16 }}>为下一阶段下注</div></div></div>;
};

const ResearchStage: React.FC = () => {
  const frame = useCurrentFrame();
  const draw = interpolate(frame, [Math.round(48.1 * fps), Math.round(56.3 * fps)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <><div style={{ position: 'absolute', left: 42, right: 42, top: 180, display: 'flex', gap: 18 }}><MetricCard label="研发费用率" value="4.32%" note="二季度" color="#47c8df" from={48.0} /><MetricCard label="同比变化" value="+1.02pct" note="费用率上升" color="#62d8a2" from={52.0} /><MetricCard label="营业收入" value="−14.8%" note="分母收缩" color="#ff515a" from={58.3} /></div><svg viewBox="0 0 900 240" style={{ position: 'absolute', left: 76, right: 60, bottom: 55, width: '88%', height: 215 }}><line x1="0" x2="860" y1="192" y2="192" stroke="#405268" /><polyline points="40,65 250,92 470,125 675,152 850,184" fill="none" stroke="#ff515a" strokeWidth="6" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - draw} /><polyline points="40,171 250,153 470,126 675,100 850,70" fill="none" stroke="#47c8df" strokeWidth="7" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - draw} /><text x="702" y="52" fill="#47c8df" fontSize="24">研发率 ↑</text><text x="702" y="212" fill="#ff515a" fontSize="24">营收 ↓</text></svg></>;
};

const TechnologyStage: React.FC = () => {
  const frame = useCurrentFrame();
  const old = pop(frame, 63.5);
  const next = pop(frame, 68.6);
  const window = pop(frame, 78.1);
  const proof = pop(frame, 99.0);
  return <div style={{ position: 'absolute', inset: 0 }}><div style={{ position: 'absolute', left: 78, right: 78, top: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 42 }}><div style={{ opacity: old, border: '1px solid #47c8df99', borderRadius: 18, padding: '35px 40px', color: '#ccecf2', fontSize: 34 }}>传统液压制动</div><div style={{ opacity: next, color: '#62d8a2', fontSize: 70 }}>→</div><div style={{ opacity: next, border: '1px solid #62d8a2', borderRadius: 18, padding: '35px 40px', color: '#f7fbff', fontSize: 34, boxShadow: '0 0 28px #62d8a22f' }}>电子刹车 / 线控制动</div></div><div style={{ position: 'absolute', top: 405, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 22, opacity: window }}><span style={{ color: '#f6bb4d', border: '1px solid #f6bb4d77', padding: '12px 20px', borderRadius: 99, fontSize: 24 }}>技术窗口：2–3 年</span><span style={{ color: '#a9b9cd', padding: '12px 5px', fontSize: 24 }}>H1 费用增长，大概率投向这里</span></div><div style={{ position: 'absolute', bottom: 62, left: 70, right: 70, opacity: proof, padding: '18px 28px', borderRadius: 14, background: 'rgba(18,45,54,.72)', color: '#62d8a2', fontSize: 27, textAlign: 'center' }}>Q3 验证点：主机厂定点 → 研发投入进入兑现阶段</div></div>;
};

const ConstructionStage: React.FC = () => {
  const frame = useCurrentFrame();
  const bars = [0.12, .25, .43, .68, 1];
  return <div style={{ position: 'absolute', left: 70, right: 70, top: 190, bottom: 64, display: 'flex', alignItems: 'flex-end', gap: 35 }}><div style={{ flex: 1, height: 300, display: 'flex', alignItems: 'flex-end', gap: 26, borderBottom: '1px solid #405268', padding: '0 30px' }}>{bars.map((height, index) => { const p = pop(frame, 112 + index * 2.3); return <div key={index} style={{ flex: 1, height: `${height * 100}%`, borderRadius: '12px 12px 0 0', background: 'linear-gradient(#f6bb4d, #9b5d23)', opacity: p, transform: `scaleY(${p})`, transformOrigin: 'bottom' }} />; })}</div><div style={{ width: 345 }}><MetricCard label="在建工程" value="0.4 亿" note="期末规模" color="#f6bb4d" from={111} /><div style={{ color: '#f6bb4d', fontSize: 34, fontWeight: 800, marginTop: 28, opacity: pop(frame, 114.5) }}>同比 +139.6%</div><div style={{ color: '#c7d2df', fontSize: 22, lineHeight: 1.5, marginTop: 15, opacity: pop(frame, 124) }}>产能周期 1–2 年<br />对应 2027–2028 年供给能力</div></div></div>;
};

const CashStage: React.FC = () => {
  const frame = useCurrentFrame();
  const nodes = [{ title: '技术转型', note: '淘汰落后产能', color: '#47c8df', from: 151.5 }, { title: '龙头份额↑', note: '活下来才能受益', color: '#62d8a2', from: 156.9 }, { title: '现金流', note: '自有现金 / 新增借款', color: '#f6bb4d', from: 161.3 }];
  return <div style={{ position: 'absolute', left: 55, right: 55, top: 245, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{nodes.map((node, index) => { const p = pop(frame, node.from); return <div key={node.title} style={{ display: 'flex', alignItems: 'center', gap: 28 }}><div style={{ width: 240, padding: '28px 20px', textAlign: 'center', border: `1px solid ${node.color}99`, borderRadius: 20, opacity: p, transform: `translateY(${(1 - p) * 24}px)`, boxShadow: `0 0 30px ${node.color}22` }}><div style={{ color: node.color, fontSize: 31, fontWeight: 800 }}>{node.title}</div><div style={{ color: '#cbd7e5', fontSize: 19, marginTop: 12 }}>{node.note}</div></div>{index < nodes.length - 1 && <div style={{ color: '#8899ad', fontSize: 48, opacity: pop(frame, node.from + 2.3) }}>→</div>}</div>; })}</div>;
};

const EfficiencyStage: React.FC = () => {
  const frame = useCurrentFrame();
  const p = pop(frame, 171);
  const angle = interpolate(p, [0, 1], [-120, -5]);
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 110 }}><div style={{ width: 285, height: 170, border: '23px solid #1c3858', borderBottom: 0, borderRadius: '285px 285px 0 0', position: 'relative', overflow: 'hidden' }}><div style={{ position: 'absolute', bottom: 0, left: 93, width: 116, height: 9, background: '#47c8df', transformOrigin: 'left center', transform: `rotate(${angle}deg)`, boxShadow: '0 0 16px #47c8df' }} /><div style={{ position: 'absolute', bottom: 20, left: 67, color: '#fff', fontSize: 42, fontWeight: 800 }}>1.53</div></div><div style={{ opacity: pop(frame, 177) }}><div style={{ color: '#aab8c9', fontSize: 25 }}>行业正常区间</div><div style={{ color: '#62d8a2', fontSize: 58, fontWeight: 800, marginTop: 12 }}>1.5 — 3.0 次</div><div style={{ color: '#d6e0ec', fontSize: 24, marginTop: 24 }}>Q3 营收回到 <span style={{ color: '#f6bb4d', fontWeight: 800 }}>4.5 亿+</span><br />周转率将自然修复</div></div></div>;
};

const CapexStage: React.FC = () => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [Math.round(204 * fps), Math.round(209.5 * fps)], [0, 65.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const risk = pop(frame, 218);
  return <div style={{ position: 'absolute', left: 85, right: 85, top: 235 }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#b7c6d8', fontSize: 25 }}><span>当前安全范围</span><span style={{ color: '#ff515a', opacity: risk }}>风险阈值 80%</span></div><div style={{ height: 72, borderRadius: 36, background: '#182943', marginTop: 24, position: 'relative', overflow: 'hidden' }}><div style={{ height: '100%', width: `${fill}%`, borderRadius: 36, background: 'linear-gradient(90deg, #47c8df, #62d8a2)', boxShadow: '0 0 26px #47c8df78' }} /><div style={{ position: 'absolute', left: '80%', top: -12, bottom: -12, borderLeft: '4px dashed #ff515a', opacity: risk }} /></div><div style={{ marginTop: 22, color: '#62d8a2', fontSize: 60, fontWeight: 800 }}>65.6%</div><div style={{ color: '#c6d1df', fontSize: 25, marginTop: 20, opacity: risk }}>在建工程大规模转固、营收跟不上 → 折旧与闲置产能同时冲击</div></div>;
};

const InventoryStage: React.FC = () => {
  const frame = useCurrentFrame();
  const p = pop(frame, 239);
  const risk = pop(frame, 253);
  return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 90 }}><div style={{ position: 'relative', width: 250, height: 250, borderRadius: '50%', opacity: p, background: 'conic-gradient(#47c8df 0 44.8%, #2a3a50 44.8% 100%)', boxShadow: '0 0 36px #47c8df33' }}><div style={{ position: 'absolute', inset: 45, borderRadius: '50%', background: '#0d1520', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f1f5fb', fontSize: 36, fontWeight: 800 }}>44.8%</div></div><div><div style={{ color: '#f0f5fc', fontSize: 34, fontWeight: 800 }}>存货营收比 · 正常区间</div><div style={{ color: '#aebdce', fontSize: 24, marginTop: 22, lineHeight: 1.6 }}>按订单生产<br />库存以原材料为主<br />产成品积压风险不高</div><div style={{ color: '#f6bb4d', fontSize: 25, fontWeight: 700, marginTop: 24, opacity: risk }}>钢价下行 → 关注跌价准备</div></div></div>;
};

const ChecklistStage: React.FC = () => {
  const frame = useCurrentFrame();
  const items = ['电子刹车定点与扩产', '资金来源结构', '营收回到 4.5 亿以上', '在建工程转固节点', '存货跌价准备变化'];
  return <div style={{ position: 'absolute', top: 178, left: 62, right: 62, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>{items.map((item, index) => { const p = pop(frame, 269 + index * 2.6); return <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 16, border: '1px solid rgba(98,216,162,.55)', borderRadius: 15, padding: '18px 22px', color: '#edf3fb', fontSize: 25, opacity: p, transform: `translateX(${(1 - p) * 18}px)` }}><span style={{ color: '#62d8a2', fontSize: 28 }}>✓</span>{item}</div>; })}</div>;
};

const DataStage: React.FC = () => {
  const frame = useCurrentFrame();
  const seconds = frame / fps;
  const section = sections.find((item) => seconds >= item.from && seconds < item.until) ?? sections[sections.length - 1];
  const content: Record<SectionId, React.ReactNode> = { hook: <HookStage />, conflict: <ConflictStage />, research: <ResearchStage />, technology: <TechnologyStage />, construction: <ConstructionStage />, cash: <CashStage />, efficiency: <EfficiencyStage />, capex: <CapexStage />, inventory: <InventoryStage />, checklist: <ChecklistStage /> };
  return <PanelShell><PanelHeader section={section} />{content[section.id]}</PanelShell>;
};

const TitleInterlude: React.FC = () => {
  const frame = useCurrentFrame();
  const seconds = frame / fps;
  const opacity = interpolate(seconds, [13.1, 13.7, 16.7, 17.5], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  if (opacity === 0) return null;
  return <AbsoluteFill style={{ zIndex: 8, opacity, background: 'rgba(4,8,14,.88)', alignItems: 'center', justifyContent: 'center' }}><Img src={staticFile('assets/financial-dialogue/title-card.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: .96 }} /><div style={{ position: 'absolute', top: 46, left: 64, color: '#edf4ff', fontSize: 23, letterSpacing: 3 }}>原创财经解读栏目</div></AbsoluteFill>;
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const progress = (frame / FINANCIAL_DIALOGUE_DURATION_FRAMES) * 100;
  const active = sections.findIndex((item) => frame / fps >= item.from && frame / fps < item.until);
  return <div style={{ position: 'absolute', left: 54, right: 54, bottom: 35 }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f849e', fontSize: 16, letterSpacing: 1.5 }}><span>{sections[Math.max(0, active)].label}</span><span>{Math.floor(frame / fps / 60)}:{String(Math.floor(frame / fps) % 60).padStart(2, '0')} / 4:54</span></div><div style={{ height: 5, background: '#344150', borderRadius: 9, marginTop: 11 }}><div style={{ height: '100%', width: `${progress}%`, background: '#f14d51', boxShadow: '0 0 12px #f14d51', borderRadius: 9 }} /></div></div>;
};

export const FinancialReportDialogue: React.FC = () => {
  const frame = useCurrentFrame();
  const seconds = frame / fps;
  const current = dialogue.find((line) => seconds >= line.start && seconds < line.start + line.duration + .28);
  return <AbsoluteFill style={{ fontFamily: fontStack }}><GridBackground /><div style={{ position: 'absolute', left: 54, top: 40, color: '#dce5f1', fontSize: 17, letterSpacing: 2 }}>FINANCIAL REPORT / DIALOGUE EDITION</div><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ position: 'absolute', top: 30, right: 58, width: 290, height: 'auto', objectFit: 'contain' }} /><SpeakerPanel role="female" line={current?.role === 'female' ? current : undefined} active={current?.role === 'female'} /><SpeakerPanel role="male" line={current?.role === 'male' ? current : undefined} active={current?.role === 'male'} /><DataStage /><TitleInterlude /><ProgressBar />{dialogue.map((line) => <Sequence key={line.id} from={Math.round(line.start * fps)}><Audio src={staticFile(`audio/financial-dialogue/clips/${line.file}`)} /></Sequence>)}</AbsoluteFill>;
};
