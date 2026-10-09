import React from "react";
import { Dashboard } from "../../shared/dashboard";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Dashboard
      kind="data-story-board"
      title="数据叙事板"
      theme="dark"
      {...props}
    />
  );
}
