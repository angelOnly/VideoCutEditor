import React from "react";
import {
  Frame,
  onColor,
  Text,
  themes,
  useTime,
  cue,
  phase,
  mix,
  names,
  SceneProps,
} from "./core";
type Props = SceneProps & { kind: string; title: string };
export function Matrix({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[theme],
    build = cue(t, cues, "build", [0.3, 2]),
    scan = cue(t, cues, "scan", [2.2, 5.3]);
  const heat = kind.includes("heatmap"),
    tree = kind.startsWith("treemap");
  return (
    <Frame
      title={title}
      sub="网格先建立秩序，颜色和面积再传达差异"
      theme={theme}
      bare={bare}
    >
      {["cell-highlight", "grid-build"].includes(kind) ? (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <path
              key={"th" + i}
              d={`M210,${210 + i * 66}h${860 * build}`}
              stroke={p.grid}
              strokeWidth={2}
            />
          ))}
          {Array.from({ length: 4 }, (_, i) => (
            <path
              key={"tv" + i}
              d={`M${210 + (i * 860) / 3},210v${330 * build}`}
              stroke={p.grid}
              strokeWidth={2}
            />
          ))}
          {["产品", "指数", "变化"].map((label, i) => (
            <Text
              key={label}
              x={235 + (i * 860) / 3}
              y={251}
              size={23}
              weight={700}
              fill={p.ink}
              opacity={build}
            >
              {label}
            </Text>
          ))}
          {Array.from({ length: 4 }, (_, i) => {
            const k = phase(
                t,
                kind === "grid-build" ? 1.8 + i * 0.2 : 0.4 + i * 0.2,
                kind === "grid-build" ? 2.5 + i * 0.2 : 1.1 + i * 0.2,
              ),
              y = 276 + i * 66,
              active = Math.min(3, Math.floor(scan * 4)) === i;
            return (
              <g key={i} opacity={k}>
                {active && (
                  <rect
                    x={212}
                    y={y + 2}
                    width={856}
                    height={62}
                    fill={p.colors[0]}
                    fillOpacity={0.12}
                  />
                )}
                <Text x={235} y={y + 42} size={24} fill={p.ink}>
                  {names[i]}
                </Text>
                <Text x={525} y={y + 42} size={24} fill={p.ink}>
                  {[98, 95, 92, 88][i]}
                </Text>
                <Text x={810} y={y + 42} size={24} fill={p.colors[0]}>
                  +{[8, 12, 6, 15][i]}%
                </Text>
              </g>
            );
          })}
        </>
      ) : tree ? (
        (() => {
          const cells = [
            { x: 160, y: 200, w: 470, h: 360 },
            { x: 635, y: 200, w: 280, h: 210 },
            { x: 920, y: 200, w: 200, h: 210 },
            { x: 635, y: 415, w: 280, h: 145 },
            { x: 920, y: 415, w: 200, h: 145 },
          ];
          const total = cells.reduce((s, c) => s + c.w * c.h, 0);
          return cells.map((c, i) => {
            const k = phase(t, 0.3 + i * 0.3, 1.5 + i * 0.3),
              v = Math.round(((c.w * c.h) / total) * 100);
            return (
              <g
                key={i}
                transform={`translate(${c.x + c.w / 2} ${c.y + c.h / 2}) scale(${0.85 + 0.15 * k})`}
                opacity={k}
              >
                <rect
                  x={-c.w / 2}
                  y={-c.h / 2}
                  width={c.w}
                  height={c.h}
                  rx={5}
                  fill={
                    kind === "treemap-market"
                      ? i % 2
                        ? p.colors[3]
                        : p.colors[1]
                      : p.colors[i]
                  }
                />
                <Text
                  x={-c.w / 2 + 20}
                  y={-c.h / 2 + 38}
                  size={22}
                  fill={onColor(
                    kind === "treemap-market"
                      ? p.colors[i % 2 ? 3 : 1]
                      : p.colors[i],
                  )}
                  weight={700}
                >
                  {names[i]}
                </Text>
                <Text
                  x={0}
                  y={20}
                  anchor="middle"
                  size={c.w > 300 ? 62 : 35}
                  fill={onColor(
                    kind === "treemap-market"
                      ? p.colors[i % 2 ? 3 : 1]
                      : p.colors[i],
                  )}
                  weight={700}
                >
                  {v}%
                </Text>
                {kind === "treemap-market" && (
                  <Text
                    x={0}
                    y={52}
                    anchor="middle"
                    size={18}
                    fill={onColor(
                      kind === "treemap-market"
                        ? p.colors[i % 2 ? 3 : 1]
                        : p.colors[i],
                    )}
                    opacity={scan}
                  >
                    {i % 2 ? "−3.2%" : "+5.6%"}
                  </Text>
                )}
              </g>
            );
          });
        })()
      ) : (
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <path
              key={`h${i}`}
              d={`M170,${200 + i * 60}h${920 * build}`}
              stroke={p.grid}
              strokeWidth={1.5}
            />
          ))}
          {Array.from({ length: 6 }, (_, i) => (
            <path
              key={`v${i}`}
              d={`M${170 + i * 184},200v${360 * build}`}
              stroke={p.grid}
              strokeWidth={1.5}
            />
          ))}
          {Array.from({ length: 30 }, (_, i) => {
            const r = Math.floor(i / 5),
              c = i % 5,
              x = 170 + c * 184,
              y = 200 + r * 60,
              v = 15 + ((i * 23) % 85),
              k = phase(
                t,
                kind === "grid-build"
                  ? 1.8 + r * 0.16
                  : 0.3 + r * 0.15 + c * 0.07,
                kind === "grid-build"
                  ? 2.5 + r * 0.16
                  : 1 + r * 0.15 + c * 0.07,
              ),
              selected = Math.floor(scan * 29) === i;
            return (
              <g key={i} opacity={k}>
                {heat ? (
                  <rect
                    x={x + 4}
                    y={y + 4}
                    width={176}
                    height={52}
                    fill={p.colors[0]}
                    opacity={v / 100}
                  />
                ) : (
                  selected && (
                    <rect
                      x={x + 2}
                      y={y + 2}
                      width={180}
                      height={56}
                      fill={p.colors[0]}
                      fillOpacity={0.16}
                    />
                  )
                )}
                <Text
                  x={x + 92}
                  y={y + 38}
                  anchor="middle"
                  size={21}
                  fill={heat && v > 60 ? "white" : p.ink}
                  weight={selected ? 700 : 500}
                >
                  {v}
                </Text>
              </g>
            );
          })}
          {heat && (
            <>
              {Array.from({ length: 5 }, (_, i) => (
                <Text
                  key={"col" + i}
                  x={262 + i * 184}
                  y={187}
                  anchor="middle"
                  size={17}
                  fill={p.muted}
                >
                  {["一月", "二月", "三月", "四月", "五月"][i]}
                </Text>
              ))}
              {Array.from({ length: 6 }, (_, i) => (
                <Text
                  key={"row" + i}
                  x={148}
                  y={238 + i * 60}
                  anchor="end"
                  size={17}
                  fill={p.muted}
                >
                  {names[i]}
                </Text>
              ))}
              <Text x={170} y={605} size={17} fill={p.muted}>
                低
              </Text>
              {Array.from({ length: 8 }, (_, i) => (
                <rect
                  key={i}
                  x={210 + i * 35}
                  y={588}
                  width={32}
                  height={18}
                  fill={p.colors[0]}
                  opacity={(i + 1) / 8}
                />
              ))}
              <Text x={510} y={605} size={17} fill={p.muted}>
                高
              </Text>
            </>
          )}
        </>
      )}
      {kind === "stacked-cascade" && null}
    </Frame>
  );
}
export function Cascade({ title, theme = "clean", bare, cues, time }: Props) {
  const t = useTime(time),
    p = themes[theme];
  const values = [28, 24, 20, 16, 12];
  return (
    <Frame
      title={title}
      sub="分层从底部叠合，建立整体，再读取构成"
      theme={theme}
      bare={bare}
    >
      {values.map((v, i) => {
        const k = phase(t, 0.4 + (4 - i) * 0.5, 1.5 + (4 - i) * 0.5),
          y = 220 + i * 72;
        return (
          <g key={i} transform={`translate(0 ${mix(150, 0, k)})`} opacity={k}>
            <rect
              x={190}
              y={y}
              width={900}
              height={66}
              rx={4}
              fill={p.colors[i]}
            />
            <Text
              x={215}
              y={y + 42}
              size={24}
              fill={onColor(p.colors[i])}
              weight={700}
            >
              {names[i]}
            </Text>
            <Text
              x={1060}
              y={y + 42}
              anchor="end"
              size={24}
              fill={onColor(p.colors[i])}
              weight={700}
            >
              {v}%
            </Text>
          </g>
        );
      })}
    </Frame>
  );
}
