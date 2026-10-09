import React from "react";
import { Cascade } from "../../shared/matrix";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Cascade kind="stacked-cascade" title="堆叠层叠" theme="clean" {...props} />
  );
}
