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

const fps = 30;
export const FINANCIAL_INTRO_DURATION_FRAMES = 180;
export const FINANCIAL_INTRO_SFX_DURATION_FRAMES = 67;
export const FINANCIAL_LOGO_ALPHA_DURATION_FRAMES = 150;
const fontStack = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

const clamp = (value: number) => interpolate(value, [0, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
const reveal = (frame: number, from: number, duration = 16) => interpolate(frame, [from, from + duration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });

const IntroBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const offset = (frame % 160) * .55;
  return <AbsoluteFill style={{ overflow: 'hidden', background: '#070c14' }}><AbsoluteFill style={{ opacity: .52, backgroundImage: 'linear-gradient(rgba(116,143,180,.11) 1px, transparent 1px), linear-gradient(90deg, rgba(116,143,180,.11) 1px, transparent 1px)', backgroundSize: '66px 66px', backgroundPosition: `${offset}px ${offset * .25}px` }} /><AbsoluteFill style={{ background: 'radial-gradient(circle at 73% 15%, rgba(35,87,134,.3), transparent 34%), radial-gradient(circle at 21% 96%, rgba(159,32,44,.18), transparent 35%)' }} /><div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 8, background: 'linear-gradient(90deg, #ef454a 0 31%, rgba(255,255,255,.12) 31% 100%)' }} /></AbsoluteFill>;
};

const PortraitShot: React.FC<{ src: string; side: 'left' | 'right'; from: number }> = ({ src, side, from }) => {
  const frame = useCurrentFrame();
  const local = Math.max(0, frame - from);
  const entry = reveal(frame, from, 10);
  const zoom = interpolate(local, [0, 42], [1.08, 1.25], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const move = interpolate(local, [0, 42], [0, side === 'left' ? 38 : -38], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ opacity: entry, overflow: 'hidden' }}><Img src={staticFile(src)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: side === 'left' ? '49% 10%' : '51% 10%', transform: `scale(${zoom}) translateX(${move}px)` }} /><AbsoluteFill style={{ background: side === 'left' ? 'linear-gradient(90deg, rgba(4,8,15,.16), rgba(4,8,15,.22) 34%, rgba(4,8,15,.94) 83%)' : 'linear-gradient(90deg, rgba(4,8,15,.94) 17%, rgba(4,8,15,.22) 65%, rgba(4,8,15,.16))' }} /><div style={{ position: 'absolute', top: 120, [side === 'left' ? 'left' : 'right']: 90, width: 3, height: 250, background: '#ef4b51', opacity: .72, boxShadow: '0 0 18px #ef4b51' }} /></AbsoluteFill>;
};

const Wordmark: React.FC<{ from: number; scale?: number }> = ({ from, scale = 1 }) => {
  const frame = useCurrentFrame();
  const p = reveal(frame, from, 18);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 28}px) scale(${.94 + p * .06 * scale})`, textAlign: 'center' }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: 740 * scale, height: 'auto', filter: 'drop-shadow(0 12px 22px rgba(0,0,0,.42))' }} /></div>;
};

export const FinancialIntroDolly: React.FC = () => {
  const frame = useCurrentFrame();
  const hero = reveal(frame, 81, 22);
  const heroZoom = interpolate(frame, [81, 179], [1.14, 1.02], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return <AbsoluteFill style={{ fontFamily: fontStack }}><IntroBackground /><Sequence from={0} durationInFrames={54}><PortraitShot src="assets/financial-dialogue/female-host.png" side="left" from={0} /></Sequence><Sequence from={47} durationInFrames={52}><PortraitShot src="assets/financial-dialogue/male-chief.png" side="right" from={0} /></Sequence><AbsoluteFill style={{ opacity: hero, overflow: 'hidden' }}><Img src={staticFile('assets/financial-dialogue/title-card.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${heroZoom})` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(3,8,15,.14), transparent 35%, transparent 65%, rgba(3,8,15,.14))' }} /></AbsoluteFill><div style={{ position: 'absolute', bottom: 42, left: 50, right: 50, height: 3, background: 'rgba(255,255,255,.16)' }}><div style={{ width: `${clamp(frame / 126) * 100}%`, height: '100%', background: '#ed4a4f', boxShadow: '0 0 16px #ed4a4f' }} /></div></AbsoluteFill>;
};

export const FinancialIntroDataRush: React.FC = () => {
  const frame = useCurrentFrame();
  const female = reveal(frame, 0, 22);
  const male = reveal(frame, 12, 22);
  const logo = reveal(frame, 72, 18);
  const bar = interpolate(frame, [32, 112], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  return <AbsoluteFill style={{ fontFamily: fontStack }}><IntroBackground /><div style={{ position: 'absolute', left: 0, top: 90, bottom: 0, width: '49%', overflow: 'hidden', opacity: female, clipPath: `inset(0 ${Math.round((1 - female) * 100)}% 0 0)` }}><Img src={staticFile('assets/financial-dialogue/female-host.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '49% 10%', transform: `scale(${1.2 - frame * .0006}) translateX(${frame * .13}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(7,12,20,.05), rgba(7,12,20,.88))' }} /></div><div style={{ position: 'absolute', right: 0, top: 90, bottom: 0, width: '49%', overflow: 'hidden', opacity: male, clipPath: `inset(0 0 0 ${Math.round((1 - male) * 100)}%)` }}><Img src={staticFile('assets/financial-dialogue/male-chief.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '51% 10%', transform: `scale(${1.2 - frame * .0006}) translateX(${-frame * .13}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(7,12,20,.88), rgba(7,12,20,.05))' }} /></div><div style={{ position: 'absolute', left: '50%', top: 118, bottom: 115, width: 2, opacity: bar, background: '#ed4a4f', boxShadow: '0 0 18px #ed4a4f' }} /><div style={{ position: 'absolute', top: 350, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: logo, transform: `scale(${.87 + logo * .13})` }}><Wordmark from={72} /></div></AbsoluteFill>;
};

export const FinancialIntroSplitReveal: React.FC = () => {
  const frame = useCurrentFrame();
  const female = reveal(frame, 0, 24);
  const male = reveal(frame, 10, 24);
  const logo = reveal(frame, 65, 18);
  const line = reveal(frame, 89, 16);
  return <AbsoluteFill style={{ fontFamily: fontStack }}><IntroBackground /><div style={{ position: 'absolute', top: 90, bottom: 0, left: 0, width: '47%', overflow: 'hidden', clipPath: `inset(0 ${Math.round((1 - female) * 100)}% 0 0)` }}><Img src={staticFile('assets/financial-dialogue/female-host.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '49% 10%', transform: `scale(${1.18 - frame * .0007}) translateX(${frame * .15}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(9,13,22,.1), rgba(9,13,22,.78))' }} /></div><div style={{ position: 'absolute', top: 90, bottom: 0, right: 0, width: '47%', overflow: 'hidden', clipPath: `inset(0 0 0 ${Math.round((1 - male) * 100)}%)` }}><Img src={staticFile('assets/financial-dialogue/male-chief.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '51% 10%', transform: `scale(${1.18 - frame * .0007}) translateX(${-frame * .15}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(9,13,22,.78), rgba(9,13,22,.1))' }} /></div><div style={{ position: 'absolute', top: 80, left: '50%', bottom: 94, width: 2, background: '#ef4a50', opacity: line, boxShadow: '0 0 14px #ef4a50' }} /><div style={{ position: 'absolute', top: 350, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: logo, transform: `scale(${.88 + logo * .12})` }}><Wordmark from={65} /></div></AbsoluteFill>;
};

export const FinancialIntroTypography: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = reveal(frame, 12, 20);
  const settle = interpolate(frame, [54, 150], [1.025, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const flareX = interpolate(frame, [20, 78], [-12, 108], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const flareOpacity = interpolate(frame, [20, 29, 68, 78], [0, .22, .22, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ fontFamily: fontStack, overflow: 'hidden', background: '#070c14' }}><AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 48%, rgba(32,62,95,.3), transparent 40%), radial-gradient(ellipse at 18% 82%, rgba(156,31,43,.16), transparent 32%)' }} /><div style={{ position: 'absolute', top: 0, bottom: 0, left: `${flareX}%`, width: 160, opacity: flareOpacity, transform: 'skewX(-20deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.24), transparent)' }} /><div style={{ position: 'absolute', left: '50%', top: '50%', width: 940, opacity: logo, transform: `translate(-50%, -50%) scale(${(.92 + logo * .08) * settle})` }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.36))' }} /></div></AbsoluteFill>;
};

export const FinancialIntroTypographySfx: React.FC<{ soundVolume?: number }> = ({ soundVolume = .9 }) => {
  const frame = useCurrentFrame();
  const logo = reveal(frame, 7, 17);
  const settle = interpolate(frame, [33, 66], [1.025, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const scanX = interpolate(frame, [2, 33], [-20, 108], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scanOpacity = interpolate(frame, [2, 8, 27, 35], [0, .3, .3, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return <AbsoluteFill style={{ overflow: 'hidden', background: '#070c14', fontFamily: fontStack }}><Audio src={staticFile('audio/financial-intro/opening-data-scan.wav')} volume={soundVolume} /><AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 47%, rgba(34,68,105,.34), transparent 42%), radial-gradient(ellipse at 15% 88%, rgba(157,32,45,.18), transparent 35%)' }} /><div style={{ position: 'absolute', top: 0, bottom: 0, left: `${scanX}%`, width: 175, opacity: scanOpacity, transform: 'skewX(-20deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.28), transparent)' }} /><div style={{ position: 'absolute', top: '50%', left: '50%', width: 980, opacity: logo, transform: `translate(-50%, -50%) scale(${(.9 + logo * .1) * settle})` }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 10px 24px rgba(0,0,0,.38))' }} /></div></AbsoluteFill>;
};

export const FinancialIntroPortraitSfx: React.FC = () => {
  const frame = useCurrentFrame();
  const female = reveal(frame, 2, 15);
  const male = reveal(frame, 7, 15);
  const logo = reveal(frame, 27, 17);
  const centerGlow = reveal(frame, 21, 13);
  const scanX = interpolate(frame, [2, 34], [-22, 108], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scanOpacity = interpolate(frame, [2, 8, 28, 36], [0, .26, .26, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const femaleZoom = interpolate(frame, [0, 66], [1.22, 1.15], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  const maleZoom = interpolate(frame, [0, 66], [1.22, 1.15], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.quad) });
  return <AbsoluteFill style={{ overflow: 'hidden', background: '#070c14', fontFamily: fontStack }}><Audio src={staticFile('audio/financial-intro/opening-data-scan.wav')} volume={.9} /><AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 47%, rgba(34,68,105,.34), transparent 42%), radial-gradient(ellipse at 15% 88%, rgba(157,32,45,.18), transparent 35%)' }} /><div style={{ position: 'absolute', top: 48, bottom: 0, left: 0, width: '47%', overflow: 'hidden', opacity: female, clipPath: `inset(0 ${Math.round((1 - female) * 100)}% 0 0)` }}><Img src={staticFile('assets/financial-dialogue/female-host.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '49% 10%', transform: `scale(${femaleZoom}) translateX(${frame * .15}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(7,12,20,.04), rgba(7,12,20,.85))' }} /></div><div style={{ position: 'absolute', top: 48, bottom: 0, right: 0, width: '47%', overflow: 'hidden', opacity: male, clipPath: `inset(0 0 0 ${Math.round((1 - male) * 100)}%)` }}><Img src={staticFile('assets/financial-dialogue/male-chief.png')} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '51% 10%', transform: `scale(${maleZoom}) translateX(${-frame * .15}px)` }} /><AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(7,12,20,.85), rgba(7,12,20,.04))' }} /></div><div style={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 390, transform: 'translateX(-50%)', opacity: centerGlow, background: 'radial-gradient(ellipse at center, rgba(7,12,20,.84) 0%, rgba(7,12,20,.46) 44%, transparent 76%)' }} /><div style={{ position: 'absolute', top: 0, bottom: 0, left: `${scanX}%`, width: 175, opacity: scanOpacity, transform: 'skewX(-20deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.25), transparent)' }} /><div style={{ position: 'absolute', left: '50%', top: '50%', width: 710, opacity: logo, transform: `translate(-50%, -50%) scale(${.92 + logo * .08})` }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 9px 22px rgba(0,0,0,.48))' }} /></div></AbsoluteFill>;
};

export const FinancialLogoAlpha: React.FC = () => {
  const frame = useCurrentFrame();
  const p = reveal(frame, 9, 22);
  const scan = interpolate(frame, [12, 56], [-18, 106], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const scanOpacity = interpolate(frame, [10, 18, 48, 58], [0, .28, .28, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const tail = reveal(frame, 67, 18);
  return <AbsoluteFill style={{ fontFamily: fontStack, overflow: 'hidden' }}><div style={{ position: 'absolute', top: '50%', left: '50%', width: 900, height: 270, transform: `translate(-50%, -50%) scale(${.92 + p * .08})`, opacity: p }}><Img src={staticFile('assets/financial-dialogue/logo-dark.png')} style={{ width: '100%', height: 'auto', filter: 'drop-shadow(0 2px 7px rgba(0,0,0,.32))' }} /><div style={{ position: 'absolute', left: `${scan}%`, top: 5, bottom: 0, width: 115, opacity: scanOpacity, transform: 'skewX(-22deg)', background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.42), transparent)', mixBlendMode: 'screen' }} /><div style={{ position: 'absolute', left: '47.8%', bottom: 1, width: `${tail * 18}%`, height: 7, borderRadius: 8, background: '#f04c52', boxShadow: '0 0 15px #f04c52' }} /></div></AbsoluteFill>;
};
