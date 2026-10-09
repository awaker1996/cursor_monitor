import { useEffect, useRef, useState } from 'react';

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 把数值变化补间成一段短动画，用于 orb 中心的百分比数字。
 *
 * - `target` 为 null（无数据）时立即回到 null，不做补间；
 * - `prefers-reduced-motion: reduce` 下直接跳变；
 * - 补间途中 target 再次变化时，从**当前显示值**接着补，不会回跳。
 */
export function useCountUp(target: number | null, duration = 300): number | null {
  const [value, setValue] = useState<number | null>(target);
  const currentRef = useRef<number | null>(target);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const settle = (next: number | null) => {
      currentRef.current = next;
      setValue(next);
    };

    const from = currentRef.current;
    if (target === null || from === null || from === target || duration <= 0) {
      settle(target);
      return;
    }

    if (prefersReducedMotion()) {
      settle(target);
      return;
    }

    const startAt = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - startAt) / duration);
      // easeOutCubic：起步快、收尾稳，数字读数很快接近终值
      const eased = 1 - Math.pow(1 - progress, 3);
      if (progress < 1) {
        settle(from + (target - from) * eased);
        frameRef.current = requestAnimationFrame(step);
        return;
      }
      frameRef.current = null;
      settle(target);
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [target, duration]);

  return value;
}
