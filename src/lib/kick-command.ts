// Chat command parser (spec § Flows → Join). Pure, so the webhook and any check can run it.

// Each command's words, the streamer's main word first, then up to 5 extras (0054).
export type Commands = { join: string[]; leave: string[]; position: string[]; perk: string[]; away: string[]; watch: string[]; rules: string[] };
export type ChatCommand = { command: keyof Commands; riotId: string | null };

// Same rule as the players.riot_id check. The u flag makes {3,16} count code points, as
// Postgres counts characters, so "Şampiyon Ğ#TR1" and an emoji name agree on both sides.
const RIOT_ID = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/u;

// Same map as private.fold_command (0054): case and Turkish letters are ignored, so !ÇIK = !cik.
const TR: Record<string, string> = { İ: "i", I: "i", ı: "i", Ç: "c", ç: "c", Ş: "s", ş: "s", Ğ: "g", ğ: "g", Ö: "o", ö: "o", Ü: "u", ü: "u" };
export const foldCommand = (w: string) => w.replace(/[İIıÇçŞşĞğÖöÜü]/gu, (c) => TR[c]).toLowerCase();

// The first token, folded, must equal one of a command's words. For the join command the rest of
// the message is the Riot ID (game names may hold spaces); an invalid one becomes null, and
// the RPC decides whether that is allowed.
export function parseCommand(content: string, commands: Commands): ChatCommand | null {
  if ([...content].length > 500) return null;
  const text = content.trim();
  const space = text.search(/\s/u);
  const first = foldCommand(space < 0 ? text : text.slice(0, space));
  // [..].flat(): a webhook_context from before 0054 sends plain strings; both shapes parse.
  const command = (Object.keys(commands) as (keyof Commands)[]).find((k) => [commands[k]].flat().some((w) => foldCommand(w) === first));
  if (!command) return null;
  if (command !== "join") return { command, riotId: null };
  const rest = space < 0 ? "" : text.slice(space).trim().replace(/\s+/gu, " ").normalize("NFC");
  return { command, riotId: RIOT_ID.test(rest) ? rest : null };
}
