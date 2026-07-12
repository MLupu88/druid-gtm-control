import { useEffect, useRef } from "react";

export function useParallax<T extends HTMLElement>(max = 10) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const isNarrow = window.matchMedia("(max-width: 1023px)").matches;

    if (prefersReduced || isCoarsePointer || isNarrow) {
      return;
    }

    let frame = 0;
    let targetX = 0;
    let targetY = 0;

    function apply() {
      frame = 0;
      el?.style.setProperty("--px", `${targetX.toFixed(1)}px`);
      el?.style.setProperty("--py", `${targetY.toFixed(1)}px`);
    }

    function onMove(event: PointerEvent) {
      targetX = (event.clientX / window.innerWidth - 0.5) * 2 * max;
      targetY = (event.clientY / window.innerHeight - 0.5) * 2 * max;
      if (!frame) {
        frame = requestAnimationFrame(apply);
      }
    }

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [max]);

  return ref;
}
