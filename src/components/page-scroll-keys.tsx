"use client";
import { useEffect } from "react";

// The page scrolls inside a ScrollArea (root layout), so with focus on <body> the browser has no
// document scroller to move for PageDown, Space, arrows, Home and End. This forwards them.
export function PageScrollKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target !== document.body || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const vp = document.querySelector<HTMLElement>("#page-scroll > [data-slot=scroll-area-viewport]");
      if (!vp) return;
      const page = vp.clientHeight * 0.9;
      const by: Record<string, number> = {
        PageDown: page, PageUp: -page, " ": e.shiftKey ? -page : page, ArrowDown: 40, ArrowUp: -40,
        Home: -vp.scrollHeight, End: vp.scrollHeight,
      };
      if (!(e.key in by)) return;
      e.preventDefault();
      vp.scrollBy({ top: by[e.key], behavior: e.key.startsWith("Arrow") ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
