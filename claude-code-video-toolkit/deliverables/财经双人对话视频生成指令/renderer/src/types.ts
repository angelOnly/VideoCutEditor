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
  kind: string;
  // 任务内有意叠层仍须审查动态效果。
  intentionalOverlap?: boolean;
  animationFrames?: number;
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
  utterances: Utterance[];
  captions: Caption[];
  // 可选：真实音频绑定的分页时间记录，路径分别用于工程和可信终检。
  captionTiming?: {src: string; path: string; sha256: string};
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
  // 固定结束语期间只保持正文视觉；片尾由共享合成工具顺序追加。
  ending?: {
    closingUtteranceIds: string[];
    holdFrame?: number;
    narrationEndFrame: number;
    outro?: {src: string; frames: number; muted: boolean};
  };
  scenes: DialogueScene[];
};
