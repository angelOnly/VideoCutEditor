import React from "react";
import {
  Frame,
  Text,
  Trace,
  themes,
  useTime,
  cue,
  phase,
  mix,
  arc,
  SceneProps,
} from "./core";
type Props = SceneProps & { kind: string; title: string };
export function Dashboard({
  kind,
  title,
  theme = "clean",
  bare,
  cues,
  time,
}: Props) {
  const t = useTime(time),
    p = themes[theme],
    build = cue(t, cues, "build", [0.3, 2.3]),
    detail = cue(t, cues, "detail", [2.7, 4.8]);
  if (kind === "number-count")
    return (
      <Frame
        title={title}
        sub="主数值滚动收敛，随后揭示变化幅度与趋势"
        theme={theme}
        bare={bare}
      >
        <Text x={640} y={292} anchor="middle" size={23} fill={p.muted}>
          月度活跃用户 · 示例
        </Text>
        <Text
          x={640}
          y={445}
          anchor="middle"
          size={124}
          weight={700}
          fill={p.ink}
        >
          {Math.round(128450 * build).toLocaleString("en-US")}
        </Text>
        <Text
          x={640}
          y={509}
          anchor="middle"
          size={32}
          fill={p.colors[1]}
          opacity={detail}
        >
          较上期 +18.6%
        </Text>
        <Trace
          d="M450,598L510,582L570,588L630,563L690,568L750,540L830,525"
          color={p.colors[0]}
          progress={detail}
        />
      </Frame>
    );
  const story = kind === "data-story-board",
    split = kind === "grid-chart-split";
  const cards = story
    ? [
        [170, 215, 330, 310],
        [520, 215, 590, 310],
      ]
    : split
      ? [
          [170, 195, 455, 200],
          [645, 195, 455, 200],
          [170, 415, 455, 200],
          [645, 415, 455, 200],
        ]
      : [
          [170, 195, 285, 135],
          [475, 195, 285, 135],
          [780, 195, 320, 135],
          [170, 350, 590, 250],
          [780, 350, 320, 250],
        ];
  return (
    <Frame
      title={title}
      sub="框架展开后分区填充，图表与洞察按顺序揭示"
      theme={theme}
      bare={bare}
    >
      {cards.map(([x, y, w, h], i) => {
        const k = phase(t, 0.2 + i * 0.17, 1 + i * 0.17);
        return (
          <g
            key={i}
            opacity={k}
            transform={`translate(${(1 - k) * (i % 2 ? 50 : -50)} 0)`}
          >
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={story ? 14 : 5}
              fill={story ? "#192132" : p.bg}
              stroke={p.grid}
            />
          </g>
        );
      })}
      {story ? (
        <>
          <Text x={205} y={280} size={16} fill={p.colors[3]} opacity={build}>
            关键洞察
          </Text>
          <Text
            x={205}
            y={347}
            size={43}
            weight={700}
            fill="white"
            opacity={build}
          >
            用户增长
          </Text>
          <Text
            x={205}
            y={420}
            size={55}
            weight={700}
            fill={p.colors[0]}
            opacity={detail}
          >
            +18.6%
          </Text>
          <Trace
            d="M560,475L640,428L720,445L800,367L880,388L960,294L1070,265"
            color={p.colors[0]}
            progress={detail}
          />
          <rect x={170} y={550} width={940} height={47} rx={5} fill="#192132" />
          <Text x={195} y={580} size={17} fill="#aebbd0" opacity={detail}>
            口径：当月与上月比较　｜　数据：演示数据
          </Text>
        </>
      ) : split ? (
        <>
          {cards.map(([x, y], i) => (
            <g key={i} opacity={phase(t, 1 + i * 0.4, 1.8 + i * 0.4)}>
              <Text x={x + 25} y={y + 35} size={15} fill={p.muted}>
                {["趋势", "规模", "构成", "增长"][i]}
              </Text>
              <Text x={x + 25} y={y + 90} size={41} weight={700} fill={p.ink}>
                {[128, 86, 32, 19][i]}
                {i > 1 ? "%" : ""}
              </Text>
            </g>
          ))}
          <Trace
            d="M200,365L260,348L320,358L390,319L455,330L575,285"
            color={p.colors[0]}
            progress={detail}
          />
          {[70, 95, 60, 120].map((v, i) => (
            <rect
              key={i}
              x={785 + i * 65}
              y={370 - v * detail}
              width={44}
              height={v * detail}
              rx={3}
              fill={p.colors[i]}
            />
          ))}
          <circle
            cx={525}
            cy={524}
            r={53}
            stroke={p.grid}
            strokeWidth={17}
            fill="none"
          />
          <path
            d={arc(
              525,
              524,
              53,
              -Math.PI / 2,
              -Math.PI / 2 + Math.max(0.001, detail) * Math.PI * 1.5,
            )}
            stroke={p.colors[0]}
            strokeWidth={17}
            fill="none"
          />
          <Text
            x={1020}
            y={565}
            anchor="end"
            size={39}
            fill={p.colors[1]}
            opacity={detail}
          >
            +19%
          </Text>
        </>
      ) : (
        <>
          {["总用户", "转化率", "月度增量"].map((v, i) => (
            <g key={i} opacity={phase(t, 0.8 + i * 0.3, 1.5 + i * 0.3)}>
              <Text x={195 + i * 305} y={228} size={16} fill={p.muted}>
                {v}
              </Text>
              <Text
                x={195 + i * 305}
                y={295}
                size={43}
                fill={p.ink}
                weight={700}
              >
                {[128450, 32, 1860][i].toLocaleString("en-US")}
                {i === 1 ? "%" : ""}
              </Text>
            </g>
          ))}
          <Trace
            d="M200,565L270,520L350,540L430,470L520,485L610,410L730,389"
            color={p.colors[0]}
            progress={detail}
          />
          {[62, 84, 45, 72].map((v, i) => (
            <g key={i}>
              <rect
                x={810}
                y={385 + i * 48}
                width={v * 2.8 * detail}
                height={23}
                rx={3}
                fill={p.colors[i]}
              />
              <Text
                x={810 + v * 2.8 + 12}
                y={404 + i * 48}
                size={16}
                fill={p.muted}
                opacity={detail}
              >
                {v}
              </Text>
            </g>
          ))}
        </>
      )}
    </Frame>
  );
}
