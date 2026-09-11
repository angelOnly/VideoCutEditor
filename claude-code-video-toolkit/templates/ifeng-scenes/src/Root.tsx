import React from "react";
import { Composition } from "remotion";
import config from "./scenes.json";
import { Scene, type SceneProps } from "./Scene";
export const Root: React.FC = () => (
  <>
    {config.scenes.map((scene, index) => (
      <Composition
        key={scene.id}
        id={`scene-${index}`}
        component={Scene}
        durationInFrames={scene.frames}
        fps={config.fps}
        width={config.width}
        height={config.height}
        defaultProps={scene as SceneProps}
      />
    ))}
  </>
);
