import React from "react";
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
export type SceneProps = {
  id: string;
  content: string;
  frames: number;
  audio: string;
  animationPreset: string;
  layoutPreset: string;
  keywords: string[];
  assets: {
    kind: string;
    file: string;
    startFrame: number;
    frames: number;
    role: string;
  }[];
};
export const Scene: React.FC<SceneProps> = ({
  content,
  frames,
  audio,
  animationPreset,
  keywords,
  assets,
}) => {
  const frame = useCurrentFrame(),
    { width, height } = useVideoConfig();
  const zoom =
    animationPreset === "slow_zoom"
      ? interpolate(frame, [0, Math.max(1, frames - 1)], [1, 1.06])
      : 1;
  const opacity =
    animationPreset === "fade"
      ? interpolate(frame, [0, Math.min(8, frames - 1)], [0, 1], {
          extrapolateRight: "clamp",
        })
      : 1;
  // Sentence captions may be paged for readability; these are not claimed to be word-aligned.
  const pages = content.match(/.{1,40}/gu) ?? [content];
  const page =
    pages[
      Math.min(pages.length - 1, Math.floor((frame / frames) * pages.length))
    ];
  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#112e34",
        fontFamily: "Noto Sans CJK SC, sans-serif",
        color: "white",
      }}
    >
      {assets.map((a, i) => (
        <Sequence key={i} from={a.startFrame} durationInFrames={a.frames}>
          <AbsoluteFill
            style={
              a.role === "presenter"
                ? {
                    inset: "auto 5% 22% auto",
                    width: "32%",
                    height: "33%",
                    borderRadius: 24,
                    overflow: "hidden",
                  }
                : { transform: `scale(${zoom})`, opacity }
            }
          >
            {a.kind === "video" ? (
              <OffthreadVideo
                src={staticFile(a.file)}
                muted
                style={{ height: "100%", width: "100%", objectFit: "cover" }}
              />
            ) : (
              <Img
                src={staticFile(a.file)}
                style={{ height: "100%", width: "100%", objectFit: "cover" }}
              />
            )}
          </AbsoluteFill>
        </Sequence>
      ))}
      {keywords.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "12%",
            left: "8%",
            right: "8%",
            fontSize: Math.max(18, Math.round(width * 0.055)),
            fontWeight: 700,
            color: "#ffd56a",
            textShadow: "0 2px 12px #000",
          }}
        >
          {keywords.join(" · ")}
        </div>
      )}
      <div
        style={{
          position: "absolute",
          bottom: "9%",
          left: "7%",
          right: "7%",
          padding: "3%",
          borderRadius: 12,
          background: "rgba(0,0,0,.60)",
          fontSize: Math.max(
            16,
            Math.round(Math.min(width * 0.045, height * 0.038)),
          ),
          lineHeight: 1.5,
          textAlign: "center",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {page}
      </div>
      <Audio src={staticFile(audio)} />
    </AbsoluteFill>
  );
};
