import {
  AbsoluteFill,
  Audio,
  Easing,
  OffthreadVideo,
  interpolate,
  staticFile,
  useCurrentFrame,
} from 'remotion';

const fps = 30;
// Source footage is 143.133 seconds at 30fps in this Remotion composition.
export const RESCUE_INTERCUT_DURATION_FRAMES = 4294;
const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

type InsertId = 'flow' | 'route' | 'night' | 'clearance' | 'risk';
type Insert = {
  id: InsertId;
  from: number;
  duration: number;
  eyebrow: string;
  title: string;
  shortTitle: string;
};

// These are cut points in the supplied footage, not arbitrary replacement scenes.
// The source narration continues under every card; no news audio is muted or re-timed.
const inserts: Insert[] = [
  { id: 'flow', from: 468, duration: 108, eyebrow: '事件图解 01', title: '泥石流沿山谷堆积', shortTitle: '受灾机制' },
  { id: 'route', from: 1128, duration: 108, eyebrow: '事件图解 02', title: '救援人员徒步进入核心区', shortTitle: '进入通道' },
  { id: 'night', from: 2028, duration: 102, eyebrow: '事件图解 03', title: '昼夜持续搜索与转运', shortTitle: '夜间救援' },
  { id: 'clearance', from: 2898, duration: 114, eyebrow: '事件图解 04', title: '清障、抢通与搜救并行', shortTitle: '抢通作业' },
  { id: 'risk', from: 3690, duration: 108, eyebrow: '事件图解 05', title: '河道、堆积体与边坡仍需关注', shortTitle: '现场风险' },
];

const arrive = (frame: number, start = 0, duration = 14) => interpolate(frame, [start, start + duration], [0, 1], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.out(Easing.cubic),
});

const enterExit = (frame: number, duration: number) => {
  const inValue = arrive(frame, 0, 12);
  const outValue = interpolate(frame, [duration - 12, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.in(Easing.cubic),
  });
  return Math.min(inValue, outValue);
};

const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = (frame % 220) * 0.24;
  return <AbsoluteFill style={{ background: '#071018', overflow: 'hidden' }}>
    <AbsoluteFill style={{ opacity: .42, backgroundImage: 'linear-gradient(rgba(151,182,198,.18) 1px, transparent 1px), linear-gradient(90deg, rgba(151,182,198,.18) 1px, transparent 1px)', backgroundSize: '56px 56px', backgroundPosition: `${drift}px ${drift * .45}px` }} />
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 74% 16%, rgba(44,102,108,.25), transparent 30%), radial-gradient(circle at 12% 88%, rgba(164,48,33,.19), transparent 33%)' }} />
    <AbsoluteFill style={{ opacity: .14, backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 4px, rgba(255,255,255,.05) 5px)' }} />
  </AbsoluteFill>;
};

const EventMark: React.FC = () => <svg width="36" height="36" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="#f06b4f" strokeWidth="10" strokeDasharray="160 80" transform="rotate(-34 50 50)"/><path d="M30 58c17 12 37 3 42-19 1 23-16 40-39 32-14-5-19-17-16-31 2 8 6 14 13 18Z" fill="#f06b4f"/></svg>;

const CardHeader: React.FC<{ insert: Insert; local: number }> = ({ insert, local }) => {
  const p = arrive(local, 0, 12);
  return <div style={{ position: 'absolute', top: 48, left: 58, right: 58, display: 'flex', alignItems: 'center', borderBottom: '1px solid rgba(207,225,230,.35)', paddingBottom: 22, opacity: p, transform: `translateY(${(1 - p) * -18}px)`, fontFamily: fontStack }}>
    <EventMark /><div style={{ marginLeft: 12, color: '#eef5f5', fontSize: 28, fontWeight: 800 }}>救援现场图解</div><div style={{ marginLeft: 18, color: '#9bb3bb', fontSize: 15, letterSpacing: 3 }}>RESCUE BRIEF</div>
    <div style={{ marginLeft: 'auto', color: '#f6b95b', fontSize: 16, letterSpacing: 2, fontWeight: 800 }}>{insert.eyebrow}</div>
  </div>;
};

const LowerCaption: React.FC<{ insert: Insert; local: number }> = ({ insert, local }) => {
  const p = arrive(local, 12, 13);
  return <div style={{ position: 'absolute', left: 58, right: 58, bottom: 49, display: 'flex', alignItems: 'center', minHeight: 105, opacity: p, transform: `translateY(${(1 - p) * 22}px)`, fontFamily: fontStack }}>
    <div style={{ width: 7, alignSelf: 'stretch', borderRadius: 8, background: '#f06b4f', marginRight: 19 }} /><div><div style={{ color: '#f1f6f4', fontWeight: 800, fontSize: 38 }}>{insert.title}</div><div style={{ marginTop: 10, color: '#9db2ba', fontSize: 17, letterSpacing: 1 }}>画面机制示意 · 原片旁白持续播放</div></div>
    <div style={{ marginLeft: 'auto', width: 86, height: 4, borderRadius: 4, background: '#f6b95b', boxShadow: '0 0 14px #f6b95b' }} />
  </div>;
};

const MountainFlow: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 8, 18);
  const flow = arrive(local, 26, 38);
  const dash = -(local * 5);
  return <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M112 790 494 305 760 693 1040 194 1495 793Z" fill="#142a30" stroke="#66828a" strokeWidth="5" opacity={p}/>
    <path d="M195 806 513 456 752 771 1040 354 1385 806" fill="#1d3a40" opacity={p}/>
    <path d="M816 273 C855 424 783 524 870 640 S1080 742 1242 795" fill="none" stroke="#f06b4f" strokeWidth="42" strokeLinecap="round" opacity={flow * .9}/>
    <path d="M816 273 C855 424 783 524 870 640 S1080 742 1242 795" fill="none" stroke="#ffcf74" strokeWidth="8" strokeDasharray="18 22" strokeDashoffset={dash} opacity={flow}/>
    <g opacity={arrive(local, 54, 15)}><circle cx="814" cy="260" r="24" fill="#f06b4f"/><text x="850" y="254" fill="#f2f6f1" fontSize="26" fontFamily={fontStack}>上游来水与崩塌物</text><circle cx="1248" cy="795" r="26" fill="#f6b95b"/><text x="1292" y="802" fill="#f2f6f1" fontSize="26" fontFamily={fontStack}>谷地堆积区</text></g>
  </svg>;
};

const AccessRoute: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 8, 18);
  const walk = arrive(local, 30, 48);
  return <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M230 790 C380 620 465 695 610 510 S876 455 1010 348 S1324 330 1620 211" fill="none" stroke="#405c63" strokeWidth="18" opacity={p}/>
    <path d="M230 790 C380 620 465 695 610 510 S876 455 1010 348 S1324 330 1620 211" fill="none" stroke="#f6b95b" strokeWidth="8" strokeDasharray="20 16" strokeDashoffset={-local * 5} opacity={walk}/>
    {[[230,790],[610,510],[1010,348],[1620,211]].map(([x,y], i) => <g key={i} opacity={arrive(local, 12 + i * 17, 14)}><circle cx={x} cy={y} r="35" fill={i === 3 ? '#f06b4f' : '#0b1921'} stroke={i === 3 ? '#f06b4f' : '#f6b95b'} strokeWidth="7"/><text x={x} y={y + 8} textAnchor="middle" fill="#f4f8f5" fontSize="20" fontFamily={fontStack}>{['外围','山路','徒步','核心区'][i]}</text></g>)}
    <g opacity={arrive(local, 64, 15)}><path d="M420 342 l22 -55 21 55 -20 26z" fill="#8ca4a7"/><path d="M526 317 l22 -55 21 55 -20 26z" fill="#8ca4a7"/><text x="448" y="400" fill="#a9bbc0" fontFamily={fontStack} fontSize="24">陡坡 / 落石 / 泥泞</text></g>
  </svg>;
};

const NightSearch: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 5, 15);
  const beamX = 400 + ((local % 78) / 78) * 930;
  return <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M0 778 310 494 567 733 890 393 1235 742 1543 458 1920 796V1080H0Z" fill="#0e2025" opacity={p}/>
    <path d={`M${beamX} 256 L${beamX - 320} 818 L${beamX + 320} 818 Z`} fill="#f6b95b" opacity={.09 + Math.sin(local / 8) * .03}/>
    <circle cx={beamX} cy="252" r="20" fill="#fff6cf" opacity={p}/><circle cx={beamX} cy="252" r="48" fill="#f6b95b" opacity=".14"/>
    <path d="M245 814 H1670" stroke="#2f4a51" strokeWidth="4"/>
    {[360, 650, 950, 1250, 1510].map((x,i) => <g key={x} opacity={arrive(local, 16 + i * 10, 10)}><circle cx={x} cy={760 - (i % 2) * 35} r="13" fill="#f06b4f"/><path d={`M${x} ${760 - (i % 2) * 35} v35`} stroke="#e8efe9" strokeWidth="7"/><path d={`M${x-15} ${795 - (i % 2) * 35} h30`} stroke="#e8efe9" strokeWidth="7"/></g>)}
    <g opacity={arrive(local, 55, 14)}><text x="960" y="225" textAnchor="middle" fill="#f3f8f6" fontSize="34" fontWeight="bold" fontFamily={fontStack}>光束、搜索线与人员协同推进</text><line x1="596" y1="268" x2="1324" y2="268" stroke="#f6b95b" strokeWidth="4"/></g>
  </svg>;
};

const Clearance: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 5, 15);
  const move = Math.min(1, local / 55);
  return <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M190 748 H1725" stroke="#688087" strokeWidth="12" opacity={p}/><path d={`M190 748 H${190 + 1535 * move}`} stroke="#f6b95b" strokeWidth="12" opacity={p}/>
    <g opacity={p} transform={`translate(${410 + move * 280} 578)`}><rect x="-120" y="52" width="240" height="85" rx="22" fill="#dba33f" stroke="#fff0ca" strokeWidth="5"/><circle cx="-65" cy="150" r="36" fill="#263b3f" stroke="#93a8a7" strokeWidth="8"/><circle cx="66" cy="150" r="36" fill="#263b3f" stroke="#93a8a7" strokeWidth="8"/><path d="M-25 52 50 -128 198 -118 251 -32 195 -4 132 -82 74 10" fill="none" stroke="#f6b95b" strokeWidth="31" strokeLinejoin="round"/><path d="M198 -118 320 -46 288 13" fill="none" stroke="#f6b95b" strokeWidth="28" strokeLinecap="round"/><path d="M279 4 365 34 334 93" fill="#dba33f" stroke="#fff0ca" strokeWidth="5"/></g>
    {[0,1,2,3,4,5].map((i) => { const x=840+i*104; const y=700-(i%2)*46; const o=arrive(local,22+i*8,12); return <g key={i} opacity={o}><rect x={x} y={y} width="74" height="55" rx="8" fill="#9a7d63" stroke="#d2b394" strokeWidth="5"/><path d={`M${x+12} ${y+16}l50 25M${x+62} ${y+16}l-50 25`} stroke="#e5c49d" strokeWidth="4"/></g>; })}
    <g opacity={arrive(local, 55, 12)}><text x="312" y="885" fill="#aabec0" fontSize="27" fontFamily={fontStack}>机械清障</text><text x="935" y="885" fill="#aabec0" fontSize="27" fontFamily={fontStack}>障碍物转运</text><text x="1410" y="885" fill="#f6b95b" fontSize="27" fontFamily={fontStack}>通道恢复</text></g>
  </svg>;
};

const SecondaryRisk: React.FC<{ local: number }> = ({ local }) => {
  const p = arrive(local, 5, 15);
  const water = arrive(local, 25, 32);
  return <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
    <path d="M200 253 631 700 830 329 1160 735 1554 240 1745 810 166 810Z" fill="#21363a" stroke="#789095" strokeWidth="5" opacity={p}/>
    <path d="M104 866 C433 727 623 889 899 778 S1385 721 1810 858" fill="none" stroke="#3b9bb1" strokeWidth={30 * water} opacity={p}/><path d="M104 866 C433 727 623 889 899 778 S1385 721 1810 858" fill="none" stroke="#a4e4e8" strokeWidth="5" strokeDasharray="18 18" strokeDashoffset={-local * 4} opacity={water}/>
    <path d="M520 418 L712 707 411 707Z" fill="#f06b4f" opacity={arrive(local, 37, 14) * .7}/><path d="M1192 425 L1440 727 1020 727Z" fill="#f6b95b" opacity={arrive(local, 54, 14) * .72}/>
    <g opacity={arrive(local, 56, 14)}><circle cx="564" cy="558" r="27" fill="#f06b4f"/><text x="605" y="566" fill="#f4f8f5" fontSize="27" fontFamily={fontStack}>边坡与落石</text><circle cx="1260" cy="572" r="27" fill="#f6b95b"/><text x="1301" y="580" fill="#f4f8f5" fontSize="27" fontFamily={fontStack}>堆积体与河道</text></g>
  </svg>;
};

const Visual: React.FC<{ insert: Insert; local: number }> = ({ insert, local }) => {
  if (insert.id === 'flow') return <MountainFlow local={local}/>;
  if (insert.id === 'route') return <AccessRoute local={local}/>;
  if (insert.id === 'night') return <NightSearch local={local}/>;
  if (insert.id === 'clearance') return <Clearance local={local}/>;
  return <SecondaryRisk local={local}/>;
};

const IntercutCard: React.FC<{ insert: Insert }> = ({ insert }) => {
  const frame = useCurrentFrame();
  const local = frame - insert.from;
  const opacity = enterExit(local, insert.duration);
  return <AbsoluteFill style={{ zIndex: 5, opacity, fontFamily: fontStack }}>
    <GridBackground />
    <div style={{ position: 'absolute', inset: 32, border: '1px solid rgba(180,207,210,.42)', borderRadius: 24, overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.07)' }}><div style={{ position: 'absolute', top: 0, left: 0, height: 5, width: 270, background: 'linear-gradient(90deg, #f06b4f 0 56%, #f6b95b 56% 100%)' }}/><CardHeader insert={insert} local={local}/><Visual insert={insert} local={local}/><LowerCaption insert={insert} local={local}/></div>
  </AbsoluteFill>;
};

export const RescueNewsIntercut: React.FC = () => <AbsoluteFill style={{ background: '#000' }}>
  <OffthreadVideo src={staticFile('video/rescue-news-source.mov')} volume={0} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
  <Audio src={staticFile('video/rescue-news-source.mov')} />
  {inserts.map((insert) => <IntercutCard key={insert.id} insert={insert}/>) }
</AbsoluteFill>;
