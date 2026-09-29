import { DEFAULTS as D } from "@/lib/defaults";
import type { Help } from "./index";

const c = D.commands;
const s = D.settings;
const L = D.limits;
const r = D.respect;
const k = D.retention;
const pct = (n: number) => `${n * 100}%`;

export const en: Help = {
  ui: {
    title: "Wiki",
    topics: "Topics",
    search: "Search the wiki",
    none: "No heading matches.",
    onThisPage: "On this page",
  },
  "getting-started": {
    title: "Getting started",
    description: "Run a Kick viewer queue: viewers join from chat, you draw fair teams, record who won, and everyone follows along.",
    lead: "TheAtlas Queue runs the viewer queue for your Kick stream. Viewers join from chat, you draw teams, you record who won, and your viewers can follow it all on a public page.",
    sections: [
      {
        id: "sign-in",
        title: "Sign in and set up",
        body: [
          "Sign in with Kick on the [home page](/). The first time, Welcome sets up your channel in three steps: it connects Queue to your chat, lets you choose how viewers join (the join command and whether a Riot ID is needed), and has you try it.",
          "Your dashboard lives at your channel's address, for example `/c/yourname`. Only you and your moderators can open it.",
        ],
      },
      {
        id: "first-stream",
        title: "Your first stream",
        body: [
          {
            list: [
              `Go live. Viewers type the join command in chat (\`${c.join}\` unless you change it) and appear in the queue.`,
              "Press **Draw teams** (or `D`) to fill both teams from the waiting players at random.",
              "Play. When a game ends, press **Victory** on the winning team's card.",
              "Draw again, reroll, or pick single players as you like. Every change has an Undo.",
            ],
          },
          "Share your [watch page](/wiki/watch) so viewers can follow the queue and the teams.",
        ],
      },
      {
        id: "moderators",
        title: "Moderators",
        body: [
          "Your Kick moderators get access on their own: the first chat message carrying the moderator badge lets them in, with their own Kick sign-in. You can also add someone ahead of time, or block anyone, in [Settings → Moderators](/wiki/settings#moderators).",
        ],
      },
    ],
  },
  "chat-commands": {
    title: "Chat commands",
    description: "The Kick chat commands viewers use to join, leave and check the queue, and how to change them.",
    lead: "Viewers use the queue from Kick chat. A command is the first word of a message; anything after the join command is read as a Riot ID.",
    sections: [
      {
        id: "join",
        title: "Join",
        body: [
          `\`${c.join}\` puts you at the end of the queue. \`${c.join} Name#TAG\` also gives your Riot ID, so the streamer sees your rank.`,
          "A join can be turned away: you are banned or punished, already in the queue, joining is closed, the stream is offline, the queue is full, you lack a badge the streamer asks for, you are sitting out after a game, or a Riot ID is required and you gave none. The streamer sees why in their feed.",
          "With chat replies on, Queue answers a join in chat with your place, and says so when you are banned or already in. While the stream is offline it says once that the queue opens when the stream goes live. Answers wait a few seconds and go out together, so many joins at once read as one line: *Joined the queue: @a #3, @b #4*. Other refusals stay in the streamer's feed, so chat is not flooded while joining is closed.",
        ],
      },
      { id: "leave", title: "Leave", body: [`\`${c.leave}\` takes you out of the queue.`] },
      {
        id: "position",
        title: "Position",
        body: [`\`${c.position}\` asks for your place among the waiting players. Queue answers in chat when the streamer has chat replies on.`],
      },
      {
        id: "away",
        title: "Away",
        body: [`\`${c.away}\` marks you away, and again marks you back. An away player keeps their place but is not drawn. It does nothing while you are in a game or punished.`],
      },
      {
        id: "perk",
        title: "Protected picks left",
        body: [`\`${c.perk}\` asks how many [protected picks](/wiki/perks) you have left, when the streamer has the perk on.`],
      },
      {
        id: "watch",
        title: "Watch page",
        body: [`\`${c.watch}\` answers in chat with a link to the channel's [watch page](/wiki/watch#watch-page), when the streamer has chat replies on and the watch page is public. It answers at most once every 30 seconds.`],
      },
      {
        id: "rules",
        title: "Rules",
        body: [`\`${c.rules}\` answers in chat with the streamer's rules, as they wrote them in [Settings → Commands](/wiki/settings#commands), when chat replies are on. With no rules written it stays silent. The rules also show on the channel's watch page. It answers at most once every 30 seconds.`],
      },
      {
        id: "list",
        title: "All commands",
        body: ["`!commands` or `!komutlar` lists the channel's commands in chat with a link to this page, when the streamer has chat replies and **Answer !komutlar** on. These two are the same on every channel and answer at most once every 30 seconds. If the channel's mod bot deletes links, the streamer allows TheAtlas in it."],
      },
      {
        id: "custom",
        title: "Changing the commands",
        body: [
          `The streamer sets their own in [Settings → Commands](/wiki/settings#commands). A command is \`!\` and 1 to ${D.commandMax} characters with no spaces, and all seven must differ. A channel's own commands are shown on its watch page.`,
        ],
      },
    ],
  },
  queue: {
    title: "Queue",
    description: "Filter, search, add and move players, and set who may join from chat: open or closed, a limit, subscribers only, sitting out.",
    lead: "The Queue tab lists everyone in the queue in join order, with a feed of what chat did on the right.",
    sections: [
      {
        id: "filters",
        title: "Filters and search",
        body: ["Filter by **All**, **Waiting**, **In game**, **Away** or **Punished**. The search box (`/`) finds a player by Kick name or Riot ID; Enter jumps to the first match."],
      },
      {
        id: "add",
        title: "Adding players",
        body: ["**Add player** adds anyone by Kick name, with a Riot ID if you have one. Adding by hand skips the joining rules below, so you can always let someone in."],
      },
      {
        id: "rows",
        title: "Moving players",
        body: ["Each row's buttons move the player into a team, mark them away or remove them; the `⋯` menu (or Enter on a focused row) has the rest. Drag a row to change the order or drop it on a team."],
      },
      {
        id: "joining",
        title: "Who may join from chat",
        body: [
          "These rules apply only to the chat join command, and are set in [Settings → Joining](/wiki/settings#joining).",
          {
            list: [
              "**Joining is open**: close it to turn every chat join away. The toolbar's Joining button does the same in one press, for you and your moderators.",
              `**Queue limit**: at most this many players who are not in a game, from 1 to ${L.queue_max[1]}. ${L.queue_max[0]} means no limit.`,
              `**Sit out after a game**: a player who just played waits this many recorded games before joining from chat again, up to ${L.join_cooldown[1]}. ${L.join_cooldown[0]} is off.`,
              "**Only while live**: on by default. While the stream is offline, chat joins are turned away until it goes live. You and your moderators can still join, and adding by hand always works. Kick reports a stream starting or ending on its own schedule, sometimes a few minutes late, so joining can open or close a little after the stream does. Turn the switch off if that gets in the way.",
              "**Subscribers only**: only viewers with a chosen badge can join. You and your moderators always pass.",
            ],
          },
        ],
      },
      {
        id: "undo",
        title: "Undo",
        body: ["Every change shows an Undo for a few seconds. Clearing the queue, the teams, sanctions or history asks first."],
      },
    ],
  },
  teams: {
    title: "Teams and draws",
    description: "Draw two fair teams from the queue, reroll, pick single players, and choose how a draw is revealed on stream.",
    lead: `Two teams of up to ${L.team_size[1]} (${s.team_size} unless you change the team size). The Teams tab shows them side by side with this stream's score.`,
    sections: [
      {
        id: "draw",
        title: "Drawing teams",
        body: [
          "**Draw teams** (`D`) fills both teams at random from the waiting players. **Reroll** draws again from the same players, keeping anyone protected. **Shuffle current teams** mixes the players already in teams.",
          "Draws avoid putting the same teammates together again, so the same four players drawn after a game are split differently.",
        ],
      },
      {
        id: "pick",
        title: "Picking players",
        body: ["**Pick** ×1, ×2, ×3 or ×5 takes that many players at random from its source: **Waiting**, **Teams** or **Whole queue**. Banned and punished players are left out, and a size the source cannot fill is hidden."],
      },
      {
        id: "fair-play",
        title: "Fair play",
        body: ["**Prioritise players who haven't played** draws players with no game yet first. They carry a *First game* tag."],
      },
      {
        id: "reveal",
        title: "The draw reveal",
        body: ["A team draw types its names into the teams. A pick plays the reveal chosen in [Settings → Teams & draws](/wiki/settings#teams): names type in, cards, a list, a wheel, or the result at once. The watch page and overlays show a fresh draw as it lands."],
      },
    ],
  },
  games: {
    title: "Games",
    description: "Record who won with Victory, follow this stream's score, and read each player's wins, losses and streaks.",
    lead: "A game is recorded when you press Victory on the winning team. Games feed the score, the stats and the wins leaderboards.",
    sections: [
      {
        id: "victory",
        title: "Victory",
        body: ["Press **Victory** on the winning team's card. **After Victory** in [Settings → Games](/wiki/settings#games) chooses what happens next: only record, shuffle, a new draw, everyone back to the queue, or the losers back. Undo takes back both."],
      },
      {
        id: "stats",
        title: "Score and stats",
        body: ["The Games tab lists each game (open one for its teams), and **Stats** counts each player's games, wins, losses, win rate and streak, for **This stream** or **All time**."],
      },
      {
        id: "retention",
        title: "How long games are kept",
        body: [`Games are kept for ${s.games_retention_days} days unless you choose between ${L.games_retention_days[0]} and ${L.games_retention_days[1]}. Older games and the records they made go. **Remove this game** has an Undo; **Clear games** asks first.`],
      },
    ],
  },
  moderation: {
    title: "Moderation and respect",
    description: "Warn, punish and ban viewers, how respect is counted, and how History records who did what.",
    lead: "The Management tab holds warnings, punishments and bans. Reasons stay on the dashboard; the watch page never shows them.",
    sections: [
      {
        id: "sanctions",
        title: "Warn, punish, ban",
        body: [
          {
            list: [
              "**Warn**: a note on the player, with a reason.",
              "**Punish**: for a number of games or a length of time. A punished player leaves their team or the waiting list for **Punished**, and returns to waiting when it ends.",
              "**Ban**: the player leaves the queue and cannot join until the ban ends or is lifted.",
            ],
          },
          "A sanction can be lifted early, lengthened, or turned from a warning into a punishment.",
        ],
      },
      {
        id: "respect",
        title: "Respect",
        body: [
          `Every viewer starts at ${r.start}. A warning takes ${r.warn}, a punishment ${r.punish} and a ban ${r.ban}. From the third sanction each counts ×${r.repeat[2]}, the fourth ×${r.repeat[3]}, and the fifth and later ×${r.repeat[4]}.`,
          `Old sanctions count less: after ${r.decay[2][0]} days ${pct(r.decay[2][1])}, after ${r.decay[1][0]} days ${pct(r.decay[1][1])}, after ${r.decay[0][0]} days ${pct(r.decay[0][1])}. A lifted warning stops counting; a lifted punishment or ban still counts. Deleting a sanction removes it entirely.`,
        ],
      },
      {
        id: "history",
        title: "History",
        body: [`The History tab lists every change: who did it, when, and to whom, filtered by Queue, Teams, Management or Chat and stream. It keeps ${k.historyDays} days. **Clear history** is the streamer's alone, and asks first.`],
      },
      {
        id: "moderators",
        title: "Moderators",
        body: [`A Kick moderator badge seen in chat gives dashboard access, and a message without it takes access away, as do ${k.badgeDays} days without seeing it. Moderators can do everything but Settings. Everything they do is signed with their name in History.`],
      },
    ],
  },
  perks: {
    title: "Perks and badges",
    description: "The subscriber perk protects drawn subscribers from a reroll, a set number of times, and which Kick badges qualify.",
    lead: "The subscriber perk rewards your supporters without hidden odds: everyone sees who is protected.",
    sections: [
      {
        id: "perk",
        title: "Protected picks",
        body: [
          `When a viewer with a qualifying badge is drawn, they are protected: a reroll keeps them in their team. Each gets ${s.perk_uses} protected picks every ${s.perk_window_days} days unless you change it (${L.perk_uses[0]} to ${L.perk_uses[1]} picks, every ${L.perk_window_days[0]} to ${L.perk_window_days[1]} days).`,
          `Viewers check what is left with \`${c.perk}\`. On the dashboard a protected player carries a *Protected* tag, and the row menu can remove it.`,
        ],
      },
      {
        id: "badges",
        title: "Badges",
        body: ["Choose which Kick badges qualify: subscriber, VIP, OG, founder or gifter. The same picker chooses who may join when joining is for subscribers only."],
      },
    ],
  },
  watch: {
    title: "Watch page and overlays",
    description: "Share a public watch page for viewers on their phones, and put the queue and teams on stream with OBS overlays.",
    lead: "Two ways to show the queue: a public page viewers open themselves, and overlays you add to OBS.",
    sections: [
      {
        id: "watch-page",
        title: "The watch page",
        body: [
          "Turn on the **Public watch page** in [Settings → Watch](/wiki/settings#watch) and share `/watch/yourname`. It shows your chat commands, then the sections you choose: **Teams**, **Queue**, **Games** and **Management** (names and kind only, never reasons), with Riot IDs only if you share them.",
          "It updates live and plays the draw reveal. It is off by default.",
        ],
      },
      {
        id: "overlays",
        title: "Overlays",
        body: [
          "An overlay is a browser source for OBS at 1920×1080. Make as many as you like in [Settings → Overlays](/wiki/settings#overlays), each with its own widgets (queue, teams, score, last result, most wins, most respected, the draw reveal), position, size, panels and language.",
          "Anyone with an overlay's link sees it, so keep it off stream. **New link** retires the old one at once.",
        ],
      },
    ],
  },
  settings: {
    title: "Settings",
    description: "What each Settings section does: commands, joining, Riot, teams and draws, games, perks, watch, overlays, moderators and labels.",
    lead: "Settings is the streamer's alone, opened from the gear in the top bar. Switches save at once; text and numbers wait for Save.",
    sections: [
      { id: "commands", title: "Commands", body: ["The seven chat commands and your rules. See [Chat commands](/wiki/chat-commands)."] },
      { id: "joining", title: "Joining", body: ["Open or closed, a queue limit, sitting out after a game, subscribers only. See [Who may join from chat](/wiki/queue#joining)."] },
      { id: "riot", title: "Riot", body: [`Look up solo queue ranks (region ${s.riot_region.toUpperCase()} unless you change it), and whether a join needs a Riot ID.`] },
      { id: "teams", title: "Teams & draws", body: [`Team size (${L.team_size[0]} to ${L.team_size[1]}), fair play, the draw reveal, and whether the queue clears when the stream ends. See [Teams and draws](/wiki/teams).`] },
      { id: "games", title: "Games", body: ["What Victory does next, and how long games are kept. See [Games](/wiki/games)."] },
      { id: "perks", title: "Perks", body: ["The subscriber perk and its badges. See [Perks and badges](/wiki/perks)."] },
      { id: "watch", title: "Watch page", body: ["The public page and its sections. See [The watch page](/wiki/watch#watch-page)."] },
      { id: "overlays", title: "Overlays", body: ["Your OBS overlays. See [Overlays](/wiki/watch#overlays)."] },
      { id: "moderators", title: "Moderators", body: ["Everyone with access and where it came from; add, block or remove. See [Moderators](/wiki/moderation#moderators)."] },
      { id: "labels", title: "Labels & language", body: ["Your own wording for team names and titles, in each language, and the stream language the overlay and chat replies use."] },
    ],
  },
  keyboard: {
    title: "Keyboard",
    description: "The dashboard's keyboard shortcuts: the command palette, drawing teams, switching tabs and moving through the queue.",
    lead: "A short set of keys that no browser shortcut uses. They work when no text box has focus.",
    sections: [
      {
        id: "global",
        title: "Anywhere on the dashboard",
        body: [
          {
            keys: [
              ["Ctrl K", "Open the command palette (⌘ K on a Mac)"],
              ["/", "Search the queue"],
              ["D", "Draw teams"],
              ["1 – 5", "Queue, Teams, Management, History, Games"],
              ["Esc", "Let go of the search box or the focused row"],
            ],
          },
        ],
      },
      {
        id: "rows",
        title: "On a queue row",
        body: [
          "Press Tab to reach the list, then:",
          { keys: [["↑ ↓", "Previous or next row"], ["Enter", "Open the row's menu"], ["Delete", "Remove from the queue (with Undo)"]] },
        ],
      },
      {
        id: "more",
        title: "Also",
        body: ["Enter saves any single field: Add player, a sanction, a Settings field. On a game's page, ← and → step through the games. The command palette and the row menu show each action's key."],
      },
    ],
  },
  privacy: {
    title: "Privacy",
    description: "What TheAtlas Queue stores about streamers and viewers, what the public pages show, and how long it is kept.",
    lead: "TheAtlas Queue keeps what it needs to run your queue, and no more. There are no ads and no analytics.",
    sections: [
      {
        id: "stored",
        title: "What is stored",
        body: [
          {
            list: [
              "**Streamers and moderators**: your Kick name, id and picture from signing in with Kick, and your channel's settings.",
              "**Viewers in a queue**: the Kick name and id from chat, the Riot ID they gave, their badges, and their rank looked up from Riot.",
              "**Moderation**: sanctions with their reasons, kept with the channel. Reasons are seen only on the dashboard.",
              "**Games**: who played and who won, and the records they make.",
              "**Chat replies**: when a streamer turns them on, Kick's permission to write in their chat, stored encrypted. Turning replies off revokes and deletes it.",
            ],
          },
        ],
      },
      {
        id: "public",
        title: "What is public",
        body: ["Only what the streamer turns on. The watch page and overlays show names, teams, scores and, if the streamer chooses, Riot IDs and ranks. Never Kick ids, reasons, or who did what."],
      },
      {
        id: "kept",
        title: "How long",
        body: [
          {
            list: [
              `History: ${k.historyDays} days. What an Undo needs: ${k.undoMinutes} minutes.`,
              `Games and records: ${s.games_retention_days} days, or what the streamer sets.`,
              `A looked-up rank: ${k.rankDays} days.`,
              `A moderator's access from a chat badge: ${k.badgeDays} days after the badge was last seen.`,
            ],
          },
        ],
      },
      {
        id: "delete",
        title: "Deleting your data",
        body: [
          "A streamer can delete their channel and everything in it from **Settings → Your data** with **Delete my data**: the queue, teams, games and records, moderation, overlays, history, settings and the chat replies permission, and Kick stops sending the channel's chat here. It asks for the channel's name typed again, and it cannot be undone. Signing in again starts a new, empty channel.",
        ],
      },
      {
        id: "browser",
        title: "In your browser",
        body: ["A sign-in cookie, and small cookies and local settings for your language, theme, last place and view choices. Riot IDs go to Riot only to look up ranks. Nothing is sold, and nothing goes to advertisers."],
      },
    ],
  },
};
