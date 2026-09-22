import {useLayoutEffect, useRef} from 'react';
import {cancelRender, continueRender, delayRender, useVideoConfig} from 'remotion';

// 检查实际 DOM，而非预定义区域；只负责可测的溢出/遮挡，不能替代审片。
export function inspectLayout(root: ParentNode = document): string[] {
  const errors: string[] = [];
  for (const element of root.querySelectorAll<HTMLElement>('[data-fit]')) {
    const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
    if (element.scrollWidth > element.clientWidth + 2 || (Number.isFinite(maxHeight) && element.scrollHeight > maxHeight + 2))
      errors.push(`文字溢出：${element.textContent?.slice(0, 40)} (${element.clientWidth}×${element.clientHeight}/${element.scrollWidth}×${element.scrollHeight})`);
  }
  const surfaces = [...root.querySelectorAll<HTMLElement>('[data-visual-surface]')];
  const visible = surfaces.filter((e) => Number(getComputedStyle(e.parentElement!).opacity) > .05);
  for (const e of visible) {
    const r = e.getBoundingClientRect(), area = e.closest('[data-dashboard]')!.getBoundingClientRect();
    if (r.left < area.left || r.right > area.right || r.bottom > area.bottom || r.top < area.top)
      errors.push(`图解越出面板：${e.closest('[data-block]')?.getAttribute('data-block')} (${r.left},${r.top},${r.right},${r.bottom}/${area.left},${area.top},${area.right},${area.bottom})`);
  }
  for (let i = 0; i < visible.length; i++) for (let j = i + 1; j < visible.length; j++) {
    const a = visible[i], b = visible[j];
    if (a.dataset.overlay === 'true' || b.dataset.overlay === 'true') continue;
    const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
    if (Math.min(r.right, s.right) - Math.max(r.left, s.left) > 2 && Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top) > 2)
      errors.push(`图解实际遮挡：${a.closest('[data-block]')?.getAttribute('data-block')}/${b.closest('[data-block]')?.getAttribute('data-block')}`);
  }
  return errors;
}

export const LayoutGuard: React.FC<{frame: number}> = ({frame}) => {
  const {width, height} = useVideoConfig();
  const anchor = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const root = anchor.current?.parentElement;
    if (!root) return;
    let disposed = false;
    const inspect = () => {
      // portal 移入画布才有实际尺寸；同时响应移入画布和逐帧变化。
      if (disposed || root.clientWidth !== width || root.clientHeight !== height) return;
      const handle = delayRender('检查文字边界');
      // 等待 portal 与字体完成一轮实际布局，静帧也执行同样检查。
      document.fonts.ready.then(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))).then(() => {
        if (!disposed && root.clientWidth === width && root.clientHeight === height) {
          const errors = inspectLayout(root);
          if (errors.length) cancelRender(new Error(`TASK_LAYOUT_INVALID：${errors.join('；')}`));
        }
        continueRender(handle);
      }).catch((error) => { continueRender(handle); if (!disposed) cancelRender(error); });
    };
    const observer = new ResizeObserver(inspect);
    observer.observe(root);
    inspect();
    return () => { disposed = true; observer.disconnect(); };
  }, [frame, width, height]);
  return <span ref={anchor} style={{display: 'none'}} />;
};
