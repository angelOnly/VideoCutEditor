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
  kind: 'metric' | 'comparison' | 'flow' | 'layers' | 'labels' | 'quote' | 'trend';
  startFrame: number;
  endFrameExclusive: number;
  props: Record<string, unknown>;
};

export type SoundCue = {src: string; frame: number; volume?: number};

export type DialogueScene = {
  id: string;
  from: number;
  frames: number;
  speaker: Speaker;
  summary: string;
  chapter?: {title: string; frames: number};
  intro?: {src: string};
  outro?: {src: string};
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
  bgm?: {src: string; volume?: number};
  scenes: DialogueScene[];
};
