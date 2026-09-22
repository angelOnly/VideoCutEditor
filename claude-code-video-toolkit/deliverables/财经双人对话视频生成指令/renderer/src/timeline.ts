import type { FinanceTimeline } from './types';

// 此占位时间轴不能交付。Render 必须用本次任务的真实 TTS 时长覆盖它。
export const timeline: FinanceTimeline = {
  fps: 30,
  width: 1920,
  height: 1080,
  totalFrames: 30,
  title: '待生成的财经双人对话',
  chapters: [],
  scenes: [],
};
