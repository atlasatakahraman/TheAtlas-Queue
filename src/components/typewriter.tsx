'use client';

import { useEffect, useState, useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
	const query = window.matchMedia(REDUCED_MOTION);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

/**
 * The reader's motion preference, read during render rather than in an effect.
 *
 * `useSyncExternalStore` is what the app-state store already uses, and it is
 * the reason this component never calls `setState` synchronously inside an
 * effect: the preference is derived, not stored. It also picks up a change made
 * while the window is open, which a one-shot `matchMedia` read in an effect
 * would miss.
 */
function usePrefersReducedMotion(): boolean {
	return useSyncExternalStore(
		subscribeToMotionPreference,
		() => window.matchMedia(REDUCED_MOTION).matches,
		() => false,
	);
}

export type TypewriterProps = {
	/** Retyped from the start whenever this changes. */
	text: string;
	/**
	 * Milliseconds between characters. Changing it mid-line restarts the run,
	 * because the interval it drives has to be rebuilt.
	 */
	speed?: number;
	/** Milliseconds before the first character lands. */
	startDelay?: number;
	/**
	 * How far each character is blurred before it lands, as a CSS length.
	 *
	 * `em` keeps it proportional to the font size, so the same value reads the
	 * same on a 36px greeting and a 14px label. Applied through a custom
	 * property, so it takes effect on the next character without restarting.
	 */
	blur?: string;
	/**
	 * Milliseconds for one character to go from blurred to sharp.
	 *
	 * Distinct from `speed`, which is the gap between characters. Setting this
	 * longer than `speed` is what gives the line a trailing edge of several
	 * characters still resolving. 200ms is the layout rung of the motion ladder
	 * in docs/DESIGN.md; going off it is a decision worth a comment.
	 */
	reveal?: number;
	/** Applied to the wrapper, so the caller owns size, face and colour. */
	className?: string;
};

/**
 * Reveals `text` one character at a time, each landing out of a blur.
 *
 * **Untyped characters are `invisible`, not absent.** `visibility: hidden`
 * keeps them in layout, so the element occupies its final width from the first
 * frame and nothing after it moves while the line types. Rendering a growing
 * substring instead would reflow on every character.
 *
 * The blur is `.type-in` in `globals.css`: a keyframe, because a transition
 * needs the element to have painted in its start state first, and these spans
 * take the class in the same commit that makes them visible.
 *
 * **Accessibility.** The characters are `aria-hidden` — a screen reader walking
 * them would announce the line letter by letter — and the real string is
 * carried once in an `sr-only` span. Reduced motion shows the finished line
 * immediately instead of typing it slowly.
 */
export function Typewriter({
	text,
	speed = 40,
	startDelay = 0,
	blur = "0.12em",
	reveal = 200,
	className,
}: TypewriterProps) {
	const reduced = usePrefersReducedMotion();
	const [run, setRun] = useState({ text, typed: 0 });

	// Resetting when a prop changes belongs in render, not in an effect. React
	// discards this pass and re-runs immediately, which is cheaper than
	// committing a frame of the old line and then correcting it — and it keeps
	// `setState` out of the effect body entirely.
	if (run.text !== text) setRun({ text, typed: 0 });

	const typed = reduced ? text.length : run.typed;

	useEffect(() => {
		if (reduced) return;

		let i = 0;
		let tick: ReturnType<typeof setInterval> | undefined;

		const begin = setTimeout(() => {
			tick = setInterval(() => {
				i += 1;
				// Guarded: a timer from the previous string can still fire once
				// between the prop changing and this effect being torn down.
				setRun((current) => (current.text === text ? { text, typed: i } : current));
				if (i >= text.length && tick) clearInterval(tick);
			}, speed);
		}, startDelay);

		return () => {
			clearTimeout(begin);
			if (tick) clearInterval(tick);
		};
	}, [text, speed, startDelay, reduced]);

	return (
		// The two knobs ride down as custom properties rather than as a second
		// class per combination: `.type-in` reads them at the moment each
		// character's animation starts, so a change lands on the next character
		// instead of restarting the line.
		<span
			className={className}
			style={{ "--type-blur": blur, "--type-reveal": `${reveal}ms` } as React.CSSProperties}
		>
			<span className="sr-only">{text}</span>
			<span aria-hidden>
				{/* Spread rather than `split("")`: that cuts a surrogate pair in half
				    and renders two replacement glyphs. */}
				{[...text].map((char, i) => (
					<span key={`${i}-${char}`} className={i < typed ? "type-in" : "invisible"}>
						{char}
					</span>
				))}
			</span>
		</span>
	);
}
