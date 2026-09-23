import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The named sizes in globals.css (DESIGN.md § Type). Unregistered, tailwind-merge reads
// text-caption as a colour and drops it beside text-brand, or keeps text-base beside text-title.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "headline", "title", "team", "numeral", "name", "body", "control", "meta", "code", "caption", "overlay-name", "overlay-headline"] },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
