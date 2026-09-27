"use client";
import { useEffect } from "react";
import { Typewriter, type TypewriterProps } from "@/components/typewriter";
import { useMedia, useStored } from "@/components/use-client-state";

// Per-browser preferences (owner, 2026-09-27): Animations and Notifications, both on by default.
// Reduced motion in the system turns Animations off and locks the switch. <html> carries them as
// data-motion / data-toasts for globals.css; PREFS_SCRIPT sets both before the first paint.
const ON_OFF = ["on", "off"] as const;
export const PREFS_SCRIPT =
  "try{var d=document.documentElement,s=localStorage;d.dataset.motion=s.getItem('pref.motion')==='off'?'off':'on';d.dataset.toasts=s.getItem('pref.toasts')==='off'?'off':'on'}catch(e){}";

export function usePrefs() {
  const [motion, setMotion] = useStored("pref.motion", "on", ON_OFF);
  const [toasts, setToasts] = useStored("pref.toasts", "on", ON_OFF);
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  return {
    motion: motion === "on" && !reduced,
    // The system's reduced motion wins; the switch shows off and cannot be turned on.
    motionLocked: reduced,
    setMotion: (on: boolean) => setMotion(on ? "on" : "off"),
    toasts: toasts === "on",
    setToasts: (on: boolean) => setToasts(on ? "on" : "off"),
  };
}

export const useMotion = () => usePrefs().motion;

// Keeps <html>'s attributes in step when a preference changes (in this tab or another).
export function PrefsSync() {
  const { motion, toasts } = usePrefs();
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
    document.documentElement.dataset.toasts = toasts ? "on" : "off";
  }, [motion, toasts]);
  return null;
}

// Typewriter, or the plain line when Animations are off (Typewriter itself stays verbatim).
export function Typed(props: TypewriterProps) {
  return useMotion() ? <Typewriter {...props} /> : <span className={props.className}>{props.text}</span>;
}
