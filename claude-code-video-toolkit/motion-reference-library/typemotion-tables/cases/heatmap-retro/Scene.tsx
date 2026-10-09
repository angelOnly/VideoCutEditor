import React from "react";
import { Matrix } from "../../shared/matrix";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Matrix kind="heatmap-retro" title="复古热力图" theme="retro" {...props} />
  );
}
