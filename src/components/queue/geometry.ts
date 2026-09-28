// The shapes a page and its skeleton share (owner, 2026-09-28, Stage 10.10): every skeleton is
// built from these same classes, so at every width, container size and pointer it has the page's
// width, height and behaviour, as TheAtlas turborepo sizes its sidebar skeleton from
// --sidebar-width. A plain module on purpose: a "use client" module's exports reach a server
// component (loading.tsx) only as references, never as the strings.

// The top bar's ground and its content box; the tallest control in it sets the height (36px, 44px
// under 768px).
export const BAR = "border-b border-border bg-card";
export const BAR_IN = "mx-auto w-full max-w-[1440px] px-8 py-3 max-md:px-4";
export const BAR_CONTROL = "h-9 max-md:h-11";
// The page under it.
export const MAIN = "mx-auto flex w-full max-w-[1440px] flex-1 flex-col gap-6 px-8 pt-8 pb-4 max-md:px-4 max-md:pt-6 max-md:pb-28";
export const MASTHEAD = "flex flex-wrap items-center justify-between gap-x-6 gap-y-4";
export const TOOLBAR = "flex flex-wrap items-center gap-2";
// The tab bar: a muted track, 48px tabs.
export const TAB_TRACK = "relative h-auto! w-full gap-1.5 rounded-xl! bg-muted p-1.5 max-md:hidden dark:bg-card";
export const TAB = "h-12 flex-1 rounded-lg";

// A filter-pill track (FilterPills) and its pill.
export const PILL_TRACK = "rounded-lg bg-muted max-md:w-full dark:bg-card";
export const PILL = "flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-control max-md:h-11";
export const SEARCH = "h-9 w-64 pl-9 max-md:h-11 max-md:w-full";
export const GAMES_SEARCH = "h-9 w-56 pl-9 max-md:h-11 max-md:w-full";

// Queue: the list and, from 1024px, its 20rem side column.
export const QUEUE_GRID = "grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-6 max-lg:grid-cols-1";
// A row (queue, roster): 62px on one line; its buttons take a line of their own under 40rem of
// table or 24rem of roster.
export const ROW = "grid items-center gap-x-3 rounded-xl border border-l-[3px] border-row-edge px-4 py-3";
export const ROW_ROSTER = "grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] bg-background";
export const ROW_BUTTONS = {
  table: "flex items-center justify-end @max-[40rem]:col-span-full @max-[40rem]:mt-2",
  roster: "flex items-center justify-end @max-[24rem]:col-span-full @max-[24rem]:mt-2",
};
// A row button: 32px, 44px on touch; the row menu is 44px under 768px too.
export const ROW_BUTTON = "size-8 [@media(hover:none)]:size-11";
export const ROW_MENU = "size-8 max-md:size-11";
// The queue table's columns (August): #, player, Kick, rank, win rate, joined, actions. They follow
// the table's own width, not the window's (owner, 2026-09-28: at 1024 to 1279px the side column
// left the table 600px and the name column collapsed under the tags): [data-rows] is a size
// container. Under 40rem the row keeps #, player and actions; under 52rem win rate and joined
// go too. The actions
// column is a fixed width (three quick actions and the menu), so the header row, whose last cell
// is empty, lines up with the rows.
// The actions column holds its four 32px buttons with room to spare (8.5rem; at 6rem they ran
// 32px into Joined, owner 2026-09-28); the player column takes twice the Kick
// column, since its name shares the line with the respect score and tags (at 1280×720 the name
// had 53px of 175, owner 2026-09-27).
// With Riot IDs off (owner, 2026-09-27) the Kick, Rank and Win rate columns go: the name is the
// Kick name and there is no rank to show. Riot IDs without ranks keep Kick (2026-09-28).
const TABLE_COLS_PLAIN =
  "grid-cols-[2rem_minmax(0,1fr)_auto] @min-[40rem]:grid-cols-[2rem_minmax(0,1fr)_8.5rem] @min-[52rem]:grid-cols-[2rem_minmax(0,1fr)_5.5rem_8.5rem]";
const TABLE_COLS =
  "grid-cols-[2rem_minmax(0,1fr)_auto] @min-[40rem]:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_8.5rem_8.5rem] @min-[52rem]:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_8.5rem_5rem_5.5rem_8.5rem]";
const TABLE_COLS_IDS =
  "grid-cols-[2rem_minmax(0,1fr)_auto] @min-[40rem]:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_8.5rem] @min-[52rem]:grid-cols-[2rem_minmax(0,2fr)_minmax(0,1fr)_5.5rem_8.5rem]";
export const tableCols = (ids: boolean, ranks: boolean) => (ranks ? TABLE_COLS : ids ? TABLE_COLS_IDS : TABLE_COLS_PLAIN);
// The cells that leave under each width (the same thresholds as the columns above).
export const MID = "@max-[40rem]:hidden";
export const WIDE = "@max-[52rem]:hidden";
// The header over the table's rows, gone with the columns under 40rem.
export const TABLE_HEAD = "grid h-[1.375rem] items-center gap-x-3 border border-l-[3px] border-transparent px-4 @max-[40rem]:hidden";
// The columns the table has, remembered for the skeleton (the server has no settings yet).
export const COLS_COOKIE = "queue.cols";
export type Cols = "ranks" | "ids" | "plain";
export const COLS = ["ranks", "ids", "plain"] as const;
// How many of Pick's ×1 ×2 ×3 the toolbar shows (a ×n larger than the pool is hidden), likewise.
export const PICKS_COOKIE = "queue.picks";

// Teams: the cards side by side from 1024px; a card's header line; a slot; the actions bar.
export const TEAMS_GRID = "grid grid-cols-2 items-stretch gap-4 max-lg:grid-cols-1";
export const CARD_HEAD = "flex min-h-9 flex-wrap items-center justify-between gap-x-3 gap-y-2 text-meta text-muted-foreground max-md:min-h-11";
// Team 2's header mirrors Team 1's while the cards sit side by side, so the two face each other
// (owner, 2026-09-28); stacked, both keep one order so their edges line up.
export const MIRROR = "lg:flex-row-reverse";
export const SLOT = "min-h-[3.875rem]";
export const TEAMS_BAR = "flex flex-wrap items-center justify-between gap-4 rounded-xl bg-card p-4 max-md:flex-col max-md:items-stretch";
export const TEAMS_BAR_BUTTONS = "flex flex-wrap items-center gap-2 max-md:grid max-md:grid-cols-2";

// Management: a sanction row per kind.
export const MOD_ROW = "grid items-center gap-x-3 rounded-xl border border-row-edge bg-row px-4 py-3";
export const MOD_COLS = {
  warn: "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_4.5rem_8rem_2rem]",
  punish: "grid-cols-[minmax(0,1fr)_auto_auto] md:grid-cols-[minmax(0,1.3fr)_8rem_minmax(0,2fr)_4.5rem_8rem_2rem]",
  ban: "grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_4.5rem_8rem_2rem]",
};

// History: a card per day, a line per change.
export const DAY = "rounded-xl bg-card py-2";
export const DAY_HEAD = "h-8 px-4 pt-2 text-caption text-muted-foreground uppercase select-none";
export const LINE = "grid grid-cols-[4.25rem_1rem_minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2 text-body";

// Games: a game on one line, as tall as a queue row.
export const GAME_ROW = "h-[3.875rem]";

// A game's page: the line of links and buttons, the headline, the two cards and their rows.
export const GP_HEAD = "flex flex-wrap items-center justify-between gap-2";
export const GP_TITLE = "font-serif text-headline max-md:text-title";
export const GP_META = "flex flex-wrap gap-x-6 gap-y-1 text-meta text-muted-foreground tabular-nums";
export const GP_GRID = "grid grid-cols-2 items-start gap-4 max-lg:grid-cols-1";
export const GP_CARD_HEAD = "flex min-h-9 items-center gap-2 font-serif text-title";
export const GP_ROW = "grid min-h-[3.875rem] grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 rounded-xl border border-row-edge bg-background px-4 py-3";

// Home (signed out) and /welcome.
export const HOME = "mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-8 max-md:px-4";
export const HOME_MAIN = "flex flex-1 flex-col justify-center gap-8 py-16";
export const HOME_FOOTER = "flex items-center justify-between gap-4 border-t border-border py-4 text-meta text-muted-foreground";
export const WELCOME = "mx-auto flex w-full max-w-2xl flex-col gap-6 px-8 py-12 max-md:px-4 max-md:py-8";
export const STEP = "flex flex-col gap-4 rounded-xl bg-card p-6 max-md:p-4";
export const STEP_HEAD = "flex items-center gap-3 font-serif text-team";

// Settings: the section's title and hint beside its card of fields.
export const SECTION =
  "grid grid-cols-[16rem_minmax(0,1fr)] gap-6 border-t border-border py-8 first:border-t-0 first:pt-0 max-md:grid-cols-1 max-md:gap-4";
export const SECTION_CARD = "flex min-w-0 flex-col gap-5 rounded-xl bg-card p-6 max-md:p-4";

// A real control drawn as its own skeleton: the same component and text, so the same size, but
// shaded and inert.
export const SHADE = "pointer-events-none animate-pulse border-transparent bg-muted text-transparent shadow-none select-none [&_svg]:invisible";
