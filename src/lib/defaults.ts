// The facts the help pages and Settings state (D33): a new channel's settings, the limits the
// database enforces, and how respect is counted. Written once, here; `scripts/defaults-assert.ts`
// turns this into the SQL assert that fails when the columns, their checks or private.respect
// say otherwise, so the help cannot drift from the database.
export const DEFAULTS = {
  commands: { join: "!sıra", leave: "!çık", position: "!sıram", perk: "!hak", away: "!afk" },
  // A command is ! and 1 to this many characters, no spaces.
  commandMax: 24,
  settings: {
    team_size: 5,
    riot_enabled: true,
    require_riot_id: false,
    riot_region: "tr1",
    fair_play: false,
    draw_reveal: "typewriter",
    clear_on_offline: true,
    after_game: "none",
    games_retention_days: 90,
    stream_locale: "en",
    watch_enabled: false,
    watch_sections: ["teams", "queue"],
    chat_replies: false,
    perk_enabled: false,
    perk_uses: 3,
    perk_window_days: 30,
    perk_badges: ["subscriber"],
    join_open: true,
    queue_max: 0,
    join_cooldown: 0,
    join_subs_only: false,
    join_badges: ["subscriber"],
  },
  limits: {
    team_size: [1, 5],
    games_retention_days: [1, 365],
    perk_uses: [1, 30],
    perk_window_days: [1, 90],
    queue_max: [0, 500],
    join_cooldown: [0, 20],
  },
  // Start at 100; each sanction takes its base, the Nth one times `repeat[N]` (the last repeats),
  // and an old one only a share of it (`decay`: [days, share], oldest band first).
  respect: {
    start: 100,
    warn: 10,
    punish: 20,
    ban: 50,
    repeat: [1, 1, 1.5, 2, 2.5],
    decay: [[30, 0.25], [14, 0.5], [7, 0.75]],
  },
} as const;
