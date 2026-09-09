import {
  AbsoluteFill,
  Audio,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';
import timingSource from '../public/audio/financial-dialogue-v3/timeline.json';
import { FINANCIAL_INTRO_SFX_DURATION_FRAMES, FinancialIntroPortraitSfx, FinancialIntroTypographySfx } from './FinancialIntros';

type Role = 'female' | 'male';
type SectionId = 'opening' | 'research' | 'construction' | 'operations' | 'q3' | 'closing';
type Utterance = {
  id: string;
  role: Role;
  chapter: SectionId;
  text: string;
  file: string;
  start_seconds: number;
  duration_seconds: number;
};

const timing = timingSource as unknown as { total_seconds: number; total_frames: number; utterances: Utterance[] };
const fps = 30;
const introFrames = FINANCIAL_INTRO_SFX_DURATION_FRAMES;
const hook = timing.utterances[0];
const contentUtterances = timing.utterances.slice(1);
const mainStartSeconds = contentUtterances[0]?.start_seconds ?? 0;
const hookFrames = Math.round(hook.duration_seconds * fps);
const contentStartFrame = hookFrames + introFrames;
const contentDurationSeconds = Math.max(0, timing.total_seconds - mainStartSeconds);
const toContentSeconds = (absoluteSeconds: number) => Math.max(0, absoluteSeconds - mainStartSeconds);
// Finish on the final spoken sample—there is intentionally no silent logo hold
// or end sting after the female sign-off.
export const FINANCIAL_DIALOGUE_V3_DURATION_FRAMES = contentStartFrame + Math.round(contentDurationSeconds * fps);
const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const startFor = (id: string) => timing.utterances.find((item) => item.id === id)?.start_seconds ?? 0;
const endFor = (id: string) => {
  const utterance = timing.utterances.find((item) => item.id === id);
  return (utterance?.start_seconds ?? 0) + (utterance?.duration_seconds ?? 0);
};
type Section = {
  id: SectionId;
  label: string;
  title: string;
  summary: string;
  from: number;
  until: number;
  // The title occupies the deliberate transition gap before its first line.
  // This keeps the voiceover clean: title first, then the presenter speaks.
  titleStart?: number;
};

const sections: Section[] = [
  { id: 'opening', label: '01 开场', title: '利润收缩，投入为何加速？', summary: '一边利润承压，一边研发与建厂加速', from: 0, until: toContentSeconds(startFor('03-research-question')) },
  { id: 'research', label: '02 研发投入', title: '4.32% 的研发费率，投向下一代制动', summary: 'Q3 主机厂定点，是研发兑现的首个验证', from: toContentSeconds(startFor('03-research-question')), until: toContentSeconds(startFor('07-construction-question')), titleStart: toContentSeconds(endFor('02-opening-answer')) },
  { id: 'construction', label: '03 逆势扩产', title: '0.4 亿在建工程，下注 2027–2028', summary: '扩产能否兑现，前提是现金流撑到需求回暖', from: toContentSeconds(startFor('07-construction-question')), until: toContentSeconds(startFor('09-operations-question')), titleStart: toContentSeconds(endFor('06-research-proof-answer')) },
  { id: 'operations', label: '04 运营体质', title: '周转、Capex 与存货的三重验证', summary: '效率仍可修复，但转固和跌价准备需持续跟踪', from: toContentSeconds(startFor('09-operations-question')), until: toContentSeconds(startFor('13-q3-signals')), titleStart: toContentSeconds(endFor('08-construction-answer')) },
  { id: 'q3', label: '05 Q3 验证点', title: '五个信号，决定投入成败', summary: '定点、资金、营收、转固、跌价准备', from: toContentSeconds(startFor('13-q3-signals')), until: toContentSeconds(startFor('16-closing-female')), titleStart: toContentSeconds(endFor('12-capex-inventory-answer')) },
  { id: 'closing', label: '收束', title: '看利润，也看未来回报', summary: '每期三分钟，拆解财报里的关键信号', from: toContentSeconds(startFor('16-closing-female')), until: contentDurationSeconds },
];
const fullScreenOutroStartSeconds = toContentSeconds(startFor('16-closing-female'));
const fullScreenOutroStartFrame = contentStartFrame + Math.round(fullScreenOutroStartSeconds * fps);

const arrive = (value: number, from = 0, duration = 13) => interpolate(value, [from, from + duration], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame % 240) * 0.23;
  return <AbsoluteFill style={{ overflow: 'hidden', background: '#060b14' }}><AbsoluteFill style={{ opacity: .35, backgroundImage: 'linear-gradient(rgba(94,118,154,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(94,118,154,.12) 1px, transparent 1px)', backgroundSize: '84px 84px', backgroundPosition: `${drift}px ${drift * .42}px` }} /><AbsoluteFill style={{ background: 'radial-gradient(circle at 72% 14%, rgba(19,114,136,.22), transparent 28%), radial-gradient(circle at 12% 88%, rgba(159,33,47,.20), transparent 35%)' }} /><div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 7, background: 'linear-gradient(90deg, #ef454a 0 27%, #233044 27% 100%)' }} /></AbsoluteFill>;
};

const Avatar: React.FC<{ role: Role; active: boolean; size?: number }> = ({ role, active, size = 98 }) => {
  const female = role === 'female';
  const accent = female ? '#ef5258' : '#49c7df';
  const source = female ? 'assets/financial-dialogue/female-host.png' : 'assets/financial-dialogue/male-chief.png';
  return <div style={{ width: size, height: size, padding: Math.max(3, size * .045), borderRadius: '50%', background: active ? accent : '#2a3849', boxShadow: active ? `0 0 ${Math.round(size * .28)}px ${accent}9b` : 'none' }}><div style={{ height: '100%', overflow: 'hidden', borderRadius: '50%' }}><Img src={staticFile(source)} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: female ? '50% 9%' : '50% 10%', transform: 'scale(1.36)' }} /></div></div>;
};

const keyLines: Record<string, string> = {
  '01-opening-question': '利润为什么几乎清零？',
  '02-opening-answer': '短期利润收缩，长期投入加速',
  '03-research-question': '研发反增，投向哪里？',
  '04-research-context': '线控制动，窗口只剩两到三年',
  '05-research-proof-question': '怎样才算研发兑现？',
  '06-research-proof-answer': 'Q3 主机厂定点，是兑现门槛',
  '07-construction-question': '业绩收缩，为什么继续建厂？',
  '08-construction-answer': '下注 2027–2028 年供给',
  '09-operations-question': '运营体质，撑得住这场押注吗？',
  '10-turnover-answer': '更像主动压缩低效产能',
  '11-capex-question': 'Capex 与存货，会拖累利润吗？',
  '12-capex-inventory-answer': '80%，是风险阈值',
  '13-q3-signals': 'Q3，盯住五个验证信号',
  '14-q3-conclusion': '提前卡位，还是利润压力？',
  '15-closing-male': '投入必须指向未来回报',
  '16-closing-female': '拆解财报里的关键信号',
};

const speakerMeta = (role: Role) => role === 'female'
  ? { name: '财小策', title: '提问与验证', accent: '#ef5258' }
  : { name: '室长', title: '拆解与判断', accent: '#49c7df' };

const FocusSpeaker: React.FC<{ active: Utterance; activeStartFrame: number }> = ({ active, activeStartFrame }) => {
  const female = active.role === 'female';
  const meta = speakerMeta(active.role);
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - activeStartFrame);
  const p = arrive(local);
  const direction = female ? 1 : -1;
  return <div style={{ position: 'absolute', top: 124, zIndex: 15, display: 'flex', flexDirection: female ? 'row-reverse' : 'row', alignItems: 'center', gap: 17, [female ? 'right' : 'left']: 52, opacity: p, transform: `translateX(${(1 - p) * direction * 28}px) scale(${.84 + p * .16})`, transformOrigin: female ? 'right top' : 'left top' }}><Avatar role={active.role} active size={130} /><div style={{ minWidth: 310, maxWidth: 540, padding: '15px 21px 17px', border: `1px solid ${meta.accent}91`, borderRadius: 18, background: 'linear-gradient(145deg, rgba(13,22,35,.97), rgba(8,14,24,.93))', boxShadow: `0 12px 34px ${meta.accent}22` }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18 }}><div style={{ color: '#eff6ff', fontSize: 23, fontWeight: 800 }}>{meta.name}</div><div style={{ color: '#92a8bd', fontSize: 14, letterSpacing: 1.2 }}>{meta.title}</div></div><div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9 }}><div style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: meta.accent, boxShadow: `0 0 10px ${meta.accent}` }} /><div style={{ color: '#f5f9ff', fontSize: 29, lineHeight: 1.2, fontWeight: 800, letterSpacing: .3 }}>{keyLines[active.id] ?? active.text}</div></div></div></div>;
};

const IdleSpeaker: React.FC<{ role: Role }> = ({ role }) => {
  const female = role === 'female';
  const meta = speakerMeta(role);
  return <div style={{ position: 'absolute', top: 150, zIndex: 11, display: 'flex', flexDirection: female ? 'row-reverse' : 'row', alignItems: 'center', gap: 10, [female ? 'right' : 'left']: 58, opacity: .3 }}><Avatar role={role} active={false} size={64} /><div style={{ color: '#9caec0', fontSize: 17, fontWeight: 700 }}>{meta.name}</div></div>;
};

const Metric: React.FC<{ label: string; value: string; note: string; color: string; show: number }> = ({ label, value, note, color, show }) => {
  const p = arrive(show);
  return <div style={{ flex: 1, minHeight: 140, padding: '20px 22px', borderRadius: 16, border: `1px solid ${color}86`, opacity: p, transform: `translateY(${(1 - p) * 20}px)`, background: 'linear-gradient(145deg, rgba(20,31,46,.96), rgba(9,15,25,.92))', boxShadow: `0 0 24px ${color}15` }}><div style={{ color: '#95a8bd', fontSize: 19 }}>{label}</div><div style={{ marginTop: 9, color, fontSize: 42, fontWeight: 800 }}>{value}</div><div style={{ marginTop: 8, color: '#d5deea', fontSize: 18 }}>{note}</div></div>;
};

const OpeningStage: React.FC<{ local: number }> = ({ local }) => <div style={{ position: 'absolute', top: 170, left: 42, right: 42, display: 'flex', gap: 15 }}><Metric label="营业收入" value="−14.8%" note="规模收缩" color="#ef5258" show={local} /><Metric label="归母净利" value="−73.1%" note="利润承压" color="#ef5258" show={local - 45} /><Metric label="研发费率" value="+1.02pct" note="逆势上升" color="#49c7df" show={local - 90} /><Metric label="在建工程" value="+139.6%" note="投入加速" color="#f6bc4a" show={local - 135} /></div>;

const ResearchStage: React.FC<{ local: number }> = ({ local }) => {
  const line = arrive(local, 28, 45);
  return <><div style={{ position: 'absolute', top: 178, left: 75, right: 75, display: 'flex', gap: 20 }}><Metric label="研发费用率" value="4.32%" note="二季度" color="#49c7df" show={local} /><Metric label="同比提升" value="+1.02pct" note="营收下滑仍反增" color="#63d9a3" show={local - 45} /><Metric label="验证节点" value="Q3 定点" note="主机厂订单验证" color="#f6bc4a" show={local - 95} /></div><svg viewBox="0 0 900 190" style={{ position: 'absolute', left: 72, bottom: 55, width: '89%', height: 190 }}><line x1="32" x2="860" y1="155" y2="155" stroke="#42566e" /><polyline points="55,44 255,70 470,105 670,132 850,150" fill="none" stroke="#ef5258" strokeWidth="6" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - line} /><polyline points="55,145 255,128 470,104 670,75 850,48" fill="none" stroke="#49c7df" strokeWidth="7" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - line} /><text x="680" y="38" fill="#49c7df" fontSize="22">研发率 ↑</text><text x="690" y="178" fill="#ef5258" fontSize="22">营收 ↓</text></svg></>;
};

const ConstructionStage: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 18, 28);
  const years = ['2026', '2027', '2028'];
  return <div style={{ position: 'absolute', left: 75, right: 75, top: 185 }}><div style={{ display: 'flex', gap: 20 }}><Metric label="在建工程" value="0.4 亿" note="期末规模" color="#f6bc4a" show={local} /><Metric label="同比变化" value="+139.6%" note="逆势扩产" color="#f6bc4a" show={local - 42} /></div><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 74, opacity: p }}><div style={{ color: '#f2f6fb', fontSize: 30, fontWeight: 800 }}>今天投入</div><div style={{ height: 3, flex: 1, margin: '0 34px', background: '#455a70', position: 'relative' }}><div style={{ position: 'absolute', left: 0, top: -5, width: `${p * 100}%`, height: 13, borderRadius: 10, background: '#f6bc4a', boxShadow: '0 0 18px #f6bc4a' }} /></div><div style={{ color: '#f2f6fb', fontSize: 30, fontWeight: 800 }}>未来供给</div></div><div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 90px', color: '#b6c6d7', fontSize: 23, opacity: p }}>{years.map((year) => <span key={year}>{year}</span>)}</div><div style={{ marginTop: 42, padding: '16px 25px', borderRadius: 13, color: '#d8e2ec', background: 'rgba(20,37,49,.72)', textAlign: 'center', fontSize: 24, opacity: arrive(local, 80) }}>现金流能否撑到需求回暖，是扩产成立的前提</div></div>;
};

const OperationsStage: React.FC<{ local: number }> = ({ local }) => {
  const gauge = arrive(local, 16, 23);
  const capex = arrive(local, 300, 26);
  const inventory = arrive(local, 470, 24);
  return <div style={{ position: 'absolute', left: 72, right: 72, top: 175 }}><div style={{ display: 'flex', gap: 30, alignItems: 'center' }}><div style={{ width: 255, opacity: gauge }}><div style={{ color: '#a6b7c9', fontSize: 20 }}>固定资产周转率</div><div style={{ color: '#49c7df', fontSize: 72, fontWeight: 800, marginTop: 14 }}>1.53<span style={{ fontSize: 28 }}> 次</span></div><div style={{ color: '#d5dfe9', fontSize: 20 }}>行业正常区间 1.5–3.0</div></div><div style={{ flex: 1, padding: '22px 28px', borderRadius: 16, border: '1px solid #49c7df66', color: '#dce7f2', fontSize: 25, lineHeight: 1.5, opacity: gauge }}>周转降幅小于营收<br /><span style={{ color: '#63d9a3' }}>更像主动压缩低效产能</span><br />Q3 营收回到 <strong style={{ color: '#f6bc4a' }}>4.5 亿+</strong>，周转率有望修复</div></div><div style={{ marginTop: 45, opacity: capex }}><div style={{ display: 'flex', justifyContent: 'space-between', color: '#c4d3e1', fontSize: 21 }}><span>Capex 强度</span><span style={{ color: '#ef5258' }}>风险阈值 80%</span></div><div style={{ height: 52, marginTop: 13, overflow: 'hidden', borderRadius: 28, background: '#1a2b43', position: 'relative' }}><div style={{ width: '65.6%', height: '100%', borderRadius: 28, background: 'linear-gradient(90deg, #49c7df, #63d9a3)' }} /><div style={{ position: 'absolute', left: '80%', top: -7, bottom: -7, borderLeft: '3px dashed #ef5258' }} /></div><div style={{ marginTop: 9, color: '#63d9a3', fontSize: 34, fontWeight: 800 }}>65.6%</div></div><div style={{ marginTop: 30, display: 'flex', alignItems: 'center', gap: 22, opacity: inventory }}><div style={{ width: 78, height: 78, borderRadius: '50%', background: 'conic-gradient(#49c7df 0 44.8%, #27394d 44.8% 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 17, fontWeight: 800 }}>44.8%</div><div style={{ color: '#d5e0eb', fontSize: 23 }}>存货营收比仍在正常区间<br /><span style={{ color: '#f6bc4a' }}>关注钢价下行与跌价准备</span></div></div></div>;
};

const Q3Stage: React.FC<{ local: number }> = ({ local }) => {
  const items = ['电子刹车定点与扩产', '资金来源结构', '营收回到 4.5 亿以上', '在建工程转固时间', '存货跌价准备变化'];
  return <div style={{ position: 'absolute', top: 174, left: 68, right: 68, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 17 }}>{items.map((item, index) => { const p = arrive(local, index * 52, 18); return <div key={item} style={{ padding: '20px 22px', display: 'flex', gap: 14, alignItems: 'center', border: '1px solid #63d9a377', borderRadius: 15, color: '#edf5fc', fontSize: 25, opacity: p, transform: `translateX(${(1 - p) * 18}px)` }}><span style={{ color: '#63d9a3', fontSize: 30 }}>✓</span>{item}</div>; })}</div>;
};

const Dashboard: React.FC<{ section: Section; seconds: number }> = ({ section, seconds }) => {
  const local = Math.max(0, (seconds - section.from) * fps);
  let stage: React.ReactNode = <OpeningStage local={local} />;
  if (section.id === 'research') stage = <ResearchStage local={local} />;
  if (section.id === 'construction') stage = <ConstructionStage local={local} />;
  if (section.id === 'operations') stage = <OperationsStage local={local} />;
  if (section.id === 'q3') stage = <Q3Stage local={local} />;
  return <div style={{ position: 'absolute', top: 280, left: 58, right: 58, bottom: 150, overflow: 'hidden', border: '1px solid rgba(133,158,187,.25)', borderRadius: 23, background: 'linear-gradient(145deg, rgba(13,22,34,.94), rgba(8,14,23,.8))', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.04)' }}><div style={{ position: 'absolute', top: 25, left: 42, right: 42 }}><div style={{ color: '#ef5258', fontSize: 16, letterSpacing: 3, fontWeight: 800 }}>{section.label}</div><div style={{ marginTop: 9, color: '#f1f6fb', fontSize: 37, fontWeight: 800 }}>{section.title}</div></div>{stage}</div>;
};

// The closing uses the approved all-typography master animation. Its scan SFX
// is kept deliberately under the final female line rather than replacing it.
const FullScreenOutro: React.FC = () => <AbsoluteFill style={{ zIndex: 40 }}><FinancialIntroTypographySfx soundVolume={.18} /></AbsoluteFill>;

const HookScene: React.FC = () => {
  const frame = useCurrentFrame();
  return <><Dashboard section={sections[0]} seconds={frame / fps} /><FocusSpeaker active={hook} activeStartFrame={0} /></>;
};

const ChapterNav: React.FC<{ seconds: number }> = ({ seconds }) => {
  const active = Math.max(0, sections.findIndex((item) => seconds >= item.from && seconds < item.until));
  const progress = Math.min(100, (seconds / contentDurationSeconds) * 100);
  return <div style={{ position: 'absolute', left: 48, right: 48, bottom: 20, height: 100 }}><div style={{ position: 'absolute', left: 0, right: 0, bottom: 76, color: '#aebdce', fontSize: 20, textAlign: 'center' }}>{sections[Math.min(active, sections.length - 1)].summary}</div><div style={{ position: 'absolute', left: 0, right: 0, bottom: 50, color: '#71869d', fontSize: 14, textAlign: 'center' }}>本内容基于公开财报数据整理，不构成投资建议。市场有风险，决策需谨慎。</div><div style={{ position: 'absolute', left: 0, right: 0, bottom: 12, display: 'flex', height: 26, border: '1px solid #3c4c60', overflow: 'hidden', background: 'rgba(8,13,22,.82)' }}>{sections.slice(0, 5).map((item, index) => <div key={item.id} style={{ flex: 1, borderRight: index === 4 ? 'none' : '1px solid #3c4c60', color: active === index ? '#07101b' : '#9baabd', fontSize: 16, fontWeight: 800, textAlign: 'center', lineHeight: '26px', background: active === index ? '#e8eef5' : 'transparent' }}>{item.label.replace(/^0\d\s/, '')}</div>)}</div><div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, borderRadius: 4, background: '#334357' }}><div style={{ width: `${progress}%`, height: '100%', borderRadius: 4, background: '#ef5258', boxShadow: '0 0 12px #ef5258' }} /></div></div>;
};

const ChapterFlash: React.FC<{ section: Section; seconds: number }> = ({ section, seconds }) => {
  const titleStart = section.titleStart;
  if (titleStart === undefined || section.id === 'opening' || section.id === 'closing') return null;
  const titleDuration = titleStart === undefined ? 0 : section.from - titleStart;
  const local = titleStart === undefined ? -1 : seconds - titleStart;
  const opacity = interpolate(local, [0, Math.min(.2, titleDuration * .2), Math.max(.3, titleDuration - .28), titleDuration], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // A chapter card only lives in the previous line's intentional gap. At the
  // first frame of the next line it is already gone, so it never competes with
  // the active speaker card.
  if (local < 0 || local >= titleDuration) return null;
  return <AbsoluteFill style={{ zIndex: 8, opacity, background: 'rgba(4,9,16,.76)', alignItems: 'center', justifyContent: 'center' }}><div style={{ color: '#ef5258', fontSize: 19, letterSpacing: 4 }}>{section.label}</div><div style={{ marginTop: 13, color: '#f2f7fc', fontSize: 53, fontWeight: 800 }}>{section.title}</div></AbsoluteFill>;
};

const SfxLayer: React.FC = () => {
  const events = [
    { at: toContentSeconds(startFor('03-research-question')), file: 'section-tech-sweep.wav', volume: .18 },
    { at: toContentSeconds(startFor('03-research-question')) + .7, file: 'headline-land.wav', volume: .18 },
    { at: toContentSeconds(startFor('06-research-proof-answer')) + .5, file: 'data-tick-crisp.wav', volume: .22 },
    { at: toContentSeconds(startFor('07-construction-question')), file: 'section-tech-sweep.wav', volume: .18 },
    { at: toContentSeconds(startFor('07-construction-question')) + 2.1, file: 'number-counter-fast.wav', volume: .18 },
    { at: toContentSeconds(startFor('09-operations-question')), file: 'section-tech-sweep.wav', volume: .18 },
    { at: toContentSeconds(startFor('12-capex-inventory-answer')) + 6.0, file: 'risk-alert.wav', volume: .18 },
    { at: toContentSeconds(startFor('13-q3-signals')), file: 'headline-land.wav', volume: .18 },
    { at: toContentSeconds(startFor('13-q3-signals')) + 1.2, file: 'data-tick-crisp.wav', volume: .2 },
    { at: toContentSeconds(startFor('13-q3-signals')) + 3.1, file: 'data-tick-crisp.wav', volume: .2 },
    { at: toContentSeconds(startFor('13-q3-signals')) + 5.0, file: 'data-tick-crisp.wav', volume: .2 },
  ];
  return <>{events.map((event, index) => <Sequence key={`${event.file}-${index}`} from={contentStartFrame + Math.round(event.at * fps)}><Audio src={staticFile(`audio/financial-dialogue-v3/sfx/${event.file}`)} volume={event.volume} /></Sequence>)}</>;
};

const HookSfx: React.FC = () => {
  const events = [
    { at: 2.0, file: 'bearish-drop-short.wav', volume: .23 },
    { at: 3.8, file: 'data-tick-soft.wav', volume: .25 },
    { at: 5.2, file: 'number-counter-fast.wav', volume: .2 },
  ];
  return <>{events.map((event, index) => <Sequence key={`${event.file}-${index}`} from={Math.round(event.at * fps)}><Audio src={staticFile(`audio/financial-dialogue-v3/sfx/${event.file}`)} volume={event.volume} /></Sequence>)}</>;
};

const BgmLayer: React.FC = () => <><Sequence from={0} durationInFrames={3600}><Audio src={staticFile('audio/financial-dialogue-v3/music/immersed.mp3')} volume={(frame) => frame < 45 ? .12 * frame / 45 : frame > 3480 ? .12 * Math.max(0, (3600 - frame) / 120) : .12} /></Sequence><Sequence from={3480} durationInFrames={3600}><Audio src={staticFile('audio/financial-dialogue-v3/music/immersed.mp3')} volume={(frame) => Math.min(.12, .12 * frame / 120)} /></Sequence></>;

export const FinancialReportDialogueV3: React.FC = () => {
  const frame = useCurrentFrame();
  const inHook = frame < hookFrames;
  const inMain = frame >= contentStartFrame;
  const seconds = Math.max(0, (frame - contentStartFrame) / fps);
  const inFullScreenOutro = inMain && seconds >= fullScreenOutroStartSeconds;
  const current = contentUtterances.find((item) => seconds >= toContentSeconds(item.start_seconds) && seconds < toContentSeconds(item.start_seconds) + item.duration_seconds);
  const section = sections.find((item) => seconds >= item.from && seconds < item.until) ?? sections[sections.length - 1];
  const currentStartFrame = current ? contentStartFrame + Math.round(toContentSeconds(current.start_seconds) * fps) : 0;
  const idleRole: Role | undefined = current ? (current.role === 'female' ? 'male' : 'female') : undefined;
  return <AbsoluteFill style={{ fontFamily: fontStack }}><Background /><BgmLayer />{inHook && <HookScene />}{inMain && !inFullScreenOutro && <><div style={{ position: 'absolute', top: 29, right: 54, zIndex: 4 }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: 255, height: 'auto' }} /></div><Dashboard section={section} seconds={seconds} />{idleRole && <IdleSpeaker role={idleRole} />}{current && <FocusSpeaker active={current} activeStartFrame={currentStartFrame} />}<ChapterNav seconds={seconds} />{sections.map((chapter) => <ChapterFlash key={chapter.id} section={chapter} seconds={seconds} />)}</>}{inFullScreenOutro && <Sequence from={fullScreenOutroStartFrame}><FullScreenOutro /></Sequence>}<Sequence from={0} durationInFrames={hookFrames}><Audio src={staticFile(`audio/financial-dialogue-v3/clips/${hook.file}`)} /></Sequence><Sequence from={hookFrames} durationInFrames={introFrames}><FinancialIntroPortraitSfx /></Sequence>{contentUtterances.map((item) => <Sequence key={item.id} from={contentStartFrame + Math.round(toContentSeconds(item.start_seconds) * fps)}><Audio src={staticFile(`audio/financial-dialogue-v3/clips/${item.file}`)} /></Sequence>)}<HookSfx /><SfxLayer /></AbsoluteFill>;
};
