// Highlights in running text read in Newsreader medium, in gold (owner, 2026-09-29; DESIGN.md
// § Wiki): the wiki's numbers, bold words and commands, and the numbers in Settings sentences.
// No hooks, so server and client pages both use it.
export const GOLD = "font-serif font-medium text-brand tabular-nums";

const NUMBER = /(×?\d+(?:[.,]\d+)?%?|%\d+)/;

export function Numerals({ text }: { text: string }) {
  const parts = text.split(NUMBER);
  if (parts.length === 1) return text;
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className={GOLD}>{p}</span> : p))}</>;
}
