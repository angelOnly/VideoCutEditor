import React from "react";
import { Radial } from "../../shared/radial";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return <Radial kind="polar-rose" title="玫瑰图" theme="clean" {...props} />;
}
