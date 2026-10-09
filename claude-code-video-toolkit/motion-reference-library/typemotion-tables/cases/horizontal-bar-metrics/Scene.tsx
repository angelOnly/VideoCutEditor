import React from "react";
import { Bars } from "../../shared/cartesian";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Bars
      kind="horizontal-bar-metrics"
      title="横向指标条"
      theme="clean"
      {...props}
    />
  );
}
