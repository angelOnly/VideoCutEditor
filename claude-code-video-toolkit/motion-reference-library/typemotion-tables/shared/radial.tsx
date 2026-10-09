import React from "react";
import {
  Frame,
  onColor,
  Text,
  Trace,
  themes,
  useTime,
  cue,
  phase,
  mix,
  arc,
  sector,
  polar,
  names,
  SceneProps,
} from "./core";
type Props = SceneProps & { kind: string; title: string };
export function Radial({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[kind === "pie-symbol" ? "consulting" : theme],
    build = cue(t, cues, "build", [0.4, 3.4]),
    focus = cue(t, cues, "focus", [3.6, 5.2]);
  const vals = [32, 24, 18, 14, 12],
    ring = ["jade-ring", "stacked-donut"].includes(kind),
    cx = 460,
    cy = 400;
  let angle = -Math.PI / 2;
  return (
    <Frame
      title={title}
      sub="比例用角度表达；半径、标签与连接点保持同源"
      theme={theme}
      bare={bare}
    >
      {ring
        ? vals.slice(0, kind === "stacked-donut" ? 3 : 5).map((_, i) => {
            const r = 190 - i * 33,
              v = [86, 72, 58, 46, 34][i],
              start = -Math.PI / 2,
              span =
                ((kind === "jade-ring" ? Math.PI * 1.7 : Math.PI * 2) * v) /
                100;
            return (
              <g key={i}>
                <path
                  d={arc(
                    cx,
                    cy,
                    r,
                    start,
                    start +
                      (kind === "jade-ring"
                        ? Math.PI * 1.7
                        : Math.PI * 2 - 0.001),
                  )}
                  stroke={p.grid}
                  strokeWidth={20}
                  fill="none"
                />
                <path
                  d={arc(
                    cx,
                    cy,
                    r,
                    start,
                    start +
                      Math.max(
                        0.0001,
                        span * phase(t, 0.3 + i * 0.38, 2.3 + i * 0.38),
                      ),
                  )}
                  stroke={p.colors[i]}
                  strokeWidth={20}
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            );
          })
        : kind === "polar-rose"
          ? vals.map((v, i) => {
              const a = -Math.PI / 2 + (i * Math.PI * 2) / 5,
                b = a + (Math.PI * 2) / 5 - 0.05;
              const r =
                Math.sqrt(v / 32) *
                205 *
                phase(t, 0.3 + i * 0.28, 1.7 + i * 0.28);
              return (
                <path
                  key={i}
                  d={sector(cx, cy, Math.max(0.01, r), a, b)}
                  fill={p.colors[i]}
                />
              );
            })
          : vals.map((v, i) => {
              const a = angle,
                b = angle + (v / 100) * Math.PI * 2;
              angle = b;
              const k = phase(t, 0.3 + i * 0.4, 1.7 + i * 0.4),
                mid = (a + b) / 2,
                offset = i === 0 && kind === "pie-slice" ? focus * 22 : 0;
              return (
                <g
                  key={i}
                  transform={`translate(${Math.cos(mid) * offset} ${Math.sin(mid) * offset})`}
                >
                  <path
                    d={sector(
                      cx,
                      cy,
                      200,
                      a,
                      a + (b - a) * Math.max(0.00001, k) - 0.000001,
                    )}
                    fill={
                      kind === "pie-symbol"
                        ? themes.consulting.colors[i]
                        : p.colors[i]
                    }
                    stroke={p.bg}
                    strokeWidth={3}
                  />
                  {!["share-donut", "pie-symbol"].includes(kind) && (
                    <Text
                      x={cx + Math.cos(mid) * 135}
                      y={cy + Math.sin(mid) * 135 + 8}
                      anchor="middle"
                      size={23}
                      fill={onColor(p.colors[i])}
                      weight={700}
                      opacity={k}
                    >
                      {v}%
                    </Text>
                  )}
                </g>
              );
            })}
      {["share-donut", "pie-symbol", "stacked-donut"].includes(kind) && (
        <>
          <circle
            cx={cx}
            cy={cy}
            r={kind === "stacked-donut" ? 92 : 114}
            fill={p.bg}
          />
          <Text
            x={cx}
            y={cy + 10}
            anchor="middle"
            size={kind === "pie-symbol" ? 70 : 43}
            fill={p.ink}
            weight={700}
          >
            {kind === "pie-symbol"
              ? "◎"
              : `${Math.round((kind === "stacked-donut" ? 86 : 32) * build)}%`}
          </Text>
          <Text x={cx} y={cy + 45} anchor="middle" size={16} fill={p.muted}>
            {kind === "stacked-donut" ? "核心指标" : "核心占比"}
          </Text>
        </>
      )}
      {vals.slice(0, kind === "stacked-donut" ? 3 : 5).map((v, i) => (
        <g key={i} opacity={phase(t, 1 + i * 0.35, 1.7 + i * 0.35)}>
          <rect
            x={785}
            y={258 + i * 62}
            width={13}
            height={13}
            rx={3}
            fill={p.colors[i]}
          />
          <Text x={820} y={273 + i * 62} size={22} fill={p.ink}>
            {names[i]}
          </Text>
          <Text
            x={1080}
            y={273 + i * 62}
            size={23}
            anchor="end"
            weight={700}
            fill={p.ink}
          >
            {ring ? [86, 72, 58, 46, 34][i] : v}
            {kind === "polar-rose" ? "" : "%"}
          </Text>
        </g>
      ))}
    </Frame>
  );
}
export function Radar({ title, theme = "clean", bare, cues, time }: Props) {
  const t = useTime(time),
    p = themes[theme],
    build = cue(t, cues, "build", [0.3, 1.5]),
    morph = cue(t, cues, "morph", [2, 4.2]),
    fill = cue(t, cues, "fill", [4.2, 5.4]);
  const values = [0.8, 0.6, 0.9, 0.65, 0.75, 0.5],
    pts = values.map((v, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3,
        q = polar(640, 405, 190 * v, a);
      return [mix(290 + i * 140, q[0], morph), mix(470 - v * 120, q[1], morph)];
    });
  return (
    <Frame
      title={title}
      sub="同一组点从线性排列转为多维比较；标签随锚点移动"
      theme={theme}
      bare={bare}
    >
      {[0.25, 0.5, 0.75, 1].map((r, i) => (
        <polygon
          key={i}
          points={values
            .map((_, j) =>
              polar(640, 405, 190 * r, -Math.PI / 2 + (j * Math.PI) / 3).join(
                ",",
              ),
            )
            .join(" ")}
          fill="none"
          stroke={p.grid}
          opacity={morph}
        />
      ))}
      {values.map((_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3,
          edge = polar(640, 405, 230, a);
        return (
          <g key={i}>
            <path
              d={`M640,405L${polar(640, 405, 190, a).join(",")}`}
              stroke={p.grid}
              opacity={morph}
            />
            <Text
              x={mix(290 + i * 140, edge[0], morph)}
              y={mix(530, edge[1] + 7, morph)}
              anchor="middle"
              size={20}
              fill={p.ink}
            >
              {["质量", "效率", "覆盖", "成本", "体验", "稳定"][i]}
            </Text>
          </g>
        );
      })}
      <polygon
        points={pts.map((a) => a.join(",")).join(" ")}
        fill={p.colors[0]}
        fillOpacity={fill * 0.18}
        stroke="none"
      />
      <Trace
        d={pts.map((a, i) => (i ? "L" : "M") + a.join(",")).join("")}
        color={p.colors[0]}
        progress={build}
      />
      <Trace
        d={`M${pts[5].join(",")}L${pts[0].join(",")}`}
        color={p.colors[0]}
        progress={fill}
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={7 * build} fill={p.colors[0]} />
      ))}
    </Frame>
  );
}
