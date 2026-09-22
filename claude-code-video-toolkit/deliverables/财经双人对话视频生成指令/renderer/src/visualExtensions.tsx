import type {ComponentType} from 'react';
import type {VisualBlock} from './types';

export type VisualExtension = {
  component: ComponentType<{block: VisualBlock; frame: number}>;
  validate: (block: VisualBlock) => void;
};
// 只在任务副本中注册本期组件；实现和参数检查缺一不可。
export const visualExtensions: Record<string, VisualExtension> = {};
