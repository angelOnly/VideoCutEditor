import React from "react";
import { Composition, registerRoot } from "remotion";
import C0 from "./cases/cell-highlight/Scene";
import C1 from "./cases/line-trend/Scene";
import C2 from "./cases/comparison-lines/Scene";
import C3 from "./cases/clustered-column/Scene";
import C4 from "./cases/stacked-column/Scene";
import C5 from "./cases/bar-race/Scene";
import C6 from "./cases/ranking-rise/Scene";
import C7 from "./cases/sankey-flow/Scene";
import C8 from "./cases/sankey-mckinsey/Scene";
import C9 from "./cases/sankey-retro/Scene";
import C10 from "./cases/pie-basic/Scene";
import C11 from "./cases/pie-symbol/Scene";
import C12 from "./cases/percent-stacked/Scene";
import C13 from "./cases/butterfly-bar/Scene";
import C14 from "./cases/progress-bars/Scene";
import C15 from "./cases/cartesian-heatmap/Scene";
import C16 from "./cases/heatmap-mckinsey/Scene";
import C17 from "./cases/heatmap-retro/Scene";
import C18 from "./cases/treemap-single/Scene";
import C19 from "./cases/polar-rose/Scene";
import C20 from "./cases/jade-ring/Scene";
import C21 from "./cases/chord-flow/Scene";
import C22 from "./cases/chord-retro/Scene";
import C23 from "./cases/number-count/Scene";
import C24 from "./cases/dashboard-snapshot/Scene";
import C25 from "./cases/area-chart/Scene";
import C26 from "./cases/scatter-plot/Scene";
import C27 from "./cases/funnel-flow/Scene";
import C28 from "./cases/treemap-market/Scene";
import C29 from "./cases/pie-slice/Scene";
import C30 from "./cases/share-donut/Scene";
import C31 from "./cases/waterfall-bridge/Scene";
import C32 from "./cases/combo-chart/Scene";
import C33 from "./cases/horizontal-bar-metrics/Scene";
import C34 from "./cases/bar-skyline/Scene";
import C35 from "./cases/sleep-tracker/Scene";
import C36 from "./cases/radar-morph/Scene";
import C37 from "./cases/grid-chart-split/Scene";
import C38 from "./cases/stacked-cascade/Scene";
import C39 from "./cases/stacked-donut/Scene";
import C40 from "./cases/network-map/Scene";
import C41 from "./cases/data-story-board/Scene";
import C42 from "./cases/grid-build/Scene";
import catalog from "./catalog.json";
// 合成时长读取案例清单，避免重新导出时又补成固定八秒。
const duration = (id: string) => catalog.find(c => c.id === id)!.durationInFrames;
const Root = () => (
  <>
    <Composition
      id="cell-highlight"
      component={C0}
      durationInFrames={duration("cell-highlight")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="line-trend"
      component={C1}
      durationInFrames={duration("line-trend")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="comparison-lines"
      component={C2}
      durationInFrames={duration("comparison-lines")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="clustered-column"
      component={C3}
      durationInFrames={duration("clustered-column")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="stacked-column"
      component={C4}
      durationInFrames={duration("stacked-column")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="bar-race"
      component={C5}
      durationInFrames={duration("bar-race")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="ranking-rise"
      component={C6}
      durationInFrames={duration("ranking-rise")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="sankey-flow"
      component={C7}
      durationInFrames={duration("sankey-flow")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="sankey-mckinsey"
      component={C8}
      durationInFrames={duration("sankey-mckinsey")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="sankey-retro"
      component={C9}
      durationInFrames={duration("sankey-retro")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="pie-basic"
      component={C10}
      durationInFrames={duration("pie-basic")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="pie-symbol"
      component={C11}
      durationInFrames={duration("pie-symbol")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="percent-stacked"
      component={C12}
      durationInFrames={duration("percent-stacked")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="butterfly-bar"
      component={C13}
      durationInFrames={duration("butterfly-bar")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="progress-bars"
      component={C14}
      durationInFrames={duration("progress-bars")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="cartesian-heatmap"
      component={C15}
      durationInFrames={duration("cartesian-heatmap")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="heatmap-mckinsey"
      component={C16}
      durationInFrames={duration("heatmap-mckinsey")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="heatmap-retro"
      component={C17}
      durationInFrames={duration("heatmap-retro")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="treemap-single"
      component={C18}
      durationInFrames={duration("treemap-single")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="polar-rose"
      component={C19}
      durationInFrames={duration("polar-rose")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="jade-ring"
      component={C20}
      durationInFrames={duration("jade-ring")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="chord-flow"
      component={C21}
      durationInFrames={duration("chord-flow")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="chord-retro"
      component={C22}
      durationInFrames={duration("chord-retro")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="number-count"
      component={C23}
      durationInFrames={duration("number-count")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="dashboard-snapshot"
      component={C24}
      durationInFrames={duration("dashboard-snapshot")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="area-chart"
      component={C25}
      durationInFrames={duration("area-chart")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="scatter-plot"
      component={C26}
      durationInFrames={duration("scatter-plot")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="funnel-flow"
      component={C27}
      durationInFrames={duration("funnel-flow")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="treemap-market"
      component={C28}
      durationInFrames={duration("treemap-market")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="pie-slice"
      component={C29}
      durationInFrames={duration("pie-slice")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="share-donut"
      component={C30}
      durationInFrames={duration("share-donut")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="waterfall-bridge"
      component={C31}
      durationInFrames={duration("waterfall-bridge")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="combo-chart"
      component={C32}
      durationInFrames={duration("combo-chart")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="horizontal-bar-metrics"
      component={C33}
      durationInFrames={duration("horizontal-bar-metrics")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="bar-skyline"
      component={C34}
      durationInFrames={duration("bar-skyline")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="sleep-tracker"
      component={C35}
      durationInFrames={duration("sleep-tracker")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="radar-morph"
      component={C36}
      durationInFrames={duration("radar-morph")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="grid-chart-split"
      component={C37}
      durationInFrames={duration("grid-chart-split")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="stacked-cascade"
      component={C38}
      durationInFrames={duration("stacked-cascade")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="stacked-donut"
      component={C39}
      durationInFrames={duration("stacked-donut")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="network-map"
      component={C40}
      durationInFrames={duration("network-map")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="data-story-board"
      component={C41}
      durationInFrames={duration("data-story-board")}
      fps={30}
      width={1280}
      height={720}
    />
    <Composition
      id="grid-build"
      component={C42}
      durationInFrames={duration("grid-build")}
      fps={30}
      width={1280}
      height={720}
    />
  </>
);
registerRoot(Root);
