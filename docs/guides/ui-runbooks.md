# UI runbooks

**Click sequences that get you to a screen.** Read a runbook instead of
rediscovering the navigation — the rediscovery costs a dozen snapshots and it
gets the branches wrong (the single-active-game guard, the coin toss, the
per-seat mulligan).

How to drive the browser at all, and what to measure once you arrive:
[Browser verification](browser-verification.md). Everything below assumes the
CDP tools from that guide and `bun run dev` already listening on 5173.

Every runbook here was executed against `main` on the date in its heading. A
sequence nobody has run is not in this file — see [What is not written
yet](#what-is-not-written-yet).

**Several of these are executable.** `scripts/ui-gate/surfaces.ts` is the
machine copy of the walks `bun run check:ui` drives (issue #2580). When a
sequence here changes, change that file in the same PR — a drifted walk shows
up as an `UNWALKED` surface and a red lane, which is loud but points at the
wrong thing.

## Conventions

`snapshot` means `take_snapshot`, whose uids the next `click` consumes. Pass
`includeSnapshot: true` on a click that changes the screen and you get the
next tree without a second round trip — that is the difference between a
6-call runbook and a 12-call one.

The uids in this file are illustrative. Read them from your own snapshot; they
are per-session.

## Start a solo game from cold (2026-08-17)

A solo game is one user driving both seats, the viewer following priority. It
is the default for any gameplay check.

1. `navigate_page` → `http://localhost:5173`
2. `snapshot`. Branch on what the lobby says:
    - "You have an active game in progress" → see [Blocked by an active
      game](#blocked-by-an-active-game-2026-08-17) below, then come back.
    - otherwise continue.
3. Click `Select` on the deck row you want, under PRESET DECKS or MY DECKS.
   The PLAY box then names the deck instead of "No deck selected", and
   `Solo Game` becomes enabled.
4. Click `Solo Game`. The route changes to `/game` and the coin-toss dialog
   opens.
5. Click `Play` (or `Draw`). The toss is decided server-side; the dialog only
   asks the winner to choose.
6. Mulligan prompt, **once per seat**. Click `Keep` for the first seat; the
   viewer auto-switches to the other seat and the prompt reappears — click
   `Keep` again.
7. `snapshot`. `YOUR GO` plus `Pass` / `Pass Turn` buttons means the board is
   live and priority is with the seat you are viewing.

Do not set `tolaria:selectedDeckId` by hand to skip step 3. Preset decks are
DB rows now (#770/#1455) and the old slugs (`mono-red-burn`, `le-deck`, …) no
longer resolve — a stale id is silently cleared by the lobby and you land back
on "No deck selected", having spent a navigation to learn it.

### Blocked by an active game (2026-08-17)

One active game per user is a server guard (#155), so the PLAY buttons are
disabled until the current one ends. The lobby offers `Resume` and
`Concede Match`.

- Want the game that is running? `Resume`.
- Want a fresh one? `Concede Match` → a confirm dialog titled "Concede match?"
  → click its own `Concede Match` button. **This ends the match as a loss and
  cannot be undone**, so it is the user's call, not yours: ask before
  conceding a game you did not create in this session.

After the dialog closes the lobby drops the banner and the PLAY buttons
re-enable (still needing a deck selected).

**Already inside a game?** Do not route back through the lobby. Debug panel →
`Restart Solo` reuses the current deck and deals a fresh solo game in one
click. `New vs-AI Game` is the same shape for a bot opponent.

## Load a debug scenario (2026-08-17)

Scenarios are DB rows, not code (ADR 0044) — the panel lists whatever the
deployment has.

1. From a live board: click `Debug ▼` (bottom-left of the dev rail).
2. Click `Scenarios`. The list expands **inline** — no dialog — with a
   `Search scenarios…` field, 65 rows on this deployment, each row a button
   labelled with the scenario, plus `★` favourite, `✎` edit, `×` delete.
3. Click the row. The board reloads into that position.

The same panel carries `Reset Game`, `Copy State`, `Show all cards`,
`All actions`, `Bo3 Sideboarding` and `Verbose`. Avoid `Clear Storage`: it
forces a full reload and drops you at the lobby mid-sequence.

To add a scenario, use the panel's own save form (label + spec) — a DB insert,
never a code edit. Headless agents do not insert: they emit `{ label, spec }`
in the PR receipt and the orchestrator seeds it post-merge.

## Sign in from cold (2026-08-19)

Every route is behind `<AuthGate>`, so a fresh browser profile lands on the
sign-in Panel, not on the lobby.

1. `navigate_page` → `http://localhost:5173`
2. Fill `input[type=email]` and `input[type=password]` — the fields carry no
   id or `data-testid`; the `type` attribute and the visible `Email` /
   `Password` labels are the handles.
3. Click the submit button (`Sign In`). The email field detaching is the
   signal that the gate opened; the lobby renders behind it.

Credentials are **not** in the repo. `bun run check:ui` reads them from
`TOLARIA_UI_EMAIL` / `TOLARIA_UI_PASSWORD` (environment, else the gitignored
`.env.local`); a human uses whatever dev account they created.

**Do not carry a session between browser contexts.** Convex auth rotates its
refresh token on use, so a Playwright `storageState` captured in one context
is already spent when a second context loads it — the second context lands
silently back on the sign-in form. Sign in per context.

## Reach the password reset screens (2026-08-24)

The auth screens are the one part of the app a signed-in session can never
see, so `check:ui` walks them on the signed-out page BEFORE it signs in
(`Surface.preAuth` in `surfaces.ts`). By hand, the same order applies: reach
them from a cold profile, or the gate will have opened first.

**Step 1 — ask for a code** (lane surface `auth-forgot-password`):

1. `navigate_page` → `http://localhost:5173`, land on the sign-in Panel.
2. Click `Forgot password?`. It is the third control in the Panel footer,
   below `No account? Sign up`, and it appears on the sign-in flow only —
   the sign-up flow has nothing to reset yet.
3. The credentials form is replaced, not covered: the `Reset Password` Panel
   carries one `input[type=email]` and a `Send Code` submit.

**Step 2 — enter the code** (NOT walked by the lane):

4. Submit a real account's address. Reaching step 2 needs a live
   `flow: "reset"` round-trip, which mints an OTP and spends a real Resend
   send — which is why the lane stops at step 1 rather than doing it five
   times per run.
5. Read the 8-digit code out of the email and paste it. The grouping the
   email renders (`1234 5678`) is stripped client-side; the server only ever
   stored the digits.
6. Fill `New password` and `Confirm new password`, submit. On success the
   user is signed in on the spot and `<AuthGate>` swaps the whole screen for
   the lobby — there is no success state to screenshot.

An address with **no account** still advances to step 2 and shows the same
"if an account exists…" notice. That is deliberate (anti-enumeration), not a
bug to reproduce: no code is coming.

Behaviour for both steps is covered by
`src/components/auth/__tests__/forgot-password-form.test.tsx`.

## Lobby, deck builder and the Limited list (2026-08-20)

The three routes that need no fixture beyond a signed-in account. Each is one
navigation:

| Route           | Screen                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`             | Lobby — PLAY box, PRESET DECKS / MY DECKS, the active-game banner when one is running                                                                                                               |
| `/decks/create` | Constructed deck builder (`/decks/<slug>/edit` is the same component in edit mode)                                                                                                                  |
| `/limited`      | Limited events list (issue #2590) — status chips (open/drafting/building/playing/done) + a "Mine" toggle over the union of open events and every event the viewer has ever sat in, `+ Create Event` |

**`/limited/events` is a redirect stub, not a screen** (issue #2590): the
your-events page it used to render was absorbed into `/limited` behind
`?mine=1` — navigating there lands on `/limited?mine=1` after one render
frame. It stays a STATIC sibling of `/limited/$eventId` for route precedence
(`src/routes/__tests__/router-limited-precedence.test.ts`), so it is still
worth walking to prove the redirect actually fires, just not as a distinct
visual surface.

There is no `/settings` route, and the admin surfaces live under `/admin/*`
behind `AdminRouteGate` (a non-admin gets the 404 page, indistinguishable from
an unknown path).

## Design system census and the GameDialog demo (2026-08-19)

The permanent v3 census (ADR 0101) and the lane's only MODAL row (#2581).

| Route                  | Screen                                                                     |
| ---------------------- | -------------------------------------------------------------------------- |
| `/admin/design-system` | Design system census — tokens, chrome, component variants, §14 = v3 tokens |

**It is `/admin/design-system`, not `/design-system`** — the census moved under
`/admin` with the other curation surfaces. The top-level path 404s, and the 404
page renders its own `main`, so a walk that asserts `main` measures the
not-found screen and reports a green: assert the `Design system census` heading
instead. Measured exactly that failure while writing the walk.

To reach a real dialog without touching a live game: open
`/admin/design-system`, scroll to §08 Modal languages, and click the FIRST
`Open live demo` (specimen **A · GameDialog**; B is the plain shadcn dialog, C
the ActionSheet). Every in-game dialog is a `GameDialog`, so this is the Panel
frame under measurement. With the dialog open, 10-12 controls behind the scrim
measure as occluded — that is what a modal is, not a defect.

## The seeded Limited fixture the lane walks (2026-08-26)

`bun run check:ui`'s Limited and Draft surfaces do **not** walk whatever event
this deployment happens to hold. They address two SEEDED events by label
(issue #2822) — because `listOpenLimitedEvents` returns every open event on the
deployment to everyone, so both the row count of `/limited` and which seat the
Draft Room walks measured used to be functions of the account's own data, and
`budgets.json` rotted with no `src/` change.

| Label           | Shape                                                                           | Serves                                                              |
| --------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ui-gate/open`  | Draft event, seating still OPEN, viewer at seat 0, no pools                     | `limited-antechamber`                                               |
| `ui-gate/draft` | Draft event, `started`, viewer at seat 0 with a 15-card pack and a 24-card pool | `draft-pick`, `draft-pool-stop`, `draft-pool-peek`, `limited-build` |

Seed (or re-seed — it is an upsert by label, and the rows are deployment-local,
nothing in git):

```bash
bunx convex run limitedFixtures:seedUiGateFixtures '{"email":"<TOLARIA_UI_EMAIL>"}'
```

Addressing it by hand:

- `/limited?label=ui-gate/` — the list, narrowed by a **prefix** match on the
  event's `label` to exactly the fixture rows. No product control produces this
  URL; it exists so the two list surfaces measure a row set the lane fixes.
  `/limited/events?label=ui-gate/` carries the same filter through the redirect.
- `[data-limited-event-label="ui-gate/draft"]` — the row's own handle in the
  DOM (`limited-event-list-item.tsx`); click the `View` button inside it.
  A player-created event has no `label` and therefore no attribute.

`ui-gate/open` is OPEN specifically because that is the one event state whose
detail page neither redirects into the Draft Room (`useDraftRoomRedirect` needs
a pending pick) nor auto-opens the deck builder (`useAutoOpenLimitedBuilder`
needs a final pool). Both of those are **one-shot per tab**, so any fixture
that tripped one would land on the antechamber at some viewports and on a
different screen at others.

The fixture's cards are pinned BY NAME in `convex/limitedFixtures.ts`, not
dealt by `startDraft`: a seeded deal is only as stable as the set's implemented
card list, which grows every time a card ships.

## Reach the Limited antechamber (2026-08-20)

The event detail page (issue #2590): a compact avatar row (who is sitting
where) plus the actions the event's phase makes actionable — Join / Leave /
Start / Cancel-or-Close, and the Share/Copy link. The full per-seat detail
(pool counts, pack-passing direction) is no longer inline — it opens as the
Table Ring dialog.

1. `navigate_page` → `http://localhost:5173/limited?label=ui-gate/open`
2. Click `View` inside `[data-limited-event-label="ui-gate/open"]`. The route
   becomes `/limited/<eventId>`. (Any event row works by hand; the LANE walks
   the fixture, for the reasons in the section above.)
3. `snapshot`. The avatar row sits above a `View Table` button — click it to
   open the Ring dialog (`title="The Table"`), then close it (`Escape` or the
   `✕`) to confirm the antechamber underneath is unaffected.

A seated Draft event redirects here straight past to the Draft Room while a
Pick is pending (`useDraftRoomRedirect`, see below), and a seat whose pool is
FINAL with no deck yet gets sent to the builder (`useAutoOpenLimitedBuilder`) —
which is why the fixture for this surface is an event whose seating is still
open.

## Reach the Limited deck builder (2026-08-17)

The pool builder is where a Sealed/Draft pool becomes a deck, and it is the
screen the mobile-occlusion bug lives on.

1. `navigate_page` → `http://localhost:5173/limited?label=ui-gate/draft`
2. Click `View` inside `[data-limited-event-label="ui-gate/draft"]`, and read
   the `<eventId>` off the URL.
3. `navigate_page` → `http://localhost:5173/limited/<eventId>/build`.

The builder needs only a dealt, non-empty pool (`pool-deck-builder.tsx`), so a
MID-DRAFT seat reaches it by URL — that is how the lane walks it, and it is
what took `limited-build` out of `unwalked` in issue #2822. From an event whose
pool is FINAL there is also a `Build Deck` button in the "Your Pool is ready"
box on the event page (`Edit Deck` once a deck exists).

The build screen carries: ADD BASIC steppers, `Maindeck N` with
All/Creatures/Non-creatures + colour filters, `Pool (Sideboard) N` with the
same, a curve strip, and a fixed footer with the legality verdict, the deck
name field and `Done`.

No fixture on this deployment? Seed it with the command in the section above.
A real event is `+ Create Event` on `/limited` — that flow is not written up
yet.

## Reach the Draft Room (2026-08-20)

Since issue #2587 the pick screen is its OWN immersive route,
`/limited/<eventId>/draft` — it is no longer part of the event detail page.

1. `navigate_page` → `http://localhost:5173/limited?label=ui-gate/draft` and
   click `View` inside `[data-limited-event-label="ui-gate/draft"]` (that is
   what the lane does — see "The seeded Limited fixture the lane walks"), or go
   straight to `http://localhost:5173/limited/<eventId>`. While a Pick
   is pending, a seated player is redirected straight to
   `/limited/<eventId>/draft`. That redirect is **one-shot per event per tab**
   (`sessionStorage` key `tolaria:limited:draftRoom:<eventId>` — clear it to
   get the redirect back), so on a second visit the event page stays put and
   offers `Enter the Draft Room →` instead. Either way you end up on the same
   route; you can also navigate to it directly.
2. `snapshot`. The pack renders as buttons labelled
   `Draft pick: <card name>`, each `roledescription="draggable"` (drag or
   keyboard: space to lift, arrows to move, space to drop). Arrows / Enter /
   `S` also pick without touching a tile: arrows move the Selected Card,
   Enter picks it, `S` picks it to the sideboard.

The room's own thin bar (`[data-slot=draft-room-bar]`) is the only chrome —
the route is registered `ownChrome`, so there is no shell header and no Event
back-link. It carries `Pack n/N`, `Pick #n · N left`, the passing direction, a
waiting-pack dot, `Table` (the Table Ring dialog: seats, picks made, passing
arrows, you at the bottom), `Pool` (the pool toggle) and an overflow with
`Leave the draft` / `Settings`. At tablet/desktop widths the body is
stacked — the Booster grid full width on top (with the Pick Timer as the
full-width bar directly above it) and the Pool, in its own scrolling band
(`[data-slot=draft-stacked-pool]`), underneath.

### The two phone snap stops (issue #2588)

On a phone the body is `[data-slot=draft-snap-scroller]` — one scroller,
`scroll-snap-type: mandatory`, holding the two `[data-slot=draft-pane]`
elements (`data-pane="pack"` then `data-pane="pool"`). Its
`data-orientation` is `portrait` or `landscape` and its `data-stop` is
`pack` or `pool` — read `data-stop` rather than guessing from a screenshot.

**Exactly two scroll positions are reachable**, `0` and the scroller's own
maximum. Assert it rather than eyeballing it:

```js
const s = document.querySelector("[data-slot=draft-snap-scroller]");
// portrait: two 85% panes ⇒ max = 0.7 × clientHeight
[s.scrollTop, s.scrollHeight - s.clientHeight, s.clientHeight];
```

Click sequences, both orientations:

1. **Swipe to the pool** — click `[data-slot=draft-strip-drop][data-zone=maindeck]`
   (portrait: the left half of the pool strip along the bottom edge;
   landscape: the sneak-peek column on the right). `data-stop` becomes
   `pool`. Programmatic scrolling works too, but the tap is what a player
   does — and note the AXIS: portrait scrolls `top`, landscape `left`
   (`useDraftSnapStops.ts`), so `scrollTop` on a landscape scroller reads a
   range of `0` and looks like a surface that never laid out.
2. **Back to the pack** — `[data-slot=draft-back-to-pack]`, in the pack's
   status bar (portrait) or the collapsed pack column (landscape).
3. **Pick to the sideboard by drag** —
   `[data-slot=draft-strip-drop][data-zone=sideboard]` is the SB half of the
   strip / the SB box under the sneak-peek pile. A drop there commits the
   Pick and parks it in the Sideboard in one gesture.
4. **The CTA row** — tap a pack tile to select it, then
   `[data-editing-action="Pick"]` / `"→ Side"` / `"Inspect"` inside
   `[data-slot=draft-pack-status]` (portrait) or
   `[data-slot=draft-sneak-peek]` (landscape). The Peek Panel is deliberately
   NOT mounted on a phone — the strip is the peek bar, so
   `[data-peek-panel]` is absent there and the surface reserves nothing.
5. **Grid density** — `[data-slot=draft-density-toggle]` flips the Booster
   between `3×5` / `8×2` and `4×4`; the grid's own `data-columns` follows.

Other landmarks: `[data-slot=draft-pool-count]` / `-sideboard-count` (the
strip's live counts), `[data-slot=draft-card-pile]` with `data-count` (the
Arena-style pile — `aria-hidden`, so it is excluded from the probe's card
census by design), `[data-slot=draft-pack-status][data-pulsing=true]` (a pack
landed while the player was parked on the pool), and `[data-draft-chevron]`
with `data-animated` (absent under `prefers-reduced-motion: reduce`).

`bun run check:ui` walks this route THREE times — `draft-pick` stops at the
pack stop, `draft-pool-stop` runs step 1 and probes there (off a phone it
scrolls the stacked arrangement's Pool band to its end instead), and `draft-pool-peek`
(issue #2667) goes one gesture further: from the same pool stop it taps the
first Pool card tile (`[data-card-tile][title^='Remove ']` inside
`[data-slot=draft-pool]`) and probes with the Pool's own `DeckZonePeek`
(`[data-peek-panel]`) mounted — the state no walk reached before #2667, on
every one of the five viewports including the two phone ones the issue's AC
names (390x844x3 / 844x390x3). All three call `assertTwoSnapStops`, which
drives the real scroller through eleven offsets and reds the lane unless
exactly `{0, max}` rest.

**Fixture requirement for `draft-pool-stop` / `draft-pool-peek`: the seat
needs a non-empty pool.** `LimitedDraftPool` renders an `EmptyState` at
`pool.length === 0` — no `[data-slot=draft-pool]`, so the walk reports
UNWALKED and the run is red. That guard now covers **both** branches: the
phone branch asserts the pool pane after it confirms `data-stop="pool"`, not
just the stop (until PR #2652 round 3 it returned on the stop alone, so a Pick
#1 seat measured an empty pane at 390×844 and passed green — `probe.js` has no
card-count floor and `budgets.ts` no minimum-`n` rule, so nothing else would
have caught it). Make a few picks in the room first (select a tile,
`[data-editing-action="Pick"]`); the lane itself never picks, because a pick
is not reversible and this lane is non-destructive by construction.

A Sealed event opens the same route in **reveal mode**: no pack, no counters,
the dealt Pool plus `Build your deck →`.

An event whose status is `playing` shows the table, pairings and
`Build Deck` instead — the runbook above.

## Sweep a screen across viewports (2026-08-19)

**First try `bun run check:ui`** — it does the whole sweep, at all five
viewports, for every surface in `scripts/ui-gate/surfaces.ts`, and prints the
receipt. Do the manual sweep below only for a screen the lane does not walk.

1. `emulate { viewport: "1440x900x2" }` → walk the runbook → probe →
   screenshot.
2. `emulate { viewport: "390x844x3,mobile,touch" }` → probe → screenshot.
3. `emulate { viewport: "844x390x3,mobile,touch,landscape" }` → probe →
   screenshot.
4. `emulate { viewport: "820x1180x2,mobile,touch" }` → probe → screenshot.
5. `emulate { viewport: "1180x820x2,mobile,touch,landscape" }` → probe →
   screenshot.
6. `list_console_messages { types: ["error"] }`.

Five since ADR 0101 — the tablet pair is where the deck builders hid their
worst clipping. Emulation survives navigation, so set it once and re-walk the
runbook rather than re-emulating per step. The probe itself, and what its
numbers mean, are in [Browser verification](browser-verification.md#the-probe).

## Where client state is kept

`src/lib/session.ts` owns every key. Clearing `tolaria:gameId` +
`tolaria:playerId` is what forces a return to the lobby.

| Key                        | Holds                                            |
| -------------------------- | ------------------------------------------------ |
| `tolaria:gameId`           | active game id                                   |
| `tolaria:playerId`         | session player handle                            |
| `tolaria:selectedDeckId`   | lobby deck selection (a DB id — see the warning) |
| `tolaria:aiDeckId`         | vs-AI opponent deck; unset = mirror the human    |
| `tolaria:aiDifficulty`     | easy / medium / hard                             |
| `tolaria:matchFormat`      | `1` (Bo1) or `3` (Bo3)                           |
| `tolaria:deckFormatFilter` | deck-list Format filter, `all` or a FormatId     |

There is no player-name key: the nickname comes from the authenticated user.

## What is not written yet

Add a runbook after you run it, not before. Missing today: creating a Limited
event, the vs-AI setup dialog (difficulty + opponent deck), Bo3 sideboarding
between games, and the admin panels.

Creating a Limited event is the one that matters most right now: without an
event, `bun run check:ui` reports the Limited pool builder and the draft pick
screen as `unwalked`, and those two surfaces are exactly where the occlusion
bug that motivated all this lives.

## Two browsers, one of which does not work

Use the `chrome-devtools-mcp` plugin (CDP). The Claude-in-Chrome extension
cannot work in Arc — no `chrome.sidePanel`, so its per-site approval can never
be granted and every call times out. The reasoning is in [Browser
verification](browser-verification.md#the-tool-chrome-devtools-mcp-not-the-claude-extension).
