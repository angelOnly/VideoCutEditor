import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";

export type Theme = {
  bg: string;
  ink: string;
  muted: string;
  grid: string;
  colors: string[];
};
export const themes: Record<string, Theme> = {
  clean: {
    bg: "#faf9f6",
    ink: "#23242a",
    muted: "#7c808a",
    grid: "#dfdfdf",
    colors: ["#6155e8", "#69caac", "#f2c75c", "#ef8354", "#b493e8", "#69a5ed"],
  },
  consulting: {
    bg: "#ffffff",
    ink: "#142e48",
    muted: "#60798c",
    grid: "#e0e7ee",
    colors: ["#123e6b", "#2474ad", "#4ba1c5", "#80c7d2", "#b0dbe1", "#c9e9ef"],
  },
  retro: {
    bg: "#f3ecd7",
    ink: "#2c393a",
    muted: "#7b7667",
    grid: "#d7ccb5",
    colors: ["#df553f", "#e9ab44", "#277b78", "#7b96a3", "#956a97", "#b1b76d"],
  },
  dark: {
    bg: "#121827",
    ink: "#f6f7fb",
    muted: "#96a3bc",
    grid: "#2b354b",
    colors: ["#72d5ed", "#a291fa", "#f4c66c", "#ec7d91", "#7dd4ae", "#88abef"],
  },
};
export const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const ease = (x: number) => {
  const p = clamp(x);
  return p * p * (3 - 2 * p);
};
export const mix = (a: number, b: number, p: number) => a + (b - a) * p;
export const phase = (t: number, start: number, end: number) =>
  ease((t - start) / (end - start));
export type CueMap = Record<string, [number, number]>;
export type SceneProps = {
  time?: number;
  cues?: CueMap;
  theme?: string;
  bare?: boolean;
};
// 时间由组件属性或 Remotion 帧驱动；正文复用时用真实语音时间覆盖动作窗口。
export const useTime = (time?: number) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  return time ?? f / fps;
};
export const cue = (
  t: number,
  cues: CueMap | undefined,
  key: string,
  fallback: [number, number],
) => phase(t, ...(cues?.[key] ?? fallback));
export const Text = ({
  x,
  y,
  children,
  size = 22,
  fill = "#23242a",
  anchor = "start",
  weight = 500,
  opacity = 1,
}: any) => (
  <text
    x={x}
    y={y}
    fill={fill}
    fontSize={size}
    fontWeight={weight}
    textAnchor={anchor}
    opacity={opacity}
    fontFamily="Arial, PingFang SC, sans-serif"
  >
    {children}
  </text>
);
export const Frame = ({
  title,
  sub,
  theme = "clean",
  bare = false,
  children,
}: any) => {
  const p = themes[theme];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1280"
      height="720"
      viewBox="0 0 1280 720"
    >
      <style>{`text{font-variant-numeric:tabular-nums}`}</style>
      {!bare && (
        <>
          <rect width="1280" height="720" fill={p.bg} />
          <Text x={74} y={62} size={13} fill={p.muted}>
            动态图表参考 · 独立重写 / 示例数据
          </Text>
          <Text x={74} y={112} size={34} weight={700} fill={p.ink}>
            {title}
          </Text>
          <Text x={74} y={143} size={16} fill={p.muted}>
            {sub}
          </Text>
          <Text x={74} y={686} size={13} fill={p.muted}>
            TypeMotion Tables · 本地动画参考
          </Text>
        </>
      )}
      {children}
    </svg>
  );
};
export const Grid = ({
  p,
  x = 170,
  y = 200,
  w = 910,
  h = 370,
  max = 100,
}: any) => (
  <g>
    {Array.from({ length: 5 }, (_, i) => (
      <g key={i}>
        <path d={`M${x},${y + (i * h) / 4}h${w}`} stroke={p.grid} />
        <Text
          x={x - 22}
          y={y + (i * h) / 4 + 6}
          anchor="end"
          size={15}
          fill={p.muted}
        >
          {max - (i * max) / 4}
        </Text>
      </g>
    ))}
    <path d={`M${x},${y}v${h}h${w}`} fill="none" stroke={p.muted} />
  </g>
);
export const Trace = ({ d, color, progress, width = 5, opacity = 1 }: any) => (
  <path
    d={d}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    strokeLinejoin="round"
    pathLength={1}
    strokeDasharray="1"
    strokeDashoffset={1 - clamp(progress)}
    opacity={opacity}
  />
);
export const polar = (cx: number, cy: number, r: number, a: number) => [
  cx + Math.cos(a) * r,
  cy + Math.sin(a) * r,
];
export const arc = (
  cx: number,
  cy: number,
  r: number,
  a: number,
  b: number,
) => {
  const s = polar(cx, cy, r, a),
    e = polar(cx, cy, r, b);
  return `M${s.join(",")}A${r},${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${e.join(",")}`;
};
export const sector = (
  cx: number,
  cy: number,
  r: number,
  a: number,
  b: number,
) =>
  `M${cx},${cy}L${polar(cx, cy, r, a).join(",")}A${r},${r} 0 ${b - a > Math.PI ? 1 : 0} 1 ${polar(cx, cy, r, b).join(",")}Z`;
export const names = [
  "产品 A",
  "产品 B",
  "产品 C",
  "产品 D",
  "产品 E",
  "产品 F",
];

// 浅色图形上的标签改用深色，避免黄色、青色块上白字难读。
export function onColor(hex: string) {
  const c = hex.replace("#", "");
  const rgb = [0, 2, 4]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > 0.179
    ? "#172332"
    : "#ffffff";
}
