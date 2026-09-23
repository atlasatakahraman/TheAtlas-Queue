// Chat command parser (spec § Flows → Join). Pure, so the webhook and any check can run it.

export type Commands = { join: string; leave: string; position: string; perk: string; away: string };
export type ChatCommand = { command: keyof Commands; riotId: string | null };

// Same rule as the players.riot_id check. The u flag makes {3,16} count code points, as
// Postgres counts characters, so "Şampiyon Ğ#TR1" and an emoji name agree on both sides.
const RIOT_ID = /^[^#]{3,16}#[A-Za-z0-9]{3,5}$/u;

// The first token must equal a configured command exactly. For the join command the rest of
// the message is the Riot ID (game names may hold spaces); an invalid one becomes null, and
// the RPC decides whether that is allowed.
export function parseCommand(content: string, commands: Commands): ChatCommand | null {
  if ([...content].length > 500) return null;
  const text = content.trim();
  const space = text.search(/\s/u);
  const first = space < 0 ? text : text.slice(0, space);
  const command = (Object.keys(commands) as (keyof Commands)[]).find((k) => commands[k] === first);
  if (!command) return null;
  if (command !== "join") return { command, riotId: null };
  const rest = space < 0 ? "" : text.slice(space).trim().replace(/\s+/gu, " ").normalize("NFC");
  return { command, riotId: RIOT_ID.test(rest) ? rest : null };
}
