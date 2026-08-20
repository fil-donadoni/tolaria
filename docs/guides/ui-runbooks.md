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

## Lobby, deck builder and the Limited lists (2026-08-19)

The four routes that need no fixture beyond a signed-in account. Each is one
navigation:

| Route             | Screen                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `/`               | Lobby — PLAY box, PRESET DECKS / MY DECKS, the active-game banner when one is running         |
| `/decks/create`   | Constructed deck builder (`/decks/<slug>/edit` is the same component in edit mode)            |
| `/limited`        | Limited events list — YOUR CURRENT EVENTS plus `+ Create Event`                               |
| `/limited/events` | Your-events page (#2357); a STATIC sibling of `/limited/$eventId`, so it never gets swallowed |

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

## Reach the Limited deck builder (2026-08-17)

The pool builder is where a Sealed/Draft pool becomes a deck, and it is the
screen the mobile-occlusion bug lives on.

1. `navigate_page` → `http://localhost:5173/limited`
2. Under YOUR CURRENT EVENTS, click `View` on the event. The route becomes
   `/limited/<eventId>`.
3. Click `Build Deck` (in the "Your Pool is ready" box). The route becomes
   `/limited/<eventId>/build`.

The build screen carries: ADD BASIC steppers, `Maindeck N` with
All/Creatures/Non-creatures + colour filters, `Pool (Sideboard) N` with the
same, a curve strip, and a fixed footer with the legality verdict, the deck
name field and `Done`.

No event in the list? A new one is `+ Create Event` on `/limited` — that flow
is not written up yet.

## Reach the Draft Room (2026-08-20)

Since issue #2587 the pick screen is its OWN immersive route,
`/limited/<eventId>/draft` — it is no longer part of the event detail page.

1. `navigate_page` → `http://localhost:5173/limited/<eventId>`. While a Pick
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
`Leave the draft` / `Settings`. The Pick Timer is the full-width bar directly
under it. At tablet/desktop widths the body is a `[data-slot=draft-split]`
pack | pool split; both phone regimes keep the stacked layout.

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
