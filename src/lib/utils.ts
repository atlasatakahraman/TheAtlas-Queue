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

export const logger = {
  log: (...args: any[]) => {
    if (process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.DEBUG === "true") {
      console.log(...args);
    }
  },
  warn: (...args: any[]) => {
    if (process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.DEBUG === "true") {
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    if (process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.DEBUG === "true") {
      console.error(...args);
    }
  },
};

export function getGameTypeName(queueId?: number, gameMode?: string): string {
  const mode = gameMode?.toUpperCase() || "";

  // 1. Custom matches (queueId = 0 or missing sometimes but queueId is 0 or undefined for custom)
  if (queueId === 0) {
    switch (mode) {
      case "CHERRY":
        return "Özel Arena";
      case "URF":
        return "Özel URF";
      case "CLASSIC":
        return "Özel Maç";
      case "ARAM":
        return "Özel ARAM";
      case "MAYHEM":
        return "Özel Mayhem";
      case "NEXUSBLITZ":
        return "Özel Merkez Baskını";
      case "ONEFORALL":
        return "Özel Birimiz Hepimiz İçin";
      default:
        return mode ? `Özel ${mode}` : "Özel Maç";
    }
  }

  // 2. Standard Match Queue IDs
  switch (queueId) {
    case 400:
      return "Sıralı Seçim";
    case 420:
      return "Dereceli Tek/Çift";
    case 430:
      return "Normal Kapalı Seçim";
    case 440:
      return "Dereceli Esnek";
    case 450:
      return "ARAM";
    case 490:
      return "Hızlı Oyun";
    case 700:
      return "Clash";
    case 830:
    case 840:
    case 850:
      return "Yapay Zeka";
    case 900:
      return "URF";
    case 1020:
      return "Birimiz Hepimiz İçin";
    case 1300:
      return "Merkez Baskını";
    case 1700:
      return "Arena";
    case 1900:
      return "Rastgele URF";
    default:
      break;
  }

  // 3. Fallback based on gameMode only
  switch (mode) {
    case "CLASSIC":
      return "Normal Maç";
    case "CHERRY":
      return "Arena";
    case "URF":
      return "URF";
    case "ARAM":
      return "ARAM";
    case "MAYHEM":
      return "Mayhem";
    case "DOOMBOTSTEEMO":
      return "Doom Bots";
    default:
      return gameMode || "Bilinmeyen Mod";
  }
}

export function getGameTypeBadgeStyle(queueId?: number, gameMode?: string): string {
  const mode = gameMode?.toUpperCase() || "";
  const isCustom = queueId === 0;

  // Arena (Cherry) -> Orange (cl-punishment)
  if (mode === "CHERRY" || queueId === 1700) {
    return "bg-cl-punishment/15 text-cl-punishment";
  }
  // URF -> Pink
  if (mode === "URF" || queueId === 900 || queueId === 1900) {
    return "bg-pink-500/15 text-pink-700 dark:bg-pink-500/25 dark:text-pink-300";
  }
  // ARAM -> Teal
  if (mode === "ARAM" || queueId === 450) {
    return "bg-teal-500/15 text-teal-700 dark:bg-teal-500/25 dark:text-teal-300";
  }
  // Mayhem -> Orange
  if (mode === "MAYHEM") {
    return "bg-orange-500/15 text-orange-700 dark:bg-orange-500/25 dark:text-orange-300";
  }
  // Ranked -> Indigo
  if (queueId === 420 || queueId === 440) {
    return "bg-indigo-500/15 text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-300";
  }
  // Clash/Special -> Violet
  if (queueId === 700 || queueId === 1020 || queueId === 1300) {
    return "bg-violet-500/15 text-violet-700 dark:bg-violet-500/25 dark:text-violet-300";
  }
  // Custom -> Cyan
  if (isCustom) {
    return "bg-cyan-500/15 text-cyan-700 dark:bg-cyan-500/25 dark:text-cyan-300";
  }
  // Normal / Default Classic -> Slate
  return "bg-slate-500/15 text-slate-700 dark:bg-slate-500/25 dark:text-slate-300";
}
