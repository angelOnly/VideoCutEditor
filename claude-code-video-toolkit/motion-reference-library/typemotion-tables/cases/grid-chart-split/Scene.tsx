import React from "react";
import { Dashboard } from "../../shared/dashboard";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Dashboard
      kind="grid-chart-split"
      title="分屏图表"
      theme="clean"
      {...props}
    />
  );
}
