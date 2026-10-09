import React from "react";
import { Radar } from "../../shared/radial";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Radar kind="radar-morph" title="折线转雷达" theme="clean" {...props} />
  );
}
