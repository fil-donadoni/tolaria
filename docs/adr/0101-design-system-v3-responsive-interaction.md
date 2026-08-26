# ADR 0101 — Design system v3: the responsive and touch interaction model (amends 0007, 0009, 0025, 0069)

**Status:** Accepted (2026-08-19) — PRD #2405, decision register D1–D30
(`tolaria-design-canvas/audit/revamp-decisions.md`), design canvas
<https://claude.ai/code/artifact/2ff0a0f7-54a6-4d44-b339-0b38e2b541e1>,
touch prototype on branch `prototype/touch-gestures` (`/prototype/touch`).

## Context

The 2026-08-19 viewport audit (#2405, 35 findings at 5 viewports) showed that
the UI is designed for one desktop width and degrades everywhere else: the
phone deckbuilder cannot reach its sideboard, a finger on a card starts a drag
instead of a scroll, the draft event chrome eats 86% of a landscape phone, the
card preview overflows 100dvh in landscape, the stats dialog overflows, the
Panel brackets overlap dialog titles, and the app shell spends 112px on a
framed header at every size. Three earlier ADRs each settled a piece of this —
0007 (tokens + universal Panel), 0009 (touch: long-press = preview, tap =
action sheet), 0025 (board: right column → bottom bar on portrait), 0069 (one
button / one banner / one modal) — but none settled a **system**: no density
scale, no fluid type, no pointer-aware control sizes, no breakpoint contract,
and a touch model that only ever considered the board (where nothing is
dragged) and was then inherited by the deckbuilder and the draft (where
everything is).

The user's constraint for this pass: it is the last substantial UI design pass
for a long time — decide once, record it, then implement.

## Decision

### 1. Viewport matrix (supersedes the three-viewport rule)

Every UI-affecting change owes a measured receipt at **five** emulated
viewports: `390x844x3,mobile,touch` · `844x390x3,mobile,touch,landscape` ·
`820x1180x2,mobile,touch` · `1180x820x2,mobile,touch,landscape` ·
`1440x900x2`. Semantic breakpoints align to the matrix. The rule lives in
`.claude/rules/chrome-debug.md` / `docs/guides/browser-verification.md`; the
headless gate that enforces it is the first implementation slice (#2512).

### 2. System refounded, identity kept (amends 0007)

Antique Bronze, the Panel, Beleren stay. What changes is the **system**
underneath: fluid type on `clamp()` (`--t-xs … --t-2xl`), a density scale
(compact / comfortable / roomy base units 8 / 10 / 12 px), pointer-based
control heights (coarse 44px, fine 32px), motion tokens with
`prefers-reduced-motion`, and a Panel whose frame cost is sized to the screen:
**10px inset brackets at 1px, opacity .5** (was 40px ornament), title left
with a 1px rule, footer right (stacked full-width on phone). A token test
keeps a title from ever sitting within 4px of a bracket. Rich ornament is
allowed only in waiting states — lobby hero, game over, match result — and
only above 844x390.

### 3. App shell: two modes

**Browse** (lobby, decks, limited list, profile): a 56px top bar on desktop /
tablet; on phone a bottom nav Play · Decks · Limited · Me with safe-area
padding, compact top bar in landscape. **Immersive** (board, Draft Room,
deckbuilder): no persistent nav, a contextual bar with an explicit Exit and an
overflow menu. A global return banner + nav badge points at an active game or
draft. One `AppShell` replaces the six chrome files.

### 4. Touch model on editing surfaces (amends 0009)

ADR 0009 keeps governing the **board** (tap = action / action sheet,
long-press 400ms = preview, peek/lock). On **editing surfaces** — Draft Room,
deckbuilder, search — where cards MOVE, the model is:

- **Tap = select + Peek Panel.** The Peek Panel (portrait: bottom sheet;
  landscape: right rail; tablet: fixed rail) shows the card and a **44px CTA
  row** (`→ Side` / `→ Pool` / `Move to…` / `Inspect`, or `Pick` / `→ SB` /
  `Inspect` in the draft). The CTA row is the **primary** move path on touch.
- **Long-press 250ms = drag** (prototype verdict, #G1 option A). A swipe that
  moves >10px before 250ms is a scroll. Drag targets: the zone tabs, the other
  zone's strip, AND individual MV rows / pile columns (bucket pinning). Mouse
  drags after 8px, unchanged.
- **Hold-preview is therefore gone on editing surfaces**; the inspect overlay
  opens from the CTA row (or hover on desktop). In the draft the overlay
  closes on a tap anywhere except `Pick`.
- Per-card overlay buttons (`Move to…`, `★ Featured`, drag grip on every tile)
  are removed.

### 5. Card preview / Inspect overlay (amends 0009, 0025)

`max-height: 100dvh` always. Landscape = art | scrolling text side by side;
portrait = stacked. A Live / Printed toggle (Oracle / Printed off the board),
and the surface's own actions in the overlay (board: Cast / Activate; builder:
`→ Side`, `Move to…`; draft: `Pick`, ‹ › to step through the row/column).

### 6. Draft Room

Own route `/limited/$eventId/draft`, immersive, no Event back-link during a
pick (overflow: leave / settings). Thin bar: pack n/3 · pick n/15 · direction ·
timer · waiting-pack dot · Table dialog · pool toggle. The Table Ring is an
Arena-style dialog, never a dominant page element.

**Phone portrait**: two snap stops, Pack 85 / Pool 15 ↔ 15 / 85
(`scroll-snap-type: mandatory`); the 15% strip is the live tab of the other
pane AND a drop target (its SB half = pick to sideboard); picks split Main /
Sideboard. **Phone landscape**: pack 80% | 20% **sneak-peek column** (the
picks as one Arena-style vertical pile, the actions bar under it); on swipe
the pack collapses to a vertical pile (20%) and the pool expands to MV
columns + a Sideboard column (80%). A very subtle animated chevron hints the
swipe; a pack arriving while parked on the pool pulses the strip and starts
the timer (auto-snap only if the timer is on and <10s). Tablet / desktop:
stacked — the Booster grid full width on top, the Pool with its Sideboard
rail beside it underneath, each scrolling in its own band so a long Pool
never pushes the Booster off screen (issue #2820; a #2646/#2588 side effect
had briefly turned this arm into the phone split's vertical split with a
preview rail — the pre-existing, correct arrangement is what ships). The
Sideboard box always shows its count when collapsed. Sealed uses the room in
reveal mode.

### 7. Deckbuilder

**Phone portrait**: three full-page swipe tabs Pool | Main | Side (tabs are
drop targets); the deck as **MV rows** with duplicates collapsed into one tile
with a `×N` badge, each row scrolling horizontally
(`overscroll-behavior-x: contain` so a row swipe never flips the tab); basic
lands in a sheet; a bottom bar with counts and a mini curve. **Phone
landscape**: MTGO pile columns (width is the abundant axis), Peek Panel as a
right rail. **Tablet / desktop**: the deck gets ≥60% of the height, toolbar
collapsed into the bar, filters in a popover, preview dock. **Filters**: a
bottom sheet on phone, a popover on tablet / desktop, and the applied filters
always render as a **tag row under the search bar**, each tag with `×`, plus
"Clear all". Stats dialog: fits 390px tall, real charts.

### 8. Board (amends 0025, 0069)

The 0025 contract stays for desktop / tablet / portrait; phone landscape is
reopened. In-game prompts stay **rounded panels** (the chamfered plate was
prototyped and rejected). The **stack on mobile reproduces the desktop rows**
verbatim — order badge, thumbnail, controller tag, targets / modes — as a
bottom sheet from the Stack chip in portrait and a right panel in landscape.
Edge states (full board, 10+ hand, deep piles) are measured with the seeded
`UI stress` scenario.

### 9. Limited flow and lobby

One `/limited` list with status chips and a "mine" filter (absorbs
`/limited/events`); the event page is an antechamber with a compact avatar
row; post-draft rounds / standings / Build / Play. Lobby: a resume card for
the active game, a **live Limited strip** (own in-progress event first, with
a primary CTA; open events joinable inline), the Play panel with a compact
selected-deck tile and an explicit **game-mode selector**, decks as compact
rows.

### 10. Game-mode labels

The two ways to play are labelled **Arena mode** (the GRE enforces the
rules — vs Bot, solo, multiplayer) and **Cockatrice mode** (a Manual Game: a
free table, any printed card, the players call the rules), each with a
three-line tooltip. These are UI labels; the domain terms stay **Game** /
**Manual Game** (CONTEXT.md). "Tabletop", "Rules enforced", "Classic" are
retired as labels.

## Considered options

- **Long-press = preview everywhere** (ADR 0009 as-is) — rejected on editing
  surfaces: it collides head-on with drag, the one gesture those surfaces live
  on; the audit's "finger on a card starts a drag instead of a scroll" is this
  collision. Prototyped against two-tap (no touch drag) and a drag handle on
  the selected card; long-press drag won on a real phone.
- **Stack as a pure text list** on mobile — rejected by the user; the desktop
  rows (thumb + text) are what mobile reproduces.
- **Chamfered prompt plate** (E33) — prototyped A/B, rejected; rounded panel.
- **Lenis smooth scroll** — rejected: it hijacks scroll and conflicts with
  scroll-snap and drag; a desktop-browse-only trial (#T1) stays parked.
- **Three viewports** — kept only the phone pair and desktop; tablet portrait
  and landscape have their own breakpoints and were where the deck builders
  hid their worst clipping.

## Consequences

- `/admin/design-system` becomes the living census of v3; the decision
  register and the canvas are the design record, this ADR the contract.
- Tests: a token test for the bracket / title clearance; the five-viewport
  headless probe in the gate; `shellShowsHeader` learns the Immersive set.
- ADR 0009 stays valid for the board only; its "Scope: all zones" line is
  narrowed by §4 here. ADR 0025's portrait contract stays; its landscape
  section is superseded by §8. ADR 0007's Panel frame is re-specified by §2.
  ADR 0069's "one modal" keeps the rounded panel (§8).
- Implementation is sliced as sub-issues of #2405, all P0, first slice = the
  headless five-viewport + axe gate so every later slice is measured against
  it.
