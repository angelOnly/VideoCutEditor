// 默认节奏可调整；短区间自动压缩，保证最后一个可见帧完成动画。
export function motionFrames(available: number, requested: number | undefined, fallback: number) {
  return Math.max(0, Math.min(available - 1, requested ?? fallback));
}
