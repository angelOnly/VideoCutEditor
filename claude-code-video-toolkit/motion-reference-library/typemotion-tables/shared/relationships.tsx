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
  polar,
  arc,
  names,
  SceneProps,
} from "./core";
type Props = SceneProps & { kind: string; title: string };
export function Relationships({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[theme],
    build = cue(t, cues, "build", [0.5, 3]),
    detail = cue(t, cues, "detail", [3.2, 5.2]);
  const sankey = kind.startsWith("sankey"),
    chord = kind.startsWith("chord");
  const nodes = [
    { x: 640, y: 365, label: "核心" },
    { x: 355, y: 230, label: "研发" },
    { x: 945, y: 240, label: "生产" },
    { x: 990, y: 490, label: "渠道" },
    { x: 660, y: 580, label: "用户" },
    { x: 325, y: 500, label: "服务" },
    { x: 470, y: 385, label: "数据" },
  ];
  const links = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 5],
    [0, 6],
    [1, 6],
    [2, 3],
    [4, 5],
  ];
  return (
    <Frame
      title={title}
      sub="先出现实体，再建立连接，沿连接传递信息"
      theme={theme}
      bare={bare}
    >
      {sankey && (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i} opacity={phase(t, 0.2 + i * 0.2, 0.8 + i * 0.2)}>
              <rect
                x={240}
                y={240 + i * 115}
                width={18}
                height={70}
                rx={3}
                fill={p.colors[i]}
              />
              <Text x={218} y={283 + i * 115} anchor="end" fill={p.ink}>
                {["渠道 A", "渠道 B", "渠道 C"][i]}
              </Text>
              <rect
                x={1000}
                y={240 + i * 115}
                width={18}
                height={70}
                rx={3}
                fill={p.colors[i + 3]}
              />
              <Text x={1040} y={283 + i * 115} fill={p.ink}>
                {["结果 A", "结果 B", "结果 C"][i]}
              </Text>
            </g>
          ))}
          {[
            { a: 0, b: 1, w: 28 },
            { a: 0, b: 0, w: 42 },
            { a: 1, b: 0, w: 28 },
            { a: 1, b: 2, w: 42 },
            { a: 2, b: 1, w: 42 },
            { a: 2, b: 2, w: 28 },
          ].map((l, i, flows) => {
            // 同一份流量累计出两端的位置，防止带宽重叠或接错节点。
            const sy =
                240 +
                l.a * 115 +
                flows
                  .slice(0, i)
                  .filter((f) => f.a === l.a)
                  .reduce((n, f) => n + f.w, 0) +
                l.w / 2,
              ty =
                240 +
                l.b * 115 +
                flows
                  .slice(0, i)
                  .filter((f) => f.b === l.b)
                  .reduce((n, f) => n + f.w, 0) +
                l.w / 2,
              k = phase(t, 0.7 + i * 0.3, 2.2 + i * 0.3);
            return (
              <g key={i}>
                <defs>
                  <linearGradient id={`r${i}`}>
                    <stop stopColor={p.colors[l.a]} />
                    <stop offset="1" stopColor={p.colors[l.b + 3]} />
                  </linearGradient>
                </defs>
                <Trace
                  d={`M258,${sy}C570,${sy} 690,${ty} 1000,${ty}`}
                  color={`url(#r${i})`}
                  progress={k}
                  width={l.w}
                  opacity={0.65}
                />
              </g>
            );
          })}
          <Text
            x={640}
            y={610}
            anchor="middle"
            size={19}
            fill={p.muted}
            opacity={detail}
          >
            示例总量 210 · 连接带宽按流量绘制
          </Text>
        </>
      )}
      {chord && (
        <>
          {Array.from({ length: 6 }, (_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 3;
            const xy = polar(640, 403, 235, a);
            return (
              <g key={i} opacity={phase(t, 0.2 + i * 0.15, 0.9 + i * 0.15)}>
                <path
                  d={arc(640, 403, 192, a - 0.25, a + 0.25)}
                  fill="none"
                  stroke={p.colors[i]}
                  strokeWidth={22}
                />
                <Text
                  x={xy[0]}
                  y={xy[1] + 6}
                  anchor="middle"
                  size={20}
                  fill={p.ink}
                >
                  {names[i]}
                </Text>
              </g>
            );
          })}
          {[
            [0, 2],
            [0, 3],
            [1, 4],
            [1, 5],
            [2, 4],
            [3, 5],
          ].map(([a, b], i) => {
            const aa = -Math.PI / 2 + (a * Math.PI) / 3,
              bb = -Math.PI / 2 + (b * Math.PI) / 3,
              s1 = polar(640, 403, 182, aa - 0.1),
              s2 = polar(640, 403, 182, aa + 0.1),
              e1 = polar(640, 403, 182, bb - 0.1),
              e2 = polar(640, 403, 182, bb + 0.1);
            return (
              <path
                key={i}
                d={`M${s1}Q640,403 ${e2}L${e1}Q640,403 ${s2}Z`}
                fill={p.colors[a]}
                opacity={phase(t, 1 + i * 0.35, 2 + i * 0.35) * 0.55}
              />
            );
          })}
        </>
      )}
      {kind === "network-map" && (
        <>
          {links.map(([a, b], i) => {
            const s = nodes[a],
              e = nodes[b],
              dx = e.x - s.x,
              dy = e.y - s.y,
              len = Math.hypot(dx, dy),
              sx = s.x + (dx / len) * 35,
              sy = s.y + (dy / len) * 35,
              ex = e.x - (dx / len) * 35,
              ey = e.y - (dy / len) * 35;
            const k = phase(t, 1 + i * 0.25, 2 + i * 0.25);
            return (
              <g key={i}>
                <Trace
                  d={`M${sx},${sy}L${ex},${ey}`}
                  color={p.colors[i % 6]}
                  progress={k}
                  width={3}
                  opacity={0.5}
                />
                {detail > 0 && detail < 1 && (
                  <circle
                    cx={sx + (ex - sx) * detail}
                    cy={sy + (ey - sy) * detail}
                    r={5}
                    fill={p.colors[i % 6]}
                  />
                )}
              </g>
            );
          })}
          {nodes.map((n, i) => {
            const k = phase(t, 0.25 + i * 0.16, 1 + i * 0.16);
            return (
              <g key={i} transform={`translate(${n.x} ${n.y}) scale(${k})`}>
                <circle r={i === 0 ? 43 : 33} fill={p.colors[i % 6]} />
                <Text
                  x={0}
                  y={7}
                  anchor="middle"
                  size={19}
                  weight={700}
                  fill={onColor(p.colors[i % 6])}
                >
                  {n.label}
                </Text>
              </g>
            );
          })}
        </>
      )}
      {kind === "funnel-flow" &&
        [100, 76, 48, 22].map((v, i) => {
          const w = v * 8,
            x = 640 - w / 2,
            y = 220 + i * 90,
            k = phase(t, 0.3 + i * 0.6, 1.3 + i * 0.6),
            next = [76, 48, 22, 16][i] * 8;
          return (
            <g key={i} opacity={k} transform={`translate(0 ${(1 - k) * -25})`}>
              <path
                d={`M${x},${y}h${w}L${640 + next / 2},${y + 68}H${640 - next / 2}Z`}
                fill={p.colors[i]}
              />
              <Text
                x={640}
                y={y + 41}
                anchor="middle"
                size={23}
                fill={onColor(p.colors[i % 6])}
                weight={700}
              >
                {["触达", "访问", "意向", "转化"][i]}　{Math.round(v * k)}%
              </Text>
            </g>
          );
        })}
    </Frame>
  );
}
