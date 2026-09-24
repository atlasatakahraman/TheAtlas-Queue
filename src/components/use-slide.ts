"use client";
import { useLayoutEffect, useRef } from "react";

// One box that slides under whichever item in a track is active (August's sliding-tabs): the
// filter pills and the dashboard tabs. It is placed through its ref, so a render never waits on
// it; it does not slide on first paint (data-ready turns the transition on after), and it fades
// out when nothing in the track is active (Settings, which is not a tab).
const ACTIVE = '[aria-pressed="true"], [data-state="active"]';

export function useSlide<T extends HTMLElement = HTMLSpanElement>(active: unknown) {
  const track = useRef<HTMLDivElement>(null);
  const box = useRef<T>(null);

  useLayoutEffect(() => {
    const t = track.current;
    const b = box.current;
    if (!t || !b) return;
    const place = () => {
      const a = t.querySelector<HTMLElement>(ACTIVE);
      b.style.opacity = a ? "1" : "0";
      if (!a) return;
      b.style.transform = `translateX(${a.offsetLeft}px)`;
      b.style.width = `${a.offsetWidth}px`;
      requestAnimationFrame(() => (b.dataset.ready = ""));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(t);
    return () => ro.disconnect();
  }, [active]);

  return { track, box };
}

// The box's own classes: where it sits and how it moves. Colour and shape stay with the caller.
export const SLIDE =
  "pointer-events-none absolute left-0 w-0 data-ready:transition-[transform,width,opacity] data-ready:duration-300 data-ready:ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none!";
