# TheAtlas Queue design system

The visual contract for every page **TheAtlas Queue** serves: the public home page, the
streamer dashboard, `/watch/<channel>`, `/overlay/<channel>` and first-run onboarding. Values
live in one file — [`src/app/globals.css`](../src/app/globals.css). This document says what
those values mean, when to reach for which, and what to build with them. **The CSS is the source
of truth for values; this file is the source of truth for decisions.**

It is a sibling of TheAtlas's `docs/DESIGN.md`, not a copy. It keeps that system's three faces,
its token-layer discipline, its `Typewriter` and its contrast gates, and swaps the palette: a
streaming tool that sits open beside a game for four hours needs warm, low-glare surfaces, and
team colours that are never confused with an error.

**Ink and paper.** Two themes, one toggle. **Mürekkep** (dark, the default) is a warm
near-black with cream text; **Kâğıt** (light) is warm newsprint with black ink. Gold is the only
brand accent. Teal and orange belong to the two teams and to nothing else. Red means *rejected,
banned, destructive* and nothing else.

**Every value is a gate, not a preference.** Each hex below was solved against the gates in
[Contrast](#contrast) on every surface it can land on. Changing one means re-running those
numbers. Newsreader ships at weight 400 with no bold cut, so a heading has no weight to fall
back on when contrast is thin.

- [Where the code is today](#where-the-code-is-today)
- [Name and identity](#name-and-identity)
- [The token layers](#the-token-layers)
- [Palette](#palette)
- [Semantics](#semantics)
- [Contrast](#contrast)
- [Text selection](#text-selection)
- [Type](#type)
- [Shape and space](#shape-and-space)
- [Surfaces and depth](#surfaces-and-depth)
- [Motion](#motion)
- [The draw reveal](#the-draw-reveal)
- [Focus and keyboard](#focus-and-keyboard)
- [Pages](#pages)
- [States](#states)
- [Recipes](#recipes)
- [Roles: streamer and moderators](#roles-streamer-and-moderators)
- [Mobile](#mobile)
- [Language and labels](#language-and-labels)
- [Metadata and SEO](#metadata-and-seo)
- [Icons](#icons)
- [Extending this](#extending-this)
- [Do and don't](#do-and-dont)
- [Checklist for a new screen](#checklist-for-a-new-screen)

---

## Where the code is today

Measured against the working tree on 2026-09-23. Anything in the *Today* column that this file
contradicts is migration work, not an alternative.

| Area | Today | This system |
|---|---|---|
| shadcn style | `radix-nova`, `baseColor: neutral`, primitives from `radix-ui` | **Unchanged.** Same style, same primitives, same `components.json` |
| Icons | `lucide-react` | **Unchanged** |
| Theme switch | `next-themes`, `attribute="class"`, `defaultTheme="dark"`, `enableSystem` | **Unchanged.** `.dark` = Mürekkep, `:root` = Kâğıt |
| Fonts | Anthropic Sans / Serif / Mono in `src/app/fonts/` (not licensable, see [Type](#type)) | Newsreader / Hanken Grotesk / JetBrains Mono, OFL 1.1, same `next/font/local` pattern |
| Font variables | `--font-anthropic-{sans,serif,mono}` → `--font-sans/serif/mono/heading` | `--font-{hanken,newsreader,jetbrains}` → the **same** four `--font-*` theme names |
| Semantic colours | shadcn set (`--background` … `--ring`, `--chart-*`, `--sidebar-*`) on `neutral` | **Same names**, new values (below), plus `--row`, `--row-edge`, `--highlight`, `--brand`, `--destructive-fill`, `--selection` |
| Team colours | `--team-blue`, `--team-red` | **`--team-1`, `--team-2`** (teal, orange). The old names are deleted, not aliased |
| Moderation colours | `--cl-warning`, `--cl-punishment`, `--cl-banned` | `--warning`, `--destructive`, `--destructive-fill`. The `--cl-*` names are deleted |
| Rank colours | `--color-rank-*` (oklch) | **Kept**, the 3px tier mark only, never text (they fail on Kâğıt) |
| Radius | `--radius: 0.625rem` with shadcn's multipliers | **Unchanged** |
| Type sizes | arbitrary `text-[…]` values in components | Named sizes in `@theme` (`text-display`, `text-meta` …), see [Type](#type) |
| Animation | `tw-animate-css`, `--animate-slide-up/fade-in/scale-in` | `tw-animate-css` stays. The three custom animations give way to `--animate-enter` and TheAtlas's `Typewriter` |
| Draw animation | `pickAnimationStyle`: `classic` / `list` / `spin` / `none`, `single-pick-dialog.tsx` | Setting `draw_reveal`: `typewriter` \| `cards` \| `list` \| `wheel` \| `none` (D22, D13 amended). The team draw always lands by Typewriter; a pick plays the chosen one ([The draw reveal](#the-draw-reveal)) |
| Easter eggs | `use-easter-eggs.ts` (Konami → `confetti-overlay`, "badapple" → `bad-apple-overlay`) | **Deleted**, all three files |
| Tabs | `sliding-tabs.tsx` (custom, in `ui/`) + shadcn `tabs` | shadcn `tabs` only. `sliding-tabs` is deleted |
| Selection styling | none | Every text role declares its pair ([Text selection](#text-selection)) |
| UI language | Turkish strings inline in components | `en` (default) + `tr`, every string a label key ([Language and labels](#language-and-labels)) |
| Site name | `metadata.title` "TheAtlas — Queue", editable `pageTitle` setting | **"TheAtlas Queue"**, fixed. `pageTitle` is deleted ([Name and identity](#name-and-identity)) |
| Metadata | title, description in Turkish about ARAM, `keywords` | Full Next.js metadata per route ([Metadata and SEO](#metadata-and-seo)). `keywords` is deleted: Google ignores it |
| Signed-out `/` | redirects to `/login` | **The public home page**, which is also the sign-in page |

---

## Name and identity

**The product is "TheAtlas Queue".** Exactly that: one space, capital T-A-Q, no dash, no
"TheAtlas — Queue", no "Atlas Queue". It is **never translated and never a label** — a Turkish
page still says TheAtlas Queue.

| Where | What it says |
|---|---|
| Browser tab / search result title | `{page} · TheAtlas Queue`, or just `TheAtlas Queue` on the home page |
| Dashboard and `/watch` masthead | The streamer's **channel name** from Kick (not editable) + the gold italic word ***Queue*** |
| Home page | The wordmark "TheAtlas *Queue*" |
| Open Graph `siteName`, JSON-LD `name`, web manifest `name` | `TheAtlas Queue` |
| Web manifest `short_name` | `Queue` |

The channel name comes from the streamer's Kick profile. A streamer cannot rename their page;
they can set an optional subtitle under it (`brand.subtitle`, a label).

---

## The token layers

Two layers, both in `globals.css`.

**The palette** is mode-independent: `--ink-*`, `--paper-*`, `--gold`, `--teal`, `--orange` and
friends are literal hex and never change. **The semantics** (`--background`, `--foreground`,
`--primary`, `--card`, `--border`, `--team-1` …) point at palette entries, and *that* mapping is
what `:root` (Kâğıt) and `.dark` (Mürekkep) swap.

Consequence: **write `bg-background`, not `bg-[#131210]`, and not `bg-ink-floor`.** The semantic
token is the one that knows about the theme.

A new semantic token needs **three** edits: the `:root` mapping, the `.dark` mapping, and the
`@theme inline` line that turns it into a utility. Skipping the third produces a variable that
exists and a `bg-*` class that does not — no error, no style.

---

## Palette

### Mürekkep — dark

| Token | Hex | Role |
|---|---|---|
| `--ink-floor` | `#131210` | Page floor |
| `--ink-card` | `#1c1a17` | Cards, popovers, dialogs |
| `--ink-row` | `#272520` | A row on the floor |
| `--ink-hover` | `#302d27` | Hover and selected fill |
| `--ink-highlight` | `#322b1d` | A row that just arrived (gold-tinted) |
| `--ink-hairline` | `#34312a` | Decorative rules |
| `--ink-row-edge` | `#47433a` | A row's outline, 1.9:1 on the floor |
| `--ink-outline` | `#807866` | **Control** outlines, 3.13:1 worst case |
| `--ink-muted` | `#a39c8b` | Secondary text, 5.02:1 worst case |
| `--ink-text` | `#efe9dc` | Body text, 11.34:1 worst case |

### Kâğıt — light

| Token | Hex | Role |
|---|---|---|
| `--paper-floor` | `#f4f0e6` | Page floor |
| `--paper-card` | `#fffdf8` | Cards, popovers, dialogs, **and rows on the floor** |
| `--paper-hover` | `#efe8d8` | Hover and selected fill |
| `--paper-highlight` | `#f6e9c4` | A row that just arrived (gold-tinted) |
| `--paper-hairline` | `#e2dccd` | Decorative rules |
| `--paper-row-edge` | `#d2c7b0` | A row's outline, 1.47:1 on the floor |
| `--paper-outline` | `#857c66` | **Control** outlines, 3.39:1 worst case |
| `--paper-muted` | `#655f51` | Secondary text, 5.20:1 worst case |
| `--paper-text` | `#1c1a16` | Body text, 14.23:1 worst case |

### Accent, teams, status

Each ships two steps. **The light step is not a shade, it is the other theme's value.** One
hex cannot serve both grounds: teal `#6cc3b6` is 9.0:1 on ink and 2.0:1 on paper.

| Token | Mürekkep | Kâğıt | Use |
|---|---|---|---|
| `--gold` | `#e9c46a` | `#7f5c0c` | Brand accent, focus ring, text selection, subscriber tag, warnings |
| `--teal` | `#6cc3b6` | `#1d6f78` | **Team 1, only** |
| `--orange` | `#f0a35e` | `#9a4a16` | **Team 2, only** |
| `--red` | `#e27a70` | `#b3261e` | Rejected, banned, destructive text and outlines |
| `--red-fill` | `#b3413a` | `#b3261e` | Solid destructive fill (5.6:1 / 6.4:1 with white on it) |
| `--green` | `#9cc98a` | `#386e2e` | Live, accepted, success; the sub gifter badge |
| `--pink` | `#ec94c4` | `#a2336c` | **The VIP badge glyph, only** (D32) |
| `--blue` | `#93aef2` | `#3a56a8` | **The OG badge glyph, only** |
| `--purple` | `#bba2f2` | `#6b45b8` | **The founder badge glyph, only** |

**Team colours are fixed, team names are not.** A streamer renames "Team 1" to "Kurtlar" in
Settings; they cannot recolour it. Teal and orange were picked because they stay distinct under
the three common colour-vision deficiencies. **Red is never a team colour**: the same screen uses
red for "`!sıra` rejected: banned", and a red team would read as a failed team.

---

## Semantics

`.dark` is Mürekkep, `:root` is Kâğıt.

| Semantic token | Mürekkep | Kâğıt | Meaning |
|---|---|---|---|
| `--background` | ink-floor | paper-floor | The page, and rows inside a card |
| `--foreground` | ink-text | paper-text | Body text |
| `--card` / `--popover` | ink-card | paper-card | Raised surfaces |
| `--card-foreground` / `--popover-foreground` | ink-text | paper-text | |
| `--row` | ink-row | paper-card | A row on the floor |
| `--row-edge` | ink-row-edge | paper-row-edge | Every row's outline |
| `--highlight` | ink-highlight | paper-highlight | A just-arrived row, for 1.5s |
| `--muted` | ink-card | paper-hover | Quiet fills: filter track, skeleton bars |
| `--muted-foreground` | ink-muted | paper-muted | Secondary text |
| `--accent` | ink-hover | paper-hover | Hover and selected rows |
| `--accent-foreground` | ink-text | paper-text | |
| `--primary` | ink-text | paper-text | **The one primary button per view** (cream on ink, ink on paper) |
| `--primary-foreground` | ink-floor | paper-card | |
| `--secondary` | ink-card | paper-card | Outline-style buttons |
| `--secondary-foreground` | ink-text | paper-text | |
| `--border` | ink-hairline | paper-hairline | Decorative rules only |
| `--input` | ink-outline | paper-outline | Control outlines (≥3:1) |
| `--ring` | gold | gold | Focus |
| `--brand` | gold | gold | The *Queue* wordmark, the subscriber tag |
| `--destructive` | red | red | Text and outlines |
| `--destructive-fill` | red-fill | red-fill | Solid fills |
| `--success` | green | green | Live, accepted |
| `--warning` | gold | gold | Moderation warning, degraded connection |
| `--team-1` | teal | teal | Team 1 |
| `--team-2` | orange | orange | Team 2 |
| `--badge-vip` / `-og` / `-founder` | pink / blue / purple | same, light steps | Kick badge glyphs (badge picker, player card); subscriber is `--brand`, sub gifter `--success` |
| `--selection` / `--selection-foreground` | gold / ink-floor | gold / paper-card | Default text selection |
| `--chart-1…5` | teal, orange, gold, green, ink-muted | same, light steps | `/watch` stats only |

`--sidebar-*` stays defined because shadcn's generated files reference it; Queue has no sidebar
and nothing new should use it.

**Gold does four jobs** (brand, warning, focus, selection), and warning shares it with the
subscriber tag. That is deliberate: every free amber sits too close to team 2's orange, and none
of the four is ever the only signal. The subscriber tag carries 🛡 and a word, a warning carries
a triangle and a word, focus is a ring, selection is a selection.

---

## Contrast

**The gates.** Body text ≥ 7:1. Secondary text ≥ 4.6:1. Accent, team and status text ≥ 4.5:1.
Control outlines and the focus ring ≥ 3:1. "Worst case" is the lowest ratio across every surface
the colour can sit on: floor, card, row, hover and highlight.

| | Mürekkep worst | Kâğıt worst |
|---|---|---|
| Body text | 11.34 | 14.23 |
| Secondary text | 5.02 | 5.20 |
| Gold | 7.59 | 5.00 |
| Team 1 | 6.61 | 4.78 |
| Team 2 | 6.60 | 5.11 |
| Red | 4.74 | 5.36 |
| Green | 6.72 | 5.00 |
| `--input` outline | 3.13 | 3.39 |
| Focus ring | 7.59 | 5.00 |
| Primary button (label on fill) | 15.48 | 15.27 |
| White on `--destructive-fill` | 5.62 | 6.54 |
| VIP / OG / founder glyphs | 6.27 / 6.26 / 6.25 | 5.33 / 5.59 / 5.43 |

**Buttons, measured (D21, 2026-09-27).** Every variant on every surface it can land on; the tint
of a fill is composited over that surface first. Disabled buttons (50 % opacity) are exempt, as
WCAG exempts them.

| Variant | Pair | Mürekkep worst | Kâğıt worst |
|---|---|---|---|
| default | label on fill, rest / hover (85 %) | 15.48 / 11.33 | 15.27 |
| outline | label on `input/30`, hover `input/50` | 8.02 / 6.33 | 14.23 |
| outline | edge (`--row-edge`, owner 2026-09-27; the label identifies the button, so 1.4.11 asks nothing of it) | 1.9 | 1.47 |
| ghost | label, rest / hover | 11.34 / 11.34 | 14.23 |
| ghost, muted label | label on hover | 5.02 | 5.20 |
| destructive | **foreground** label on red `/20`, hover `/30` | 8.36 / 7.09 | 12.23 / 10.38 |
| destructive | edge (solid `--destructive`), icon | 4.74 | 5.36 |
| focus | gold edge / gold halo at 50 % | 8.21 / 3.24 | 5.00 / — |

Stock shadcn failed two: the destructive label in red on its own tint (3.49, hover 2.96) and the
destructive focus halo at 40 % red (1.90). Its outline edge was the hairline; outline buttons now
take the rows' edge, so they sit with the rows instead of outshouting them, while fields,
selects and switches keep `--input` at 3:1. The fixes live in
`globals.css` (see [Extending this](#extending-this)), not in `ui/button.tsx`.

**The overlay** sits on unknown video. Its panels are `--ink-floor` at 88% opacity, always
Mürekkep. Measured over pure white, mid-grey and black footage: body 11.2 / 13.6 / 15.7,
secondary 4.96 / 6.03 / 6.96, teams ≥ 6.52, gold ≥ 8.11.

**Rows are separated by their edge, not by their fill.** Row fill against its ground is 1.08 to
1.22, deliberately low. The `--row-edge` outline plus the 6px gap between rows is what makes
each row read as its own object. Don't judge two adjacent surfaces by contrast ratio.

**Checking a new pair:** WCAG relative luminance, the same formula TheAtlas uses. Add the result
to this table in the same commit as the hex.

---

## Text selection

**Every piece of text declares what it looks like selected.** The browser default (system blue)
clashes with both themes and disappears on a team-coloured name.

1. **Content text is selectable and has a pair.** `<body>` carries the default pair, so anything
   that does not override it is already correct. Tailwind's `selection:` variant applies to the
   element *and its descendants*, so one class on a container covers everything inside it.
2. **Chrome is not selectable.** Buttons, tabs, filters, tags, menu rows, the Live icon and icons
   are `select-none`. Dragging across a row selects the player's name, not the row's buttons.

| Text role | Classes | Pair (Mürekkep / Kâğıt) |
|---|---|---|
| Default: body, names, descriptions, feed | on `<body>`: `selection:bg-selection selection:text-selection-foreground` | 11.2 / 6.0 |
| Team 1 name, headline and roster | `selection:bg-team-1 selection:text-background` | 9.0 / 5.7 |
| Team 2 name, headline and roster | `selection:bg-team-2 selection:text-background` | 9.0 / 6.1 |
| Rejections, bans, destructive text | `selection:bg-destructive selection:text-background` | 6.5 / 6.4 |
| Riot ID in the player card | default pair + **`select-all`**: one click selects the whole ID | 11.2 / 6.0 |
| Chat command in the feed (`!sıra …`) | default pair + `select-all` | 11.2 / 6.0 |
| Text inputs | default pair (inherited from `<body>`) | 11.2 / 6.0 |
| Buttons, tabs, tags, menus | `select-none` | — |
| `/overlay` | `select-none` on the root: nothing there is ever selected | — |

`select-all` goes only where the whole string is the useful unit to copy: an ID, a command.
Never on prose.

---

## Type

Three OFL 1.1 faces, the same three TheAtlas ships, each doing one job.

| Face | Variable | Job |
|---|---|---|
| **Newsreader** (`opsz 6–72`, wght 400) | `--font-serif`, `--font-heading` | Channel name, wordmark, page titles, the match headline, team names, queue numbers, stat numbers |
| **Hanken Grotesk** (`wght 100–900`) | `--font-sans` | Everything else: body, player names, controls, labels |
| **JetBrains Mono** (`wght 100–800`) | `--font-mono` | **Only text that was literally typed**: a Riot ID, a chat command, a label key |

The files live in `src/app/fonts/` with each family's `OFL.txt` beside them, subset to Latin +
Latin-Extended (covers `ğĞıİşŞçÇöÖüÜ`), loaded through `next/font/local` so they are
self-hosted, preloaded, and get a size-adjusted fallback that stops layout shift. **Never** load
them from Google Fonts at runtime: that is a third-party request on every page view.

The Anthropic faces currently in `src/app/fonts/` are a bespoke commission and cannot be
licensed at any price. They are deleted, not kept as a fallback.

### The scale

Queue is a web page read at arm's length beside a game, so it runs one step **larger** than
TheAtlas's desktop panels: 15px body, not 14px. **Every size is a named `@theme` token**
(`--text-meta: 0.84375rem` plus its `--text-meta--line-height`), so components write
`text-meta`, never `text-[0.84375rem]`. None of these names may collide with a colour token.

| Role | Utility | Size / line | Weight | Tracking | Face |
|---|---|---|---|---|---|
| Channel name | `text-display` | 36 / 1.05 | 400 | -0.02em | Serif |
| Match headline | `text-headline` | 44 / 1.05 | 400 | -0.02em | Serif |
| Page title | `text-title` | 28 / 1.15 | 400 | -0.01em | Serif |
| Team name | `text-team` | 22 / 1.2 | 400 | 0 | Serif |
| Queue number | `text-numeral` | 20 / 1 | 400 | 0, `tabular-nums` | Serif |
| Player name | `text-name` | 16 / 1.35 | 600 | 0 | Sans |
| Body | `text-body` | 15 / 1.5 | 400 | 0 | Sans |
| Control | `text-control` | 14 / 1.3 | 500–600 | 0 | Sans |
| Secondary / meta | `text-meta` | 13.5 / 1.45 | 400 | 0 | Sans |
| Riot ID, command | `text-code` | 13 / 1.4 | 400–500 | 0 | Mono |
| Caption / section label | `text-caption` | 12 / 1.3 | 600 | 0.12em, uppercase | Sans |
| Overlay name | `text-overlay-name` | 32 / 1.2 | 600 | 0 | Sans |
| Overlay headline | `text-overlay-headline` | 56 / 1.05 | 400 | -0.02em | Serif |

**Never bold a serif heading.** Newsreader has no bold cut; the browser fakes one, badly. Size
up instead. **Never set a heading in the sans face**, and never set a name in mono.

---

## Shape and space

**Radius.** shadcn's multipliers on `--radius: 0.625rem`, unchanged.

| Token | Value | Use |
|---|---|---|
| `rounded-md` | 8px | Small icon buttons, skeleton bars |
| `rounded-lg` | 10px | Buttons, inputs, menu rows, filter pills |
| `rounded-xl` | 14px | **Rows**, cards, popovers, the player card, overlay panels |
| `rounded-2xl` | 18px | Dialogs |
| `rounded-full` | — | Avatars, the switch thumb |

**Spacing.** Tailwind's 4px scale.

| Context | Value |
|---|---|
| Page gutter | `px-8` desktop, `px-4` under 768px |
| Between masthead, tabs and content | `gap-6` |
| **Between two rows** | **`gap-1.5` (6px)**: every list of rows, queue, rosters, moderation, labels |
| Row padding | `px-4 py-3` |
| Card | `p-4` dense, `p-6` default |
| Dialog | `p-6` |
| Menu content | `p-1.5`, rows `px-2.5 py-2` |
| Overlay safe margin | 48px from every canvas edge |

**Control heights**: 36px default, 32px small, 40px large; **44px on touch** ([Mobile](#mobile)).
24px is the floor for anything clickable. One height per cluster.

---

## Surfaces and depth

**Colour-block first, shadow rare.** Depth comes from ground-versus-surface contrast and one
outline. Shadows exist for things that float above the page (player card, menu, dialog, toast)
and nothing else.

```
floor      background   the page
raised     card         panels, the chat feed, team cards, popovers, dialogs
row        row          one player on the floor, always with row-edge
inset      background   a row inside a card (team roster, a dialog's list), always with row-edge
hover      accent       hover and selected rows, the active filter
arrival    highlight    a row that just arrived, for 1.5s
```

**A row always carries `border border-row-edge`.** A row on the floor is `bg-row`; a row inside a
card goes back to `bg-background`, which is TheAtlas's own rule: a panel inside a panel returns
to the floor. Never `bg-card` inside `bg-card`.

**State is marked by kind, not by a slightly different fill.** A row's left edge is 3px:
`border-l-team-1` when the player is in a game, dashed when away, `row-edge` when waiting. The
state is also written as a tag, because colour is never the only signal.

---

## Motion

Four durations, the same four as TheAtlas. The draw reveal's per-name cadence is the one
justified exception and is documented in [The draw reveal](#the-draw-reveal).

| Duration | Easing | Use |
|---|---|---|
| 100ms | default | Menu, popover and hover-card open/close |
| 150ms | `ease-out` | Hover and colour transitions, a realtime row fading in |
| 200ms | `ease-out` | Layout: a dialog or sheet appearing, a row being removed; `Typewriter`'s per-character reveal |
| 500ms | `cubic-bezier(.2,.7,.2,1)` | **Entrance** (`--animate-enter`), once per page load |

**Preferences, per browser** (owner, 2026-09-27; the account menu and the palette's
Preferences): **Animations**, on by default. Off, every animation and transition jumps to its
end (`html[data-motion="off"]`), `Typewriter` lines appear whole (`Typed`), the draw reveal
lands at once and in-page jumps are instant. Under the system's reduced motion it is off and
locked, and says why. **Notifications**, on by default. Off, success and info toasts stay
hidden, their Undo with them; an error still shows. Both live in `localStorage`
(`pref.motion`, `pref.toasts`) and a script in `<head>` applies them before the first paint.

### The entrance

The first mount of a page is choreographed, the way a scroll-crafted page reveals itself. After
that, nothing moves unless the data did.

1. **The top bar's line types itself**, left to right, with `Typewriter`, the component
   TheAtlas's dashboard greeting uses: each character lands out of a `0.12em` blur, 40ms apart,
   each taking 200ms to sharpen, so a short trailing edge is always still resolving. Untyped
   characters are `invisible`, not absent, so the line holds its final width from the first
   frame and nothing beside it moves. *TheAtlas*, then the gold italic *Queue* one 40ms beat
   later for the space, then the `/`, then **the channel name** (owner, 2026-09-27): each a
   `Typewriter` whose `startDelay` is the characters before it, plus one beat per space, times
   40ms. On phones, where only the channel shows, it types from 0.
2. The header tools, the tabs, then the page heading rise 10px into place
   (`--animate-enter`), starting at 70ms and 45ms apart.
3. Rows rise the same way, 45ms apart, **capped at the first 12**. Row 13 onwards is simply
   there, so a 60-player queue does not take three seconds to settle.

`Typewriter` is ported **verbatim** from TheAtlas `packages/@ui/src/components/typewriter.tsx`
into `src/components/typewriter.tsx`, with its `.type-in` rule and `theatlas-type-in` keyframe
copied from `theme.css` into `globals.css`. Queue is not in the turborepo, so it cannot import
the package; when it joins, the copy is deleted and the import takes its place. **Do not diverge
the copy.** Fix it upstream and re-copy.

Its contract, which the port keeps:

- It **retypes whenever `text` changes**. Do not feed it a value that changes on every render.
- The characters are `aria-hidden`; the real string is read once from an `sr-only` span.
- Under reduced motion it shows the finished line at once, and `.type-in` is also switched off in
  CSS as a second guard.
- **The typed element gets no `--animate-enter`.** The typing *is* its entrance; adding the rise
  on top nests two animations, which compound.

Rules:

- **Once per load.** Switching tabs, filtering, or a realtime update never replays it.
- **`Typewriter` has exactly two jobs:** the line that introduces a page (the channel name, the
  home wordmark) and [the draw reveal](#the-draw-reveal). Never rows, buttons or toasts.
- **A realtime arrival is not an entrance.** A new `!sıra` row fades in over 150ms and holds
  `bg-highlight` for 1.5s, then settles to `bg-row`. No slide: the list must not jump under the
  streamer's cursor.
- **`prefers-reduced-motion: reduce` removes all of it.** Everything is simply present. The 1.5s
  highlight stays, because it is information, not decoration.

---

## The draw reveal

The draw is the moment the stream is waiting for. A **team draw** always lands by Typewriter
(below). A **pick** plays the streamer's choice (D22, owner 2026-09-27, D13 amended): August's
three reveals are back beside Typewriter, rebuilt in this system's tokens.

**The result exists before the animation starts.** The draw is computed and saved on the server
first; the reveal only *shows* a finished result. A reload mid-reveal shows the final teams, and
the reveal can never disagree with what `/watch` and `/overlay` show.

**Team draw** (`D`, or the Draw teams button):

1. The Teams tab activates if it is not already open. The headline ("{team 1} vs {team 2}")
   stays put.
2. Both rosters clear. Names land **alternately**, team 1 then team 2, one every **160ms**.
   Protected subscribers land first, with their 🛡, because they were never in doubt.
3. Each name types in with `Typewriter` at `speed={30}`, `reveal={200}`. Ten names finish in
   about two seconds.
4. The average rank under each team name updates when its last name has landed.

160ms and 30ms sit off the motion ladder on purpose: the ladder's rungs describe a single
transition, and this is a sequence of ten. Faster reads as a flash, slower drags on stream.

**Pick** (the toolbar, the Teams tab, the page menu or the palette): a `Dialog` titled with the
`action.pick` label. With *Names type in* the N picked names land at the team draw's cadence.
With **Cards**, **List** or **Wheel** the reveal plays once per picked name, in order, above the
names picked so far; each name joins the list when its reveal stops:

```
Cards                       List                         Wheel
┌──────────────────┐        ┌──────────────────────┐     ╱ mert │ efe ╲
│ [icon]  kaanxd   │        │ [icon] selin  Plat I │    ada ─── ┼ ── deniz ◀
│         #TR2     │        ├══════════════════════┤     ╲ can  │ atlas╱
│      Gold I      │        │ [icon] efe    Gold I │  ← stops here
└──────────────────┘        ├══════════════════════┤
 names flick past,          │ [icon] mert   Iron II│
 slowing, then stop         └──────────────────────┘
```

- **Cards** (*Kartlar*, August's classic): one card (avatar, name, rank) flicks through the pick
  pool, slowing: 14 steps, the gap growing from 50 to 232ms (about 2.1 s), then stops on the
  picked name and its edge turns gold.
- **List** (*Listeleme*): a strip of rows, one row high window with a gold frame, scrolls by and
  eases out (cubic, 2.8 s) onto the picked name.
- **Wheel** (*Çarkıfelek*): the pool as wedges, alternating `--row` and `--muted`, names in
  `--foreground` along the radius, the pointer a gold triangle on the right edge. It turns 8 to
  11 times and eases out (a 7th-power curve, 6 s) with the picked wedge under the pointer, which
  then fills gold. A picked name leaves the wheel before the next spin. No hub: the wedges meet
  in the middle (no dots, owner rule).
- The pool is the pick's source as it was (`pick_players`' pool: the source's statuses, less
  anyone banned or punished); the server's result decides where every reveal stops.
- **Enter** or **Space** while a reveal plays skips to the result (August). When it has
  finished, focus sits on **Pick again** (`RotateCcw`, outline), so Enter or Space picks again
  with the same size and source. The dialog closes on Escape or a click outside.
Each name carries its moves (owner, 2026-09-27): *Move to Team 1 / 2*, *Back to waiting*, *Remove
from queue*, disabled (never hidden) when they cannot happen, and the name shows its new state; two
or more names add **All to Team 1 / 2**, one write (`move_players`) and one Undo, disabled when
the team lacks room for all of them. A pick moves nobody, so its toast offers Undo only when it
used a protection, which Undo gives back.

**Everywhere at once.** `/watch` and `/overlay` play the same reveal when a new draw arrives.
Each device plays a given draw **once**; a viewer who opens `/watch` afterwards sees the result
already set.

**`draw_reveal: "none"`**, Animations off and reduced motion show the result instantly. No
confetti, no sound.

---

## Focus and keyboard

- **Focus is gold, in both themes**, via `--ring`: `focus-visible:ring-2 focus-visible:ring-ring/40`
  plus `focus-visible:border-ring`, which `buttonVariants` already encodes. Do not restyle it per
  component.
- **`focus-visible`, never `focus`.** A mouse click does not paint a ring.
- Icon-only controls carry `aria-label`. Invalid controls use `aria-invalid`.
- **Shortcut hints never appear on the page.** The shortcuts work everywhere, but their hints
  appear in exactly two places, both of them menus: the **right-click menu**
  (`ContextMenuShortcut`) and the **command palette** (`CommandShortcut`), each key drawn with
  shadcn's `Kbd` inside that slot (the page menu and the toolbar's Shuffle menu follow the same
  rule). No kbd chips in toolbars, buttons, headings, tooltips or
  empty states.

**A narrow set (D18).** Nothing here collides with a browser shortcut: reload, print, back, find
and the scroll keys stay the browser's. The page scrolls natively.

**Global keys** fire only when no text input has focus and no row has keyboard focus.

| Key | Does |
|---|---|
| `Ctrl/⌘ K` | Open the command palette |
| `/` | Focus the queue search |
| `D` | Draw teams |
| `1`–`4` | Queue, Teams, Management, History tab |
| `Esc` | Let go of the search box or the focused row (dialogs and menus close on it too) |

**Row keys** fire only while a row has keyboard focus (`Tab` into the list, `↑` `↓` between rows).

| Key | Does |
|---|---|
| `↑` / `↓` | Previous / next row |
| `Enter` | Open the row's menu; every other row action is in it |
| `Delete` | Remove from queue (undo toast) |

`D` replaces the old idea of `Space`: Space also presses whichever button has focus, and a stray
press mid-stream would reshuffle the teams.

**Enter submits every single-purpose input** (owner, 2026-09-27), and no hint ever says so: Add
player, Edit player, the sanction dialogs and a new moderator submit their form; the queue search
jumps to the first match (focus on its row, so the row keys work at once); a Settings text or
number field saves its section; the welcome page's join command saves step 2; in Stage 12 the
*Watch a channel* field opens it. An IME composition's Enter is left alone.

---

## Pages

| Route | Who | Indexed | Theme | Language |
|---|---|---|---|---|
| `/` signed out | Anyone | **Yes** | System, with toggle | `?lang=`, else browser, else `en` |
| `/c/<channel>` | Streamer, moderators | No | Saved choice, default Mürekkep | Saved choice, default `en` |
| `/welcome` | A streamer's first sign-in | No | as above | as above |
| `/watch/<channel>` | Viewers, no login | **Yes**, when enabled | System, with toggle | `?lang=`, else browser, else `en` |
| `/overlay/<key>` (Stage 13) | OBS browser source | No | Always Mürekkep panels on transparent | The overlay's own language setting |
| `/` signed in (Stage 12) | Streamers, moderators | No | Saved choice | Saved choice |
| `/c/<channel>/settings` (Stage 12) | Streamer | No | Saved choice | Saved choice |
| `/help` (Stage 15) | Anyone | **Yes** | System, with toggle | `?lang=`, else browser, else `en` |

### Home (`/`, signed out)

The only marketing surface, and deliberately small. It is also the sign-in page: there is no
separate `/login`.

- The wordmark "TheAtlas *Queue*", typed in with `Typewriter`.
- One sentence saying what it is, and a three-item list: viewers join from Kick chat, draws are
  fair and shown live, the queue survives a closed tab.
- **Continue with Kick** (primary). Under it, muted: what signing in stores.
- A footer: source code link (AGPL-3.0: a network service must offer its source), language
  switch, theme toggle.

### Onboarding (`/welcome`)

The first time a streamer signs in. One page, three numbered steps stacked vertically, each
finishing in place. No wizard, no Next buttons.

1. **Your channel.** "Signed in as HoustonHUB", read from Kick. Nothing to type.
2. **How viewers join.** The queue command (default `!sıra`), the *Require Riot ID* switch with
   its region, the stream language. Each control has a one-line description.
3. **Try it.** "Type `!sıra Name#TAG` in your chat now." A live checker waits and, when the first
   command arrives, shows the row appearing exactly as it will on the dashboard. A **Skip** link
   sits beside it.

Finishing opens the dashboard with its entrance. Theme and UI language start from the browser.

### Dashboard (`/c/<channel>`)

One column of chrome, then the active tab. Max width 1440px, centred (widened from 1180px at the owner's request, 2026-09-23, so the queue table and the feed sit side by side without crowding).

**August parity (owner, 2026-09-23).** The owner compared this dashboard with the deployed
August app and brought back its header, toolbar, queue table, menu icons and headers, fixed team
boxes and drag and drop. The sections below describe the result; where they differ from what
this document said before, the owner's choice wins.

**Top bar.** A full-width band on `bg-card` with a `border-b`, sticky at the top while the page
scrolls; its content keeps the page's 1440px (August's header). The TheAtlas tile (black on
Kâğıt, white on Mürekkep) and the wordmark "TheAtlas *Queue*", **typed in by `Typewriter`**
(*Queue* one 40ms beat after *TheAtlas*): it is the page's title. After it, a breadcrumb: a
muted `/` and the **channel name** in Newsreader, typed on after the wordmark (owner, 2026-09-27: the dateline went, D21),
then *Moderating* as muted text for a moderator; on phones the channel stands in for the
wordmark, and D19 makes it the way back to the selection page. Right: the [connection pill](#connection-health), the command palette button
(a search icon, `aria-label`), the EN | TR switch, GitHub, the theme button, a settings gear
(streamer only; **Settings is not a tab**, this gear, the account menu, `⋯` and the palette open
it) and the **account menu** (avatar and name; Settings, **Sign out**). Under 768px the middle
tools fold into `⋯`; the pill and the account stay.

**Masthead.** No big channel title and no dateline (owner, 2026-09-23 and 2026-09-27): the top
bar names the channel, the tab count says who waits, and Live / Offline joins the top bar with
D25. An `sr-only` `h1` keeps the heading; the streamer's subtitle (`brand.subtitle`) shows
when set. Right: **the toolbar**, the same on every tab.

**Toolbar.** Add player · **Pick ×1 ×2 ×3** with its source (*Waiting*, *Teams*, *Whole
queue*; remembered per browser, and every pick control uses it) · **Shuffle ▾** (Draw teams `D`, Reroll `R`, Shuffle current
teams, Clear teams) · **Clear queue** (destructive ghost). Everything in it has an Undo toast.
Under 768px the labels become `sr-only` and the icons stay.

*Pick rule* (owner, 2026-09-27): the pool is what `pick_players` would draw from, the source's
players less anyone banned or punished. A size the pool cannot fill is not shown, anywhere;
×1 stays, disabled, when the pool is empty.

**Page menu.** Right-click anywhere on the dashboard, kept short (owner, 2026-09-23): a header
*Queue management (N players)*, **Add player** first, then Draw teams, Pick 1, Clear queue,
Search and commands, theme, and **Reload page** last (owner, 2026-09-27). Everything else is in the toolbar, the top bar or the account
menu. Rows and team cards keep their own menus; text fields keep the browser's.

**Errors.** A crash or a failed load shows Retry and **Reload page** where the content would be,
with one line saying the queue is safe on the server (it is: Postgres holds it, and a reload
refetches `get_state`). `global-error.tsx` covers a failure of the root layout itself, in both
languages, without the providers.

**Footer.** "Atlas Ata KAHRAMAN", muted caption, centred. August's hover easter egg on it stays
removed (spec D14).

**Tabs.** shadcn `Tabs` (the `line` variant, its own underline hidden) restyled (owner,
2026-09-24): a full-width muted track (card on Mürekkep) of equal tabs, 48px high with 18px
icons on a 6px track padding (the stock `h-8` on the list is overridden, `h-auto!`); a raised card slides
under the active tab (`useSlide`, 300ms ease-out-expo, the same motion as the filter pills); a
gold line under the active label (icon, name, count) grows from its centre; each tab carries its
icon, gold when active, turning −6° and ×1.15 over 200ms on hover, and a live count when above
zero (players, in teams, active sanctions): a bare tabular figure in Newsreader, set apart from
its sans label (owner, 2026-09-27; filter pills and the feed's unread count too), no capsule, gold on the active
tab, rising into place (`--animate-count`) when it changes. A switched-to panel fades in from the side the
indicator moved (±16px, 220ms, `.tab-in`). The phone bottom bar slides a pill behind the active
icon. No motion under reduced motion. Tailwind v4's `rotate-`/`scale-`/`translate-` set their
own properties, so their transitions name them (`transition-[rotate,scale,…]`), not
`transform`. In this order. These are the current tabs minus Maç
Geçmişi, plus History (owner, 2026-09-27: the log belongs to no one tab); do not add to them
without a reason written here.

| Tab | Contents |
|---|---|
| **Queue** (with count) | Filters All / Waiting / In game / Away / Punished · search · the queue table · right: *From chat* feed and four stat tiles |
| **Teams** | The match headline · two team cards (side by side from 1024px) · the fair-play switch · Clear teams / Shuffle current teams / Reroll / Pick from waiting / Draw teams (primary) |
| **Management** (TR *Yönetim*) | **New action** (sanction a Kick name that is not in the queue) · **Clear sanctions** (streamer only, undoable) · the sanctions: warnings, punishments, bans. Stage 9: [three tables](#management-tab-stage-9-d25) |
| **History** (TR *Geçmiş*, `History`) | Who did what ([Roles](#roles-streamer-and-moderators)), its own tab (owner, 2026-09-27): filter All / Queue / Teams / Management / Chat and stream, with counts; one card per day (*today*, *yesterday*, then the date), a line per change: time (tabular) · the action's icon in its colour (a move into a team in that team's colour) · the sentence, names in `foreground` on a muted sentence. Undone lines are struck through with an *undone* tag. **Clear history** (streamer only, destructive, asks first; owner, 2026-09-28) sits beside the filter: the feed is also the undo stack, so nothing before it can be undone and the clear itself has no Undo; its own line is what is left |
| **Games** (Stage 10) | [This stream's score, Games and Stats](#games-tab-maçlar-stage-10-d27) |
| **Settings** | Streamer only, **not in the tab bar** (opened from the top bar). Sections: Queue & commands · Riot · Draws & perks · Moderators · Watch page & overlay · Labels & language · Your data. Stage 12: [its own page](#settings-page-cchannelsettings-stage-12-d20-d30) |

A **Watch page ↗** link sits at the tab bar's right edge.

### Designed ahead (Stage 7, D36)

Every screen below is designed before its stage builds it. Each lists its **states**; a stage
that builds one builds all of them. Shared rules first.

**Skeletons are the page being opened** (owner, 2026-09-27). `loading.tsx` and every later
skeleton draw the current chrome (top bar with its breadcrumb, masthead toolbar, tab bar) and
**the tab or page in the URL**, at the real sizes, so nothing moves when it lands: the Queue
tab is the table header, six rows on the table grid and the feed column; Teams is the headline
and two cards with their team-size slots; Management is its sub-tabs and table rows; Games is
the score strip and game rows; Settings is the section list and the first section's card.
Bars are `bg-muted`, pulsing once a second. Built in Stage 9 with D25; today's `loading.tsx`
draws the Queue tab only.

**Tooltips (D25).** One `TooltipProvider`, 200ms delay, instant between neighbours. Every
icon-only button has one, and every **disabled** control says why (*Teams are full*, *Only the
streamer can do this*, *Offline: actions are paused*). No native `title=`.

#### Top bar: Live / Offline (Stage 9, D25)

```
[▣] TheAtlas Queue / HoustonHUB  ((·)) Live 1:42    [▮▮▮ Chat]  🔍  EN|TR  ⌥  ◐  ⚙  (◉ Atlas)
```

After the breadcrumb: an icon and a word, no capsule, **never a dot** (owner, 2026-09-27).
**Live** is `Radio` in `--success` with the time on air (`live_since`, tabular, updated each
minute), its two outer arcs fading in turn (2s, off under reduced motion); **Offline** is
`RadioOff`, muted. The tooltip holds the stream title. On phones the icon alone
stays beside the channel.

#### Management tab (Stage 9, D25)

Sub-tabs **Warnings · Punishments · Bans**, the filter-pill control with a count each.
Each is a table on the queue table's grid rules (header row, `bg-row` rows, 6px apart):

| Sub-tab | Columns |
|---|---|
| Warnings | Player (name + tags) · Reason · Respect · Given (time, by whom) · `⋯` (turn into a punishment, lift) |
| Punishments | Player · Length (*3 games left* / *until 22:10*) · Reason · Respect · Ends · `⋯` (edit length, lift) |
| Bans | Player · Reason · Respect · Since · `⋯` (edit length, lift) |

**Turn into a punishment** (D22, August's *Türü Değiştir*) opens the punish form for that
player with the warning's reason filled in; saving replaces the warning with the punishment, one
write and one Undo. **Edit length** (August's *Süreyi Düzenle*) opens the same form with the
current length (games left, minutes left, or the ban's length) and no reason field; the new
length counts from now. Both are built in Stage 8 into today's sanction cards' `⋯`, and move
into these tables with them.

**New action** (primary on this tab) and **Clear sanctions** (streamer only, undoable) sit right
of the sub-tabs. Lifted and served sanctions stay in their table, dimmed, with *Lifted* /
*Served* tags. States: empty per sub-tab (*No warnings this session.*), loading (six skeleton
rows on the grid), offline (actions disabled with the reason).

#### Games tab, *Maçlar* (Stage 10, D27)

The fourth tab (`Trophy`, count of games this stream). Two views on the filter-pill control:
**Games** and **Stats**, plus a search by name.

```
Kurtlar 3 – 2 Kartallar                                             [Games | Stats]  [🔍 name]
┃ #5  🏆 Kurtlar         5 v 5       22:12   32 min                               [⋯]
┃ #4  🏆 Kartallar       5 v 5       21:36   28 min                               [⋯]
```

- A game is **one line** (owner, 2026-09-28): a `bg-row` row on the queue table's grid, 3px left
  edge in the **winner's** colour; the game's number this stream, trophy and the winner's
  current name, the team size, the end time and length (tabular). No rosters on the row.
  The whole row opens the game's page; `⋯`: *Open*, *Copy result*, *Remove this game*
  (undoable). A name search keeps the rows the player was in.
- **Stats**: a table (Player · Games · W · L · Win rate · Streak), sortable like the queue
  table, minimum-games filter; *most wins* and *longest streak* lead in a two-tile strip.
- Loads the last 20, then 50 more on scroll (keyset), a skeleton row while fetching.
- States: empty (*No games yet. Press Victory on the winning team.*), loading, error with Retry,
  offline.
- Elsewhere: channel W / L beside each name in the queue table's player card and hover, and this
  stream's score under the match headline on Teams.

#### A game's page `/c/<channel>/games/<n>` (Stage 10, owner 2026-09-28)

Each game gets its own page, so a row stays one line and a result can be linked.

```
← Games                                                      [Copy result] [⋯]
Kurtlar won game 5
22:12    32 min    5 v 5
┃ Kurtlar  🏆                            ┃ Kartallar
┃ 1  brkdmr      Plat IV   4 W  1 L      ┃ 1  mirayy     Gold II   2 W  3 L
┃ 2  kaanxd      Gold I    3 W  2 L      ┃ 2  …
```

- The dashboard's top bar; the breadcrumb reads *… / HoustonHUB / Games / 5*. The headline is
  the Teams tab's match headline (Newsreader, team colours), then the time, length and size, set apart by space (no dot separators).
- Two team cards as on Teams (the winner's first, a trophy by its name), rows with the rank at
  the time of the game and the player's W / L this stream; a row opens the player card.
- ← and → step to the previous and next game; `⋯`: *Remove this game* (undoable, then back to
  Games).
- States: loading (the headline and two cards as skeletons), a removed or unknown game (a
  404 in the page's own words with ← Games).

#### Selection page `/` signed in (Stage 12, D19)

A page of its own, not a stock dashboard: the home page's wordmark and faces, then the choices.

```
                           TheAtlas Queue
Continue ─────────────────────────────────────────────────────────────
  (◉) HoustonHUB      Manage queue · 14 waiting · ((·)) Live      [Continue →]
      [ ] Open this automatically

Your channels
  (◉) HoustonHUB          Streamer    ((·)) Live   14 waiting          [Watch] [Manage]
  (◉) mirayy              Moderator   Offline       3 waiting                  [Manage]

Watch a channel
  [ kick.com/… or channel name                                   ▾ ]           [Watch]
```

- **Continue** is the place last left, first. *Open this automatically* is a `Switch`: on, `/`
  redirects there (a cookie, so no flash) and every dashboard's breadcrumb leads back here.
- Your channels: **full-width** rows (owner, 2026-09-28) on the queue table's grid rules
  (`bg-row`, 6px apart): avatar and channel, the role, the Live icon or *Offline*, the waiting
  count (tabular), then the buttons at the right edge.
- Watch a channel: one input below, as wide as the rows, that takes a name or a Kick URL. It
  suggests the recently watched channels through a native `datalist` (this browser only,
  localStorage, the last 8), so there is no separate recent list; Enter watches.
- States: no channels yet (*Set up your channel* → `/welcome`), a channel that no longer
  exists (the row says so, *Remove*), loading (the rows as skeletons).

#### Settings page `/c/<channel>/settings` (Stage 12, D20, D30)

Its own page with the dashboard's top bar; the breadcrumb reads *… / HoustonHUB / Settings* and
**← Queue** leads back. Two columns from 1024px: a sticky **section list** (left, 14rem) and one
section at a time (right, max 44rem); the section is in the URL (`/settings/riot`).

Sections, in order: **Commands** · **Riot** · **Teams & draws** (team size, fair play, reveal, *clear the queue when the stream ends*)
· **Games** (after-game action, retention) · **Perks** (the badge picker) · **Watch** ·
**Overlays** · **Moderators** · **Labels** · **Your data**.

- A section is a `bg-card rounded-xl p-6` of fields; a field is label, control, and one muted
  line only where the control's effect is not obvious; every section title links to its help
  page (`?` icon, D33).
- Switches, selects and pickers save the moment they change; text and numbers wait for the
  section's Save, disabled until one of them changed (owner, 2026-09-27, ADR 0033); errors
  under their field.
- **The section list** (owner, 2026-09-28): each section has its icon in its own colour
  (Commands `Terminal` brand, Riot `Swords` team 2, Teams & draws `Users` team 1, Games `Trophy`
  gold, Perks `Star` brand, Watch `Eye` badge-founder, Overlays `MonitorPlay` badge-og, Moderators
  `Shield` success, Labels `Languages` badge-vip, Your data `Database` destructive). The icons
  move as the dashboard tabs' icons do: a −6° tilt and ×1.15 on hover (200ms, off with
  Animations off). The active section carries the **tabs' underline**: the 2px gold line under
  its label, growing from its centre (300ms, the tabs' ease), and its label turns
  `--foreground`; the rest stay muted.
- **Clear the queue when the stream ends** (D22, August's *Sıra oturumu temizlendi*): a switch,
  on by default. When Kick reports the stream offline the queue and teams empty in one write;
  History says *Stream ended, queue cleared (12)* with Undo, and an open dashboard shows the
  same as a toast. Moderation stays.
- Phones: the section list becomes the page; a section opens as its own screen with ← back.
- States: loading (list + one card of skeleton fields), save error under the field, offline
  (fields disabled, the reason in a tooltip).

#### Overlays in Settings (Stage 13, D29)

```
Overlays                                                    [+ New overlay]
┌ Teams, bottom bar     /overlay/•••• ⧉  ↻ key     [Edit] [⋯] ┐
┌ Queue, right column   /overlay/•••• ⧉  ↻ key     [Edit] [⋯] ┐
```

- A list of overlays (`bg-row` rows): name, the URL **masked** (the key is a secret; ⧉ copies it,
  never shown in full on screen, so a stream never leaks it), *Rotate key* (undo impossible, so
  it asks by typing the overlay's name, the second `AlertDialog` after *Delete my data*), Edit,
  Delete (undoable).
- **Builder** (Edit): left, a live preview at 16:9 over a checkerboard (transparent) or a
  grey still; right, the widgets list (queue, teams, stream score, last result, wins
  leaderboard, respect leaderboard, draw reveal) with a switch and drag order each, then
  position, size, theme, background, language. Leaderboards take a minimum-games number; the
  respect board lists only the most respected.
- States: none yet (*Add an overlay for OBS*), preview loading (the canvas with skeleton panels).

**Most wins** widget (owner, 2026-09-28): a leaderboard panel for the overlay.

```
┌ Most wins this stream ───────────┐
│ 1  brkdmr        7 W   78%       │
│ 2  kaanxd        6 W   60%       │
│ 3  mirayy        5 W   71%       │
└──────────────────────────────────┘
```

- Ranked by wins, then win rate, then fewer games; players under the builder's minimum games
  are left out. Up to 3, 5 or 10 rows (builder setting); the period is this stream or the
  channel's retention window.
- The first row's rank number takes the gold, the rest are muted; names in `--ink-text`, wins
  tabular. A rank change swaps rows without motion (no entrance on the overlay, see below).
- Empty: the panel hides itself rather than show *No games yet* on stream.

#### Help `/help` (Stage 15, D33)

A public wiki, prerendered per language. Top bar with the wordmark; left, the topic list (sticky,
14rem); right, the article (max 42rem, `text-body`, Newsreader headings): getting started, chat
commands, queue, teams and draws, games, moderation and respect, perks and badges, watch and
overlays, settings, keyboard, privacy and *Delete my data*. A search box filters headings on the
page. Facts (default commands, limits) render from `DEFAULTS`, never retyped. Phones: the topic
list is a `Select` above the article. States: an unknown topic is a 404; no loading (static).

### `/watch/<channel>`

Read-only, public, and built **mobile-first**, because viewers open it from a phone.

- The same masthead, minus the tools a viewer cannot use. The Live icon (`Radio`, as on the
  dashboard, never a dot) shows whether the **stream** is live, not the connection.
- Sections, in order, each switchable by the streamer: **Teams** (when a draw exists: headline,
  this stream's score, rosters), **Queue** (rows without a menu; the player card only if the
  streamer shares Riot IDs), **Games** (opt-in, Stage 10: the last 10 results and the wins
  board), **Management** (off by default; names and kind only, **never reasons**).
- States: disabled (below), nothing yet (*Nothing here yet*), a missing channel (a real 404),
  loading (each section's skeleton).
- The draw reveal plays live; the entrance plays on load.
- When the streamer turns the page off, it says so (`watch.disabled`) and is `noindex`.
- Footer: "TheAtlas Queue", the source link, EN | TR, theme.

### `/overlay/<key>`

An OBS browser source at 1920×1080. **No interaction, no cursor, no toasts, no entrance**: OBS
reloads the source often, and a page that animates on every reload looks broken on stream.

- The page background is **transparent**. Content sits on `rounded-xl` panels of `--ink-floor` at
  88% opacity, always Mürekkep regardless of theme, measured legible over any footage
  ([Contrast](#contrast)).
- **Several overlays per channel** (D29, Stage 13), each its own URL with a random 128-bit key:
  its widgets, order, position, size and language come from its configuration in Settings
  (queue, teams, stream score, last result, wins and respect boards, the draw reveal, which
  appears only for a reveal and fades out 20s later). An unknown or rotated key renders
  **transparent and empty**, never an error on stream.
- Sizes from the overlay rows of [The scale](#the-scale); nothing under 24px, so it survives a
  720p stream.
- Language: the overlay's own setting, defaulting to the *stream language* chat replies use.

---

## States

Every view designs all of these, not only the full one.

**Loading.** The dashboard and `/watch` are server-rendered with their data; while the server
works, `loading.tsx` draws **the page being opened** ([Designed ahead](#designed-ahead-stage-7-d36)):
on `/c/<slug>`, the chrome and then the tab the page will render (Queue, Teams, Management, History
or Settings, from the same `queue.tab` cookie), each in its own geometry (owner, 2026-09-27).
Anything fetched later shows **skeleton rows**: the real row shape (`bg-row`,
`row-edge`, `rounded-xl`) with `bg-muted` bars where the text goes, at most six, pulsing once a
second, still under reduced motion. Never a centred spinner in a list.

**Empty.** A Newsreader line and one muted sentence saying how to fill it, the command in mono:
"Viewers join by typing `!sıra Name#TAG` in Kick chat." No illustration, no second button.

**Error.** A failed load renders inline where the content would be: a `bg-card` block saying what
failed, with **Retry**. A failed *action* rolls its optimistic change back (the row returns,
with `bg-highlight`) and raises a toast with **Retry**.

**Offline.** When the browser goes offline or the realtime channel drops, a slim banner appears
under the masthead: "Offline — showing the last known queue. Actions are paused until you're
back." Actions that change data are disabled, not queued.

### Connection health

The masthead pill reports whether **commands from chat are reaching Queue**. It is computed on
the server from the Kick event subscriptions and the last event received, never from a browser
socket.

Three **signal bars** (owner, 2026-09-27) carry the state: how many light, and in which colour.
They bounce once, left to right, when a command lands (`--animate-signal`, off under reduced
motion) and never move otherwise. The text says *Chat*, never *Live*: "Live" read as "the stream
is on air", which the dateline already reports.

| State | Bars | Text | Meaning |
|---|---|---|---|
| Live | 3, `--success` | "Chat · last command 12 s ago" | Subscriptions active, a command in the last 10 min |
| Listening | 2, `--muted-foreground` | "Chat · quiet for 14 min" | Subscriptions active, chat simply quiet. **Not an error** |
| Delayed | 1, `--warning` | "Delays possible" | Kick reported failed deliveries or a health check failed |
| Not connected | 3 hollow, `--destructive` outlines | "Not connected" + **Reconnect** | Subscriptions missing or revoked |

Clicking the pill opens a popover with the details: subscription state, last event, last check.
Only *Not connected* ever raises a toast.

### Toasts versus the feed

- **Events from chat never toast.** They appear in the *From chat* feed and as the row highlight.
  A busy stream would otherwise bury the screen.
- **Toasts are for the streamer's own actions** (with Undo), errors (with Retry), and losing the
  connection.
- `sonner`, bottom-centre, at most three visible.

### Undo, and a confirm for the big ones

Every action that changes or removes data gets a 5-second **Undo** toast: remove, move, mark
away, moderation, draw and reroll (Undo restores the previous result), removing a protection.
A row's `×` and every other single-player action stop there: no dialog.

**Bulk and moderation actions also ask first** (owner, 2026-09-27, amending D26): *Clear queue*,
*Clear teams*, *Clear sanctions*, *Clear history* (no Undo toast: it empties the undo stack), and in Stage 10 *Delete game* and *Remove from all history*.
Their buttons and menu items wear the destructive look (`variant="destructive"`), and pressing
one opens a shadcn `AlertDialog` (`confirm()` in `confirm.tsx`, one host in the dashboard) that
says what goes and how many, with **Cancel** and the action's own name as a destructive
button; the Undo toast still follows. **Ban** confirms through its own sanction dialog, whose
button is destructive. Two confirms go further, for what cannot be undone: *Delete my data* in
Settings → Your data asks the streamer to type their channel name, and *Rotate key* on an
overlay (Stage 13: an undo would revive a leaked URL) asks for the overlay's name.

---

## Recipes

### Queue table

The contract Stage 9 builds (D25, D31, D34, D35, D36, D37); where today differs, it says so.

```
  #↺  PLAYER ▾                                  KICK        RANK ▾          WIN RATE ▾  JOINED ▾
⠿ 3   (◉) brkdmr          96 ♥  ◆ In game  ★ Sub    brkdmr_tv   ▍ Platinum IV   56%         21:40   [1] [2] [×] [⋯]
│ │    │  #TR1              │     └ tags: icon + word, fold to icons under 20rem of line
│ │    │                    └ respect: the score then ♥, success ≥ 80, warning ≥ 50, destructive below
│ │    └ Riot profile icon (the initial when none); the name truncates before any tag moves
│ └ queue number, Newsreader, tabular
└ grip (GripVertical, muted), pointer devices with write access only
```

- **Rows.** `rounded-xl bg-row border border-row-edge border-l-[3px] px-4 py-3` on one grid
  (`TABLE_COLS`) shared with the header. The left edge is the state: team colour in a game,
  dashed when away, `row-edge` waiting. **One line**: the name cell never wraps.
- **Header (D35).** *Player* (sorts by name, Turkish collation), *Rank*, *Win rate* and *Joined*
  are buttons: `text-caption uppercase`, muted; the sorted one is foreground with `ArrowUp` /
  `ArrowDown` (14px) and carries `aria-sort`. A second click flips it. While a column sort is on,
  the `#` header becomes `↺` (tooltip *Back to queue order · Dragging is off while sorted*);
  unranked and no-games rows go last. Remembered per browser (`queue.sort`). *Kick* does not
  sort. **Sorting is a view**: Pick and the draw still use the queue order, and dragging is off
  while sorted (the grips go).
- **Riot IDs are the master switch** (owner, 2026-09-28). Settings → Riot lists *Require Riot
  ID* first and *Look up ranks* under it, disabled (and shown off) while Riot IDs are off; Region
  appears with ranks. Ranks keep their own value, so turning Riot IDs back on brings them back.
  - **Riot IDs off** (`require_riot_id` false): *Kick*, *Rank* and *Win rate* leave the table
    (`TABLE_COLS_PLAIN`) and the player cell shows the Kick name. Nothing else that needs Riot
    shows either: the team card's average rank, the Riot ID card, *Copy Riot ID*, Riot IDs in the
    palette, the add lists and the feed, and the watch page's *Riot IDs* switch.
  - **Riot IDs on, ranks off**: the Riot name and *Kick* column show (`TABLE_COLS_IDS`), but no
    *Rank*, *Win rate*, profile icon or average rank, and nothing is looked up (chat joins get no
    region from `webhook_context`, 0023; manual adds skip `lookupRank`).
  - Players keep their stored Riot IDs and ranks either way; turning a switch back on shows them.
- **Loading Riot (D25).** Rank and win-rate cells hold a `Skeleton` of their own width until the
  data lands; the Queue heading gets a muted *Loading ranks 3* counter that pulses. Nothing shifts.
- **Row buttons (D34).** Visible, labelled, in this order before `⋯`, each with a tooltip:

  | Row | Buttons |
  |---|---|
  | Waiting or away | **1** · **2** (the team number in Newsreader, in the team colour; tooltip *Add to {team}*) · **×** *Remove from queue* |
  | In a team (queue table or roster) | **⇄** *Move to {other team}* (the other team's colour) · **↩** *Back to waiting* · **×** *Remove from queue* |

  Ghost `icon-sm` buttons at **40 % opacity** at rest (dim, not invisible), full on row hover or
  focus inside; on touch always full and 44px. A full team disables its button, and the tooltip
  says why: *{team} is full (5 of 5)*. Today (7.11): icons, hidden until hover.
- **Breakpoints.** Under 1024px *Win rate* and *Joined* go; under 768px *Kick* and *Rank* go and
  the header hides (sorting then lives in the page menu).
- The row is focusable (`tabIndex={0}`) for the row keys; Enter opens its menu.

### Drag and drop

Native HTML drag and drop, no library (`@dnd-kit` stays removed).

- **Pick up.** The whole row drags. The cursor is the grab hand at rest and grabbing while
  pressed (owner, 2026-09-27); once the drag starts the browser draws its own cursor, which CSS
  cannot change. The row left behind dims to 40 %.
- **Preview (D25).** Not the browser's picture of the row: a chip, `bg-card rounded-lg border
  border-row-edge border-l-[3px]` in the row's state edge, `shadow-md`, max 16rem: a 20px avatar
  initial, the name (`text-name`, truncating) and the `#TAG` muted. Built off-screen and handed
  to `setDragImage` (6.14 ships it without the avatar and tag).
- **Targets.**

  | Over | Shows | Drop does |
  |---|---|---|
  | Between two queue rows | a 3px `--ring` line at that edge | takes that place in the queue |
  | Between two roster rows of a team (D37, built 7.33) | a 3px line **in that team's colour** | joins that team **at that place**, from the queue or the other team, one write with `p_key`; a full team's rows refuse it |
  | A team card elsewhere | the card rings in its team colour | joins at the end of the team |
  | A full team | the card's header reads *{team} is full* in `--destructive`, no ring | refused (`dropEffect = none`) |
  | Its own slot (either side of itself) | nothing | refused, no write (6.9) |
  | A punished row (owner, 2026-09-28) | nothing | refused: it does not drag either, its place is held |

- Every drop has an Undo toast. Touch has no drag: the row buttons and the menu do the same.

### Player card

One `PlayerCard` (D31) for queue rows, team slots and the Games tab. It reads the store by
player id, never fetches on hover, and mounts only when open. 20rem wide, `rounded-xl
bg-popover p-4 shadow-md`.

```
┌──────────────────────────────────────────────┐
│ [icon 48]  brkdmr#TR1  ⧉            Lv 312    │  Riot ID in mono; click copies, ⧉ turns ✓ for 1.5 s
│            ★ ◆ ♛                              │  Kick badges: glyph + colour each, tooltip names it
├──────────────────────────────────────────────┤
│ ⛨ Platinum IV · 42 LP                         │  shield in the tier colour (an emblem), text foreground
│ 128 W · 110 L   ▲ 53.8 %   ▓▓▓▓▓▓░░░░░         │  win rate success ≥ 50 %, a 4px bar under it
│ This channel: 7 W · 3 L · won 3 in a row      │  Stage 10 (D27)
│ 96 ♥ respect · joined 21:40 from chat · 2 games│
├──────────────────────────────────────────────┤
│ brkdmr_tv ⧉                   [↻ Refresh rank] │  Kick name copies; Refresh via the server action
└──────────────────────────────────────────────┘
```

- **Kick badges (D36):** subscriber `Star` (brand), VIP `Gem` (`--badge-vip`), OG `Award`
  (`--badge-og`), founder `Crown` (`--badge-founder`), sub gifter `Gift` (success): the badge
  picker's table (`BADGE_LOOK`), read from `players.badges`.
- **It never gets in the way:** opens only from the name, after **500ms** of stillness,
  instantly between neighbours; sits beside the name, never over the row below or the actions;
  closes at once on any press, right-click, menu, drag, scroll or key, and stays shut while a
  menu is open. Keyboard focus on the name opens it; touch taps the name (a `Popover`).
- **States:** Riot loading → skeleton lines at their final height; no Riot ID and *Require Riot
  ID* off → no card at all; Riot failed → the rank line says *Rank unavailable* beside Refresh.
- **Secure:** names render as text; the icon URL is built from the numeric icon id; Refresh is
  membership-checked and rate-limited per player.

Today: a text list in a `HoverCard` (350ms). Stage 9 replaces it.

### Row menu

shadcn `ContextMenu` on the row, the same content in a `DropdownMenu` on `⋯`, and on long-press
on touch. A header line names the player (the Riot ID in mono, else the Kick name); every item
has its lucide icon. Groups:

Each kind of action is its own section, divided by a separator (owner, 2026-09-28):

1. copy (Riot ID, Kick name) · then edit and **Refresh rank** (`RefreshCw`, D22) on their own;
   Refresh is disabled without a Riot ID or with ranks off, and a second press within a minute
   says *Just refreshed*
2. **Add player above** (`ArrowUpToLine`) · **Add player below** (`ArrowDownToLine`) (D37). On a
   roster row they open the team add list (waiting players, then *Add a new player…*) anchored
   on that row; on a queue row they open Add player, and the new player lands at that place.
   One write, one Undo. Disabled on a full team. Built in Stage 7 (7.33, migration `0018_place`).
3. teams (both, with the team's **current name** and colour)
4. state (back to waiting, mark away or back, lift a punishment) · protection (*Remove
   protection*, only on a protected sub) on its own
5. moderation (warn and punish in warning, ban) · remove on its own

Ban and remove are `variant="destructive"`. Shortcut hints go here.

### Add player

shadcn `Dialog` (not `AlertDialog`, which shadcn reserves for confirmations) containing a
`Command`:

- The search filters two groups: **Recent in chat** ("2 min ago") and **Played before**
  ("played 7 times").
- Picking an entry fills the Kick name and, if known, the Riot ID. A typed name that matches
  nothing is added as it is.
- The Riot ID field is shown and required only while *Require Riot ID* is on.
- Footer: Cancel (outline) and Add player (primary).

### Command palette

shadcn `CommandDialog` (`max-w-xl`), opened by `Ctrl/⌘ K` or the masthead's search button.
Reworked 2026-09-28 on the owner's free hand ("it is too simple"):

- **Groups.** **Actions** (draw, reroll, pick ×N, shuffle, add player, then the two clears in
  `destructive`), **Players**, **Go to** (the tabs, the search box), **Preferences** (theme,
  language, animations and notifications with their state, sign out). Every item carries its
  lucide icon, the same one its button or menu item wears.
- **Players as rows.** Each is a small row: the 3px state edge (team colour in a game, warning
  when punished, `row-edge` otherwise), the Kick name over the Riot ID in mono, the row's tags.
  With nothing typed, five are listed and a muted line says how many more a name finds; typing
  searches everyone.
- **A player's page** (the one bold move). Choosing a player turns the palette into that player:
  a card on top (back arrow, the state edge, the name in Newsreader `text-title`, `#TAG` and Kick
  name under it, tags and rank on the right), the search now *Actions for {name}*, then *Show in
  the queue* and the row menu's own sections (`usePlayerMenu`, so the two never drift). Esc, or
  Backspace in an empty search, goes back; Esc again closes.
- **Key legend** along the bottom on a keyboard device: ↑ ↓ *Move*, ↵ *Open*, Esc *Close* (*Back*
  on a player's page). Every action shows its `CommandShortcut`; this and the row menu are the
  only places shortcuts are written down.

### Team card

`bg-card rounded-xl` with a 5px top bar in `--team-1` / `--team-2`. **No team name in the card**
(owner, 2026-09-23): the match headline above names both, team 1 left over its card, *vs* in the
middle, team 2 right-aligned over its card. On phones the cards stack and a Newsreader *vs*
sits between them (D25).

```
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀  5px team bar
■ 4 of 5 · avg Gold II                            [+ Add to Kurtlar]
┌ 1 (◉) brkdmr #TR1  ★ Protected       ▍ Plat IV   [⇄] [↩] [×] [⋯] ┐
┆   a 3px team-coloured line between two rows while one is dragged here (D37)
└ 2 (◉) kaanxd #0001                   ▍ Gold I    [⇄] [↩] [×] [⋯] ┘
┌╌ Empty slot ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐
[🏆 Victory]                                                     Stage 10 (D27)
```

- **Header line**, muted: a 10px square in the team colour (D25's colour mark, not a capsule),
  **{n} of {size}** and the average rank; right, **Add to {team}** in the team colour, which
  opens a searchable list of waiting players ending in *Add a new player…*. Every empty slot
  opens the same list on itself (6.12).
- **Roster** as inset rows (`bg-background border-row-edge`, `gap-1.5`): number, avatar, name
  `#TAG` with its tags, rank, the in-team row buttons, menu. **Always team-size slots**; free
  ones are dashed rows reading *Empty slot*, so the card keeps its height. While a draw lands
  they keep their icon and their full look, so nothing shifts when adding comes back (7.46; not
  dimmed, owner 2026-09-28). The header's *Add to {team}* and the card's right-click menu stay
  too, disabled until the names have landed.
- **Drop on blank space**: a team player dragged onto the page outside the cards leaves the team
  for waiting, with Undo (owner, 2026-09-27).
- **A row's menu lists both teams** always: *Add to Team N* is disabled, never hidden, when the
  player is already there or the team is full, and so are the hover buttons (7.47).
- **Right-click on the card** (not a player): the team's menu: *Team N · n of size*, Add from
  waiting ▸, Add a new player…, Shuffle current teams, Clear teams.
- **Victory (Stage 10, D27):** under the roster, a plain outline button in the team colour,
  `Trophy` and *Victory*: one press marks the team as winner (owner, 2026-09-27: no ▾, no
  menu). The after-game action is Settings' default; Undo in the toast takes the result back.
  Disabled while either team is empty, and the tooltip says so. The score (*Kurtlar 3 – 2
  Kartallar*) sits under the match headline with no *this stream* wording (owner).

### Tags

An icon and a word in the role colour, **no capsule, no border** (D36, owner 2026-09-27):
`inline-flex items-center gap-1 text-meta font-medium select-none`, the icon 14px. Tags sit on
the name's line; the name truncates first, and when the line is under 20rem (container query
`@container/name`) the words become `sr-only` and a tooltip carries them.

| Tag | Icon | Colour | When |
|---|---|---|---|
| Sub | `Star` | brand | A subscriber, in the queue |
| Protected | `ShieldCheck` | brand | A subscriber locked by the perk in this draw |
| In game | `Gamepad2` | that team's colour | State |
| Away | `Coffee` | muted | State |
| First game | `Sparkles` | success | Fair-play is on and they have not played this session |
| Warned | `TriangleAlert` | warning | Management |
| Banned | `Ban` | destructive | Management |
| Respect | The score, then `Heart` on its right | success / warning / destructive | Beside the name in the queue table |

Management rows and Settings → Moderators use the same form (warned `TriangleAlert`, punished
`Hourglass`, banned `Ban`, lifted `Undo2`, served `Check`; streamer `Video`, from chat
`MessageSquare`, added by you `UserPlus`, blocked `Ban`).

### Fair-play switch

On the Teams tab, in the actions bar: a shadcn `Switch` labelled *Prioritise players who haven't
played*, one line, centred on the buttons beside it; no explaining line (owner, 2026-09-27). When on, players with no game this
session carry the *First game* tag, and the player card says how many games each player has had.

### Badge picker

`BadgePicker` (D32), shared by the perk and, in Stage 14, subs-only joining (D23). A checkbox
group (`role="group"`, each tile `role="checkbox"`): Tab between tiles, Space toggles.

```
Badges that qualify
┌───────────────────────────────┐ ┌───────────────────────────────┐ ┌──────────
│ ★  Subscriber             [✓] │ │ ◆  VIP                    [ ] │ │ ✦  OG  …
│    Viewers subscribed to you  │ │    Viewers you made VIP       │ │
└───────────────────────────────┘ └───────────────────────────────┘ └──────────
Subscribers and VIPs get 3 protected picks every 30 days, and check what is left with the perk command.
```

- A tile: `rounded-xl bg-background border px-3.5 py-3`, the glyph (20px, the badge's colour),
  the name (`text-control` semibold), what its holders get as it stands (`text-meta` muted:
  *Subscribers stay in their team on a reroll* / *…are rerolled like anyone*; owner,
  2026-09-28), a 20px check box on the
  right. Checked: gold edge, the box filled gold with a check. Tiles fill the row at 13rem each.
- The sentence under it is live and joins the chosen badges with `Intl.ListFormat` in the page
  language. **The last checked tile refuses to clear**; the sentence turns destructive and says
  why (*Keep at least one: with none, nobody gets the perk*).

### Subscriber perk

Settings → Draws & perks: uses per rolling 30 days and the [badge picker](#badge-picker). On
the dashboard the perk is visible, never hidden odds: the *Protected* tags, the protected-first
order in the reveal, *Remove protection* in the row menu. Viewers check their own remaining uses
with `!hak`.

### Buttons

One `primary` per view: Add player on Queue, Draw teams on Teams, Continue with Kick on Home.
Everything else is `outline` or `ghost`. The primary is cream on ink and ink on paper, never
gold: gold marks attention, not action.

---

## Roles: streamer and moderators

Kick's API cannot list a channel's moderators, so Queue learns them from chat: a chat message
carrying Kick's **moderator badge** grants access, and a later message without it takes access
away. Settings → Moderators lists everyone with access and where it came from (*from chat* or
*added by you*). The streamer can add a moderator ahead of time by Kick username (the same
`Command` picker as Add player), and can **block** or remove anyone. A block always beats the
badge. A moderator signs in with their own Kick account and runs the streamer's dashboard at
`/c/<channel>`.

| | Streamer | Moderator |
|---|---|---|
| Queue, Teams, Management, History tabs | ✓ | ✓ |
| Settings tab | ✓ | Not shown |
| Theme, language | Their own | Their own |

- **Who you are acting as is always visible.** A moderator's masthead reads "HoustonHUB
  *Queue*" like the streamer's, with a `rounded-full` tag after it: *Moderating*.
- **Every change is attributed.** The History tab lists every change as a line: time, the
  action's icon, "**mirayy** moved kaanxd to **Kurtlar**". Undo toasts name the actor when it was
  someone else.
- A moderator with no dashboard to moderate lands on a short page saying so, with a link to their
  own.

---

## Mobile

Below 768px. Streamers and moderators use phones as a second screen, viewers use `/watch` on
phones first.

- **Touch targets are 44px.** Controls step up from 36px; rows keep their padding.
- **Tabs move to a bottom bar**: fixed, four items with icon and label, `pb-[env(safe-area-inset-bottom)]`.
- **The masthead compacts**: the channel name at `text-title`, the connection pill as its icon
  and short text, EN | TR, theme and the palette button behind one `⋯` menu.
- **The view's primary sticks** to the bottom, above the tab bar: Add player on Queue, Draw teams
  on Teams.
- **The chat feed moves into a bottom `Sheet`**, opened by a *From chat* button with an unread
  count.
- **Filters become horizontally scrollable pills.** Team cards stack.
- **Hover becomes tap**: the player card becomes a `Popover` on the name; the row menu opens from
  `⋯` or a long-press.
- **Dialogs become bottom `Sheet`s** (`side="bottom"`), the Add player picker included.
- No right-click and no keyboard: every shortcut's action is also reachable by touch.

---

## Language and labels

**Two languages, `en` default, `tr`.** Every string the UI renders comes from a label key; none
is written inline in a component. The product name is the one exception: *TheAtlas Queue* is
not a label.

**Where the language comes from.** The dashboard: the EN | TR switch, remembered per user. Home
and `/watch`: an explicit `?lang=en|tr` in the URL wins; otherwise the browser's language
(Turkish → `tr`, anything else → `en`), and the EN | TR switch sets `?lang`. `/overlay` and chat
replies: the streamer's *stream language* setting. `<html lang>` always matches the page.

**Keys** are dotted, by area: `queue.title`, `queue.hint`, `team.1`, `team.2`, `match.vs`,
`action.draw`, `chat.rejected.banned`. A key names the *slot*, not its current wording.
Interpolation uses braces: `queue.hint` = "Viewers join by typing {command} in Kick chat."

**Streamers can override a curated set of labels, per language.** Settings → *Labels &
language* lists them, each with a readable name above its key. The editor **always edits the
language selected in the masthead**; there is no second language switch inside it. A change
updates the dashboard, `/watch`, `/overlay` and chat replies live. An empty value falls back to
the default; ↺ clears the override.

Resolution order: **streamer override for that language → built-in default for that language →
built-in English.**

The curated set, and nothing else. Everything outside it is translated but fixed.

| Area | Keys |
|---|---|
| Identity | `brand.subtitle` |
| Teams | `team.1`, `team.2`, `match.vs` |
| Queue | `queue.title`, `queue.empty.title`, `queue.empty.hint` (`queue.hint` went with D21) |
| Actions | `action.add`, `action.draw`, `action.reroll`, `action.pick` |
| Watch page | `watch.title`, `watch.subtitle`, `watch.disabled` |
| Overlay | `overlay.queue.title`, `overlay.draw.title` |
| Chat replies | `chat.joined`, `chat.rejected.banned`, `chat.rejected.duplicate`, `chat.position`, `chat.perk` |

Team names are ordinary labels, so "Kurtlar" in Turkish and "Wolves" in English is two
overrides, not a special field.

The current `AppSettings` text fields migrate:

| Today | Becomes |
|---|---|
| `pageTitle` | **Deleted.** The name is fixed |
| `pageSubtitle` | `brand.subtitle` |
| `queueCardTitle` | `queue.title` |
| `queueCardDescription` | `queue.hint` |
| `emptyQueueTitle` | `queue.empty.title` |
| `emptyQueueDescription` | `queue.empty.hint` |

**Chat commands are not labels.** `!sıra` is a setting (`queueCommand`), the same in both UI
languages, because viewers type it. Rank tiers, region names and relative times come from the
built-in table and are not editable.

---

## Metadata and SEO

Built with the Next.js Metadata API (`metadata` / `generateMetadata`, `viewport`, and the file
conventions `robots.ts`, `sitemap.ts`, `manifest.ts`, `opengraph-image.tsx`, `icon`,
`apple-icon`), following Google Search Central's guidance. Nothing is hand-written into `<head>`.

### Titles and descriptions

A title template in the root layout: `{ default: "TheAtlas Queue", template: "%s · TheAtlas
Queue" }`. Titles stay under 60 characters and descriptions between 120 and 160, both per
language.

| Route | Title | Description |
|---|---|---|
| `/` signed out | absolute: "TheAtlas Queue — Kick queue and fair team draws" | What it does, in one sentence, for a streamer |
| `/c/<channel>` | "{tab}" → "Teams · TheAtlas Queue" | — (not indexed) |
| `/watch/<channel>` | "{Channel}'s queue" | "Live queue and team draws for {Channel}'s stream on Kick." |
| `/overlay/<channel>` | "Overlay" | — (not indexed) |
| `/welcome` | "Welcome" | — (not indexed) |

### Every page

- `metadataBase` set to the production origin, so every relative URL resolves absolutely.
- `applicationName: "TheAtlas Queue"`, `creator` and `publisher` as the author.
- `openGraph`: `siteName: "TheAtlas Queue"`, `type: "website"`, `locale` (`en_US` / `tr_TR`) with
  `alternateLocale`, `url`, `title`, `description`, and a 1200×630 image.
- `twitter`: `card: "summary_large_image"`.
- `alternates.canonical`: the page's own URL. On home and `/watch`, also
  `alternates.languages` with `en`, `tr` and `x-default` (the URL without `?lang`).
- `viewport`: `width=device-width`, `initialScale: 1`, and `themeColor` per
  `prefers-color-scheme`: `#131210` dark, `#f4f0e6` light. Zoom is never disabled.
- `icons` and a web manifest (`name`, `short_name: "Queue"`, the theme colours).
- `formatDetection: { telephone: false }`, so Riot tags are not turned into phone links.

### Indexing

- **Indexed:** the home page and every *enabled* `/watch/<channel>`. `sitemap.ts` lists exactly
  those, with `lastModified`.
- **Not indexed:** the signed-in dashboard, `/welcome`, `/overlay/*`, a disabled `/watch`, and
  every error page, via `robots: { index: false, follow: false }`.
- `robots.ts` disallows `/api/` and points to the sitemap. It does not disallow a page that
  carries `noindex`: Google has to crawl a page to see its `noindex`.
- A `/watch` for a channel that does not exist returns a real **404**, not a 200 that says "not
  found".

### Structured data

JSON-LD in a `<script type="application/ld+json">`, rendered on the server: a `WebApplication`
on the home page (`name`, `url`, `applicationCategory: "EntertainmentApplication"`,
`operatingSystem: "Web"`, `offers` at price 0, `inLanguage` both languages), and a `WebSite`
with `name: "TheAtlas Queue"` so Google shows the right site name.

### Open Graph images

Generated by `opengraph-image.tsx` with `next/og`, in Mürekkep with the three faces: the home
page's shows the wordmark; each `/watch` shows the channel name and its current team names.

### Page quality Google measures

- **One `h1` per page:** the channel name on the dashboard and `/watch`, the wordmark on home.
  Headings in outline order below it.
- **Core Web Vitals**: LCP < 2.5s (the project's own budget is 1s on `/watch`), INP < 200ms,
  CLS < 0.1. `Typewriter` keeps its final width from the first frame, fonts come with a
  size-adjusted fallback, and skeletons have the real row size, all so nothing shifts.
- Real links (`<a href>`) for anything a crawler should follow, descriptive link text, `alt` on
  every meaningful image.
- HTTPS only, no interstitials, readable without zoom on a phone.

---

## Icons

`lucide-react`, as today. Size comes from the button's size variant; do not set `size-*` on an
icon inside a button. Decorative icons are `aria-hidden`; icon-only buttons carry `aria-label`.
Menu items carry an icon each (the row menu, the page menu, the toolbar's Shuffle menu, the
account menu); the command palette does not. GitHub's mark is inline SVG, since lucide 1.x ships
no brand icons.
🛡 appears only in chat replies; the page draws protection with `ShieldCheck` and badges with
the [badge picker](#badge-picker)'s glyphs.

---

## Extending this

Everything interactive comes from shadcn, in `src/components/ui/`.

1. Use the component's own variants first.
2. Close but insufficient → add a `cva` variant to that component.
3. Layout genuinely breaks → extend the underlying `radix-ui` primitive inside the component.
4. **Never copy a shadcn file and diverge**, and never rewrite one onto another primitive.

Restyling a component's *layout* where it is used (a row's grid, a card's padding) is normal.
Changing what the component *is* belongs in `ui/`, as a variant.

A new colour, radius, size or face goes in `globals.css` and in this file's tables, in the same
commit, with its contrast numbers.

**Deliberate divergences, tracked here.** A future `bunx --bun shadcn@latest add` overwrites
these; re-apply them after:

- `ui/kbd.tsx` imports `cn` from `@/lib/utils`. The CLI wrote `from "cn"` and installed an
  unrelated npm package named `cn`; that package is not a dependency here.
- `ui/scroll-area.tsx`, same import. Its scrollbar is 6px at rest and widens to shadcn's 10px
  under the pointer (`data-vertical:w-1.5 … hover:w-2.5`, the same for horizontal), and its
  thumb is `bg-row-edge` (stock `bg-border` is a hairline, near invisible on Mürekkep). It serves
  inner lists only; the page itself scrolls natively (D18), so the browser's keys, find-in-page
  and scroll restoration work unaided.

**Button states, without touching `ui/button.tsx`** (owner, 2026-09-23: "some buttons have no
hover or active effect"). In `globals.css`, `@layer components`: the `default` variant hovers at
85% `--primary` (stock only hovers it as a link), a menu trigger (`aria-haspopup`) presses 1px
like every other button (stock skips it), and a button's icon turns −6° and grows ×1.15 over
150ms on hover, TheAtlas's sidebar motion (`packages/@ui/.../appbar/nav-item.tsx`). Since
2026-09-27 (owner: controls answer the hand) every button also sinks to ×0.97 while pressed, a
menu or palette row's leading icon steps 2px towards its label while highlighted, and
Settings' *Saved* fades up into place. None of it under reduced motion or with Animations off. And Mürekkep's `--muted` is `--ink-hover`, as Kâğıt's already was: it was
`--ink-card`, so the ghost button's `hover:bg-muted` vanished on every card surface (vault ADR
0016, fix the token, not the variant). Filter pills sit on `bg-muted` and got a shade lighter.

**The destructive and outline buttons, without touching `ui/button.tsx`** (D21, measured in
[Contrast](#contrast)): the destructive label is `--foreground`, its icon and a solid edge are
`--destructive`; the outline edge is `--input` in both themes; a focused destructive or outline
button's edge turns gold. Unlayered in `globals.css`, because the variants' own utilities
outrank `@layer components`.

**Tooltips follow the theme** (owner, 2026-09-27): stock shadcn inverts them (a foreground
fill); `globals.css` gives `[data-slot=tooltip-content]` the popover's fill, text and hairline
edge, `text-meta`, and hides the arrow. `ui/tooltip.tsx` is untouched.

**Settings save on change, text on Save** (ADR 0033, superseding 0022). A switch, select or
picker saves its key the moment it changes (`useSection().put`), and a refusal puts it back.
Text and number fields wait for the section's Save, disabled until one changed. A section with
nothing to type shows no Save, only *Saved* and any error.

**Ported, not generated:** `src/components/typewriter.tsx` is TheAtlas's, copied verbatim. It is
not a shadcn file and is never regenerated; it is re-copied from upstream.

---

### Punished players

A punishment moves a queued player out of their team or waiting into **Punished** (0020, owner
2026-09-27): the Queue tab's *Punished* pill lists them, each row edged in dashed warning and
tagged with what is left (*Punished, 2 games left* or *Punished until 21:40*). Their moves are
disabled, never hidden; the menu offers *Lift punishment*. When it ends (its time, its games, lifted
or deleted) they return to waiting at their place, or at the end of waiting if a team lost them. A
ban removes the player from the queue; Undo brings them back. Games are served by recorded games
(Victory, D27); until Victory exists a fresh draw still counts one.

## Do and don't

**Do**

- Reach for the semantic token, so both themes come for free.
- Keep gold scarce: the wordmark, focus, selection, the subscriber and protected tags, warnings.
- Give every row its `row-edge` outline and a 6px gap.
- Write state as a word *and* a colour.
- Give every text role its selection pair; make chrome `select-none`.
- Design loading, empty, error and offline for every view.
- Size a heading up before weighting it up.
- Put a new string behind a label key, in both languages, in the same commit.

**Don't**

- **Don't use a circle dot, in any design** (owner, 2026-09-27, hard rule): not for live, rank,
  status, bullets or separators. A dot is the stock shortcut; use the layout's own language
  instead: an icon that names the thing (`Radio` for live), the row's 3px edge in small (the
  rank's tier mark), an icon per list point. Avatars and the switch thumb are round, not dots.
- **Don't let an in-page jump land under the top bar** (owner, 2026-09-27, hard rule): `html`
  carries `scroll-padding-top` = the sticky bar (61px) + 20px, and scrolls smoothly unless
  reduced motion is asked for. A page with a taller sticky header raises it.
- Don't write a hex literal or an arbitrary `text-[…]` size in a component.
- Don't use teal or orange for anything but a team, or red for a team.
- Don't show a shortcut hint outside the menus (row, page, toolbar) and the command palette.
- Don't toast an event that came from chat.
- Don't ask "are you sure?" for a single-player action Undo can reverse; bulk and moderation
  actions ask ([Undo, and a confirm](#undo-and-a-confirm-for-the-big-ones)).
- Don't bold a serif heading, set a heading in sans, or set a name in mono.
- Don't replay the entrance on tab switches, realtime updates or overlay reloads.
- Don't put two primary buttons in one view.
- Don't nest `bg-card` inside `bg-card`.
- Don't use an alpha of `--foreground` as a surface or a border.
- Don't load fonts from a CDN.
- Don't translate or rename "TheAtlas Queue".

---

## Checklist for a new screen

1. Does every colour come from a semantic token, and every size from a named `text-*`?
2. Exactly one `primary` action?
3. Every row: `border-row-edge rounded-xl`, 6px apart, `bg-row` on the floor, `bg-background` in a
   card?
4. Body ≥7:1, secondary ≥4.6:1, outlines and focus ≥3:1, on the surface they actually land on?
5. Every text role has a `selection:` pair; every control is `select-none`?
6. No shortcut hints on the page; row keys only on a focused row?
7. Every string behind a label key, in `en` and `tr`?
8. Loading, empty, error and offline each designed?
9. Entrance runs once, capped at 12 rows, gone under reduced motion; `Typewriter` only on the
   introducing line and the draw reveal?
10. Works at 375px with 44px targets and no hover?
11. Title from the template, description, canonical, and the right `robots` for the route?
12. Checked in both Mürekkep and Kâğıt, not assumed from one?

---

## Related

[`CLAUDE.md`](../CLAUDE.md) · [`src/app/globals.css`](../src/app/globals.css) ·
[`components.json`](../components.json) · TheAtlas `docs/DESIGN.md` (the family system this one
derives from) · [Google Search Central](https://developers.google.com/search/docs) ·
[Next.js Metadata API](https://nextjs.org/docs/app/api-reference/functions/generate-metadata)
