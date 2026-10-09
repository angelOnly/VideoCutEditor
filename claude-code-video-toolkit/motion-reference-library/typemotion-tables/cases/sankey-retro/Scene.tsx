import React from "react";
import { Relationships } from "../../shared/relationships";
import { SceneProps } from "../../shared/core";
// 仅复用正文图形；栏目包装由任务模板控制。
export default function Scene(props: SceneProps) {
  return (
    <Relationships
      kind="sankey-retro"
      title="复古桑基图"
      theme="retro"
      {...props}
    />
  );
}
