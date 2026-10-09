import React from "react";
import {
  Frame,
  Grid,
  Text,
  Trace,
  themes,
  useTime,
  cue,
  phase,
  mix,
  names,
  SceneProps,
} from "./core";
type Props = SceneProps & { kind: string; title: string };
const series = [
  [28, 42, 36, 60, 68, 82],
  [70, 62, 65, 53, 49, 40],
  [20, 34, 48, 42, 63, 68],
];
export function Cartesian({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[theme],
    build = cue(t, cues, "build", [0.4, 2.8]),
    detail = cue(t, cues, "detail", [3.1, 5.2]);
  const pts = (v: number[]) => v.map((n, i) => [190 + i * 166, 570 - n * 3.7]);
  const path = (v: number[]) =>
    pts(v)
      .map((a, i) => (i ? "L" : "M") + a.join(","))
      .join("");
  const line = [
    "line-trend",
    "comparison-lines",
    "area-chart",
    "combo-chart",
  ].includes(kind);
  return (
    <Frame
      title={title}
      sub="先建立尺度，再呈现变化，最后强调差异"
      theme={theme}
      bare={bare}
    >
      <Grid p={p} />
      {[
        "comparison-lines",
        "clustered-column",
        "stacked-column",
        "percent-stacked",
        "combo-chart",
      ].includes(kind) &&
        ["系列 A", "系列 B", "系列 C"]
          .slice(
            0,
            kind === "comparison-lines" || kind === "combo-chart" ? 2 : 3,
          )
          .map((v, i) => (
            <g key={v}>
              <rect
                x={440 + i * 145}
                y={636}
                width={16}
                height={10}
                fill={p.colors[i]}
              />
              <Text x={465 + i * 145} y={647} size={16} fill={p.muted}>
                {v}
              </Text>
            </g>
          ))}
      {Array.from({ length: 6 }, (_, i) => (
        <Text
          key={i}
          x={
            ["clustered-column", "stacked-column", "percent-stacked"].includes(
              kind,
            )
              ? 214 + i * 164
              : 190 + i * 166
          }
          y={605}
          anchor="middle"
          size={17}
          fill={p.muted}
        >
          {i + 1} 月
        </Text>
      ))}
      {line && (
        <>
          {kind === "combo-chart" &&
            series[0].map((v, i) => {
              const h = v * 3.1 * phase(t, 0.3 + i * 0.16, 1.3 + i * 0.16);
              return (
                <rect
                  key={i}
                  x={165 + i * 166}
                  y={570 - h}
                  width={50}
                  height={h}
                  rx={3}
                  fill={p.colors[1]}
                  opacity={0.6}
                />
              );
            })}
          <defs>
            <clipPath id="wipe">
              <rect x={170} y={180} width={950 * build} height={410} />
            </clipPath>
            <linearGradient id="area" x2="0" y2="1">
              <stop stopColor={p.colors[0]} stopOpacity={0.42} />
              <stop offset="1" stopColor={p.colors[0]} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          {kind === "area-chart" && (
            <path
              d={`${path(series[0])}L1020,570L190,570Z`}
              fill="url(#area)"
              clipPath="url(#wipe)"
            />
          )}
          {(kind === "comparison-lines"
            ? series.slice(0, 2)
            : [kind === "combo-chart" ? series[2] : series[0]]
          ).map((s, j) => (
            <g key={j}>
              <Trace
                d={path(s)}
                color={p.colors[j]}
                progress={
                  kind === "combo-chart"
                    ? detail
                    : phase(t, 0.45 + j * 0.65, 3 + j * 0.65)
                }
              />
              {pts(s).map(([x, y], i) => (
                <g
                  key={i}
                  opacity={phase(
                    t,
                    0.5 + i * 0.45 + j * 0.6,
                    0.9 + i * 0.45 + j * 0.6,
                  )}
                >
                  <circle cx={x} cy={y} r={6} fill={p.colors[j]} />
                  <Text
                    x={x}
                    y={y - 18}
                    anchor="middle"
                    size={17}
                    fill={p.colors[j]}
                  >
                    {s[i]}
                  </Text>
                </g>
              ))}
            </g>
          ))}
          <g opacity={detail}>
            <rect
              x={785}
              y={175}
              width={295}
              height={42}
              rx={6}
              fill={p.colors[0]}
              fillOpacity={0.1}
            />
            <Text x={805} y={204} size={19} fill={p.ink}>
              {kind === "comparison-lines"
                ? "两条趋势在 4 月交叉"
                : "关注变化，而非孤立的终点"}
            </Text>
          </g>
        </>
      )}
      {[
        "clustered-column",
        "stacked-column",
        "percent-stacked",
        "bar-skyline",
      ].includes(kind) &&
        Array.from({ length: kind === "bar-skyline" ? 18 : 6 }, (_, i) => {
          const skyline = kind === "bar-skyline",
            x = skyline ? 180 + i * 49 : 170 + i * 164,
            vals = skyline
              ? [25 + ((i * 23) % 65)]
              : kind === "clustered-column"
                ? [series[0][i], series[1][i], series[2][i]]
                : [series[0][i] * 0.55, series[1][i] * 0.4, series[2][i] * 0.3],
            sum = vals.reduce((a, b) => a + b, 0);
          let base = 570;
          return (
            <g key={i}>
              {vals.map((v, j) => {
                const h =
                  (kind === "percent-stacked" ? (v / sum) * 100 : v) *
                  (skyline ? 3.8 : 3.7) *
                  phase(
                    t,
                    0.3 + i * 0.15 + j * 0.25,
                    1.5 + i * 0.15 + j * 0.25,
                  );
                const grouped = kind === "clustered-column";
                const y = grouped ? 570 - h : base - h;
                base -= h;
                return (
                  <rect
                    key={j}
                    x={x + (grouped ? j * 32 : 0)}
                    y={y}
                    width={skyline ? 32 : grouped ? 27 : 85}
                    height={h}
                    fill={p.colors[j]}
                    rx={2}
                  />
                );
              })}
            </g>
          );
        })}
      {kind === "scatter-plot" &&
        Array.from({ length: 28 }, (_, i) => {
          const x = 200 + ((i * 137) % 850),
            y = 530 - (x - 200) * 0.32 + Math.sin(i * 4) * 74,
            a = phase(t, 0.3 + i * 0.065, 1 + i * 0.065);
          return (
            <circle
              key={i}
              cx={x}
              cy={mix(560, y, a)}
              r={mix(0, 7 + (i % 3) * 3, a)}
              fill={p.colors[i % 3]}
              opacity={0.7}
            />
          );
        })}
      {kind === "scatter-plot" && (
        <>
          <Trace
            d="M210,535L1030,265"
            color={p.colors[0]}
            progress={detail}
            width={3}
          />
          <Text x={840} y={250} size={19} fill={p.ink} opacity={detail}>
            示意趋势线
          </Text>
        </>
      )}
    </Frame>
  );
}
export function Bars({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[theme],
    change = cue(t, cues, "change", [2.5, 5.2]);
  const start = [86, 73, 65, 58, 42, 32],
    end = [78, 97, 62, 83, 53, 38];
  const rank = (v: number[], i: number) =>
    [...v].sort((a, b) => b - a).indexOf(v[i]);
  const horizontal = [
    "bar-race",
    "ranking-rise",
    "progress-bars",
    "horizontal-bar-metrics",
    "butterfly-bar",
  ].includes(kind);
  return (
    <Frame
      title={title}
      sub="对象、数值和标签共用位置；变化后保留上下文"
      theme={theme}
      bare={bare}
    >
      {horizontal &&
        start.map((v, i) => {
          const racing = ["bar-race", "ranking-rise"].includes(kind),
            value = mix(v, end[i], racing ? change : 0),
            row = racing ? mix(rank(start, i), rank(end, i), change) : i,
            y = 220 + row * 61,
            show = phase(t, 0.2 + i * 0.12, 1.1 + i * 0.12),
            len = value * 7 * show;
          return (
            <g
              key={i}
              transform={`translate(${kind === "horizontal-bar-metrics" ? (1 - show) * -80 : 0} ${y})`}
              opacity={show}
            >
              {kind === "ranking-rise" && (
                <>
                  <circle
                    cx={108}
                    cy={0}
                    r={17}
                    fill={p.colors[i]}
                    fillOpacity={0.15}
                  />
                  <Text x={108} y={6} anchor="middle" size={17} fill={p.ink}>
                    {Math.round(row) + 1}
                  </Text>
                </>
              )}
              <Text
                x={
                  kind === "butterfly-bar"
                    ? 635
                    : kind === "ranking-rise"
                      ? 205
                      : 180
                }
                y={7}
                anchor="end"
                size={21}
                fill={p.ink}
              >
                {names[i]}
              </Text>
              {kind === "butterfly-bar" ? (
                <>
                  <rect
                    x={540 - v * 3.8 * show}
                    y={-17}
                    width={v * 3.8 * show}
                    height={34}
                    rx={3}
                    fill={p.colors[0]}
                  />
                  <rect
                    x={680}
                    y={-17}
                    width={end[i] * 3.8 * show}
                    height={34}
                    rx={3}
                    fill={p.colors[3]}
                  />
                  <Text
                    x={525 - v * 3.8 * show}
                    y={6}
                    anchor="end"
                    size={17}
                    fill={p.colors[0]}
                  >
                    {v}
                  </Text>
                  <Text
                    x={695 + end[i] * 3.8 * show}
                    y={6}
                    size={17}
                    fill={p.colors[3]}
                  >
                    {end[i]}
                  </Text>
                </>
              ) : (
                <>
                  <rect
                    x={235}
                    y={-18}
                    width={700}
                    height={36}
                    rx={5}
                    fill={p.grid}
                    opacity={0.5}
                  />
                  <rect
                    x={235}
                    y={-18}
                    width={len}
                    height={36}
                    rx={5}
                    fill={p.colors[i]}
                  />
                  <Text x={253 + len} y={7} size={22} fill={p.ink} weight={700}>
                    {Math.round(value * show)}
                    {kind === "progress-bars" ? "%" : ""}
                  </Text>
                </>
              )}
            </g>
          );
        })}
      {kind === "bar-race" && (
        <Text
          x={1120}
          y={590}
          size={52}
          anchor="end"
          fill={p.grid}
          weight={700}
        >
          {change < 0.5 ? "2025" : "2026"}
        </Text>
      )}
      {kind === "waterfall-bridge" &&
        (() => {
          const values = [42, 25, -14, 31, -9, 75];
          let total = 0;
          return values.map((v, i) => {
            const terminal = i === 0 || i === 5,
              prev = terminal ? 0 : total,
              next = terminal ? v : total + v;
            total = next;
            const k = phase(t, 0.3 + i * 0.55, 1.2 + i * 0.55),
              h = Math.abs(next - prev) * 4.2 * k,
              x = 170 + i * 164,
              top = 570 - Math.max(prev, next) * 4.2,
              color = terminal
                ? p.colors[0]
                : v > 0
                  ? p.colors[1]
                  : p.colors[3];
            return (
              <g key={i}>
                <rect
                  x={x}
                  y={v < 0 ? top : 570 - prev * 4.2 - h}
                  width={88}
                  height={h}
                  fill={color}
                />
                <Text
                  x={x + 44}
                  y={top - 16}
                  anchor="middle"
                  size={23}
                  fill={color}
                  opacity={k}
                >
                  {terminal ? v : (v > 0 ? "+" : "") + v}
                </Text>
                <Text
                  x={x + 44}
                  y={610}
                  anchor="middle"
                  size={17}
                  fill={p.muted}
                >
                  {["起点", "新增", "流失", "增长", "成本", "终点"][i]}
                </Text>
                {i < 5 && (
                  <path
                    d={`M${x + 88},${570 - next * 4.2}h76`}
                    stroke={p.muted}
                    strokeDasharray="4 4"
                    opacity={k}
                  />
                )}
              </g>
            );
          });
        })()}
      {kind === "sleep-tracker" &&
        Array.from({ length: 7 }, (_, i) => {
          const vals = [30 + (i % 3) * 8, 20 + (i % 2) * 9, 25 - (i % 3) * 4];
          let y = 570;
          return (
            <g key={i}>
              <defs>
                <clipPath id={`sleep${i}`}>
                  <rect
                    x={180 + i * 140}
                    y={210}
                    width={65}
                    height={360}
                    rx={32}
                  />
                </clipPath>
              </defs>
              <g clipPath={`url(#sleep${i})`}>
                {vals.map((v, j) => {
                  const h =
                    v *
                    3.8 *
                    phase(
                      t,
                      0.3 + i * 0.16 + j * 0.17,
                      1.7 + i * 0.16 + j * 0.17,
                    );
                  y -= h;
                  return (
                    <rect
                      key={j}
                      x={180 + i * 140}
                      y={y}
                      width={65}
                      height={h}
                      fill={p.colors[j]}
                    />
                  );
                })}
              </g>
              <Text
                x={212 + i * 140}
                y={610}
                size={18}
                anchor="middle"
                fill={p.muted}
              >
                周{["一", "二", "三", "四", "五", "六", "日"][i]}
              </Text>
            </g>
          );
        })}
    </Frame>
  );
}
