import React from "react";
import { Radial } from "../../shared/radial";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return <Radial kind="pie-slice" title="扇区揭示" theme="clean" {...props} />;
}
