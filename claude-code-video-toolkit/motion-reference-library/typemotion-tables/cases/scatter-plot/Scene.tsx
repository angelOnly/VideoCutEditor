import React from "react";
import { Cartesian } from "../../shared/cartesian";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Cartesian kind="scatter-plot" title="散点分布" theme="clean" {...props} />
  );
}
