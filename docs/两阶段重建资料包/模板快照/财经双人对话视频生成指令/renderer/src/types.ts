export type Speaker = 'female-host' | 'male-chief';

export type Utterance = {
  id: string;
  text: string;
  src: string;
  startFrame: number;
  endFrameExclusive: number;
};

export type Caption = {
  utteranceId: string;
  text: string;
  startFrame: number;
  endFrameExclusive: number;
};

export type VisualBlock = {
  id: string;
  kind: 'metric' | 'comparison' | 'flow' | 'layers' | 'labels' | 'quote' | 'trend' | 'line' | 'gauge' | 'ring';
  startFrame: number;
  endFrameExclusive: number;
  props: Record<string, unknown>;
  // 指定面板内区域，后续入场不推动已有组件。
  slot?: 'full' | 'top' | 'bottom' | 'left' | 'right';
};

export type Chapter = {
  id: string;
  label: string;
  title: string;
  summary: string;
  from: number;
  endFrameExclusive: number;
  // 时间相对章节起点，跨 sceneId 不重启动画。
  visualBlocks: VisualBlock[];
};

export type SoundCue = {src: string; frame: number; durationFrames?: number; volume?: number};

export type DialogueScene = {
  id: string;
  from: number;
  frames: number;
  // 封装补帧不改变声音结束位置；省略时与 frames 相同。
  contentFrames?: number;
  speaker: Speaker;
  summary: string;
  chapter?: {title: string; frames: number};
  intro?: {src: string; fromFrame?: number; frames?: number; muted: boolean};
  outro?: {src: string; frames?: number; muted: boolean};
  utterances: Utterance[];
  captions: Caption[];
  visualBlocks: VisualBlock[];
  sfx?: SoundCue[];
};

export type FinanceTimeline = {
  fps: number;
  width: number;
  height: number;
  totalFrames: number;
  title: string;
  chapters: Chapter[];
  bgm?: {src: string; volume?: number};
  scenes: DialogueScene[];
};
