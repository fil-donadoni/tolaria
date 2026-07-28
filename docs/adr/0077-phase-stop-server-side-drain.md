# 0077 — Phase Stops drain server-side: preferences out of `GameState`, one engine predicate built on the Expected Input

## Status

Accepted. Design record for issue #1777 (T1 of PRD #1776, "cut Convex function
calls and read bandwidth"). Depends on ADR 0047 (Expected Input as the single
authoritative declaration of what the game is waiting for). The implementation
lands in #1777; this record fixes the decisions it builds on, which were
resolved in a design session before any code was written.

## Context

`useAutoPassPhases` (`src/hooks/useAutoPassPhases.ts`) fires **one
`passPriority` round-trip per skipped phase**. With the default Phase Stops
(`DEFAULT_SKIP_PREFS`, `src/lib/skip-phase-prefs.ts`) that is UPKEEP → DRAW →
BEGINNING_OF_COMBAT → FIRST_STRIKE_DAMAGE → COMBAT_DAMAGE → END_OF_COMBAT →
END_STEP, for both seats: ~14 mutations per turn, each costing a full read +
write of the `gameStates` row (~7 KB each) plus a `getPublicState`
re-execution per open subscription. Measured across the deployment this is the
single largest contributor to both function-call count and read bandwidth —
expected saving −45/55%.

The server already knows how to drain: `drainAutoPasses`
(`convex/gre/phases.ts`) loops the pass while the new priority holder is in
`state.autoPassPlayers`. But `autoPassPlayers` carries only the _rest-of-turn_
**Pass Turn** intent. The per-phase, per-side **Phase Stop** preferences live in
`localStorage` and are therefore invisible to the server, so every skipped
phase pays a full round-trip.

Making them server-visible looks trivial and is not: the naive shape (put the
preferences on `GameState`, reuse the client's `computeAutoPassBlocked`
predicate, let the drain treat a Phase Stop like a Pass Turn) is wrong in three
independent ways, each of which this record decides against.

## Decision

### 1. Phase Stop preferences live OUTSIDE `GameState`, in a per-game table

A new `gamePrefs` table keyed by `(gameId, playerId)`. On the mutation path the
row is loaded and hung on a **transient** `state.seatSkipPrefs` key —
registered in `TRANSIENT_KEYS`, never in `PERSISTED_OPTIONAL_KEYS` — so
`drainAutoPasses` stays a pure synchronous function reading `state`, while the
stored `gameStates` row does not grow by a single byte.

Rejected: `GameState.seatSkipPrefs` persisted in the row (the shape the issue
originally proposed). The `gameStates` row is the hottest object in the system
— read and written by every mutation and re-projected to every subscriber — and
a sibling ticket (#1780) exists purely to _shrink_ it. Growing it by ~300–400
bytes to enable a bandwidth saving is self-defeating, and it would have forced
#1777 and #1780 to serialize on `serialize.ts`.

Rejected: keying by `userId` instead of `gameId`. Conceptually cleaner (a
preference belongs to the user, not the game; one row, no lifecycle, no
cascade delete) but in vs-AI both seats resolve to the _same_ user, so the bot
seat would inherit the human's preferences. Fixing that requires reading the
`games` document to identify the bot seat — a read `passPriority` does not
currently do, in the majority game mode. The per-game key avoids it: the bot
seat's row is **seeded at vs-AI game creation**, so decision 4 below is
materialized as data instead of a conditional branch. Cleanup is the cron sweep

- `deleteMatchCascade`, the same four lines #1778 adds for its tick row.

Rejected: storing the preferences on the `games` document to piggyback on an
already-fetched doc. The premise is false — `passPriority` never reads it
(`assertCallerOwnsSeat` works purely on the string handle).

### 2. ONE engine predicate, built on `computeExpectedInput` — not a lift of the client's

`convex/gre/autoPass.ts` exports `autoPassBlocked(state, playerId)`, layered on
`computeExpectedInput` (ADR 0047) plus the rules that are UX rather than CR:

```ts
const ei = computeExpectedInput(state); // ADR 0047 authority
if (ei?.kind !== "priority") return true; // over, choice, target, blockers, taxes
if (ei.playerId !== playerId) return true;
if (state.stack.length > 0) return true; // never skip a response window
if (isSelectingAttackers(state)) return true; // gap 1 in computeExpectedInput
if (isDamageStepOpen(state)) return true; // gap 2
if (state.pendingCast || state.pendingActivation) return true;
return false;
```

`src/lib/priority.ts` re-exports it — the same shape already used for
`computeSoloViewerId` (which lives in `convex/soloViewer.ts` precisely so the
server projection and the client board cannot diverge).

Rejected: lifting the client's `computeAutoPassBlocked` into the engine, as the
issue proposed. That predicate is strictly _poorer_ than `computeExpectedInput`
— it knows nothing of `pendingAttackSacrifice` or `pendingAttackManaTax`
(Flooded Woodlands, Propaganda). The gap is observable in `main` today: with a
Phase Stop cleared on `DECLARE_ATTACKERS`, the client believes it holds
priority during an attack tax, fires `passPriority`, the server rejects it, and
`useAutoPassPhases` swallows the error in an empty `.catch()`. Lifting the
predicate as-is would have fossilized that hole inside the engine.

The two conditions `computeExpectedInput` does _not_ encode — unconfirmed
attackers, and an open damage step, both of which fall through to its
`{ kind: "priority" }` default — plus the stack-empty rule are added here and
documented in one place, rather than duplicated across three.

### 3. A Phase Stop is STRICT; a Pass Turn stays permissive

The drain's new arm continues **only** when `autoPassBlocked` is false. It never
inherits the Pass Turn behaviours: no resolving the stack, no auto-confirming
attackers, blockers or damage.

The two intents are genuinely different and were conflated under one glossary
term ("Auto-Pass"), now split into **Pass Turn** and **Phase Stop** in
`CONTEXT.md`. Pass Turn means "I yield the rest of this turn" and legitimately
gives up response windows. A Phase Stop means "don't stop me in upkeep" — a UI
convenience that must never skip a window the player would have wanted. Without
the split, an opponent casting a spell in your upkeep would have the drain blow
straight through your response window, and a stop cleared on `DECLARE_ATTACKERS`
would auto-confirm an empty attack.

Structural consequence worth recording: because the strict predicate already
implies the stack is empty and no turn-based decision is open, the three
auto-confirm blocks inside `drainAutoPasses` are **unreachable** via the Phase
Stop arm. The change is therefore one flag in the loop's break condition and
nothing else:

```ts
if (!autoPass.includes(state.priorityPlayerId) && !singleShot && !perPhaseSkip)
    break;
```

### 4. A seat with no client gets the default Phase Stops

The vs-AI bot seat has no browser and will never call `setSkipPrefs`. With the
safe fallback (decision 5) it would stop the drain at every one of its own
windows, halving the saving in what is likely the majority game mode. Its row is
therefore seeded with `DEFAULT_SKIP_PREFS` at game creation — symmetric with a
human on empty `localStorage`, and the defaults already protect the bot: main
phases have `self: false` (it keeps its windows for lands and spells), the
declare steps are not in the defaults at all, and `END_STEP` has
`opponent: false` (it keeps the opponent's end-step window).

Accepted trade: the bot loses the ability to _proactively_ cast an instant in
the opponent's upkeep or draw with an empty stack. Its genuinely reactive plays
happen with something on the stack, where the strict predicate stops the drain
regardless. Reversible by changing one constant.

### 5. Absent preferences degrade to "do not skip"

A missing or stale row never means "skip". A failed sync must lose the
optimisation, never a window the player asked to stop at.

### 6. Hydration happens in `passPriority` only

The transient key is populated in `passPriority`, not in the shared
`getLatestGameState` loader and not across all ~20 `drainAutoPasses` call sites.

Rejected: hydrating in `getLatestGameState`. Queries share that loader,
including `getPublicState` — it would add a DB read to every subscription
re-execution, which is the exact cost this PRD exists to remove.

Rejected: wiring all ~20 draining handlers. Twenty sites to maintain, one
forgotten site being a silent behavioural inconsistency ("skips when I pass,
doesn't skip when I submit a choice").

The arithmetic makes the narrow choice nearly free: a run of skipped phases
almost always _starts_ from a `passPriority` — including the start of a turn,
whose phase entry happens inside the preceding `passPriority`, which is already
hydrated. The only runs left uncollapsed are those opened by a different
mutation (a spell resolving and emptying the stack in the opponent's end step),
which cost **one** extra round-trip to start the run before the client's
`passPriority` drains the rest. One mutation per run instead of seven. The
helper is written so widening to more sites later is a single line, once the
real saving has been measured.

## Consequences

- `setSkipPrefs` writes `gamePrefs`, never `gameStates`: no `seq` bump, no
  subscription fan-out. The client calls it on change and once on game entry;
  in solo and vs-AI it writes **both** seat ids, or the drain breaks every time
  priority reaches the non-viewer seat.
- `useAutoPassPhases` stays as the boundary fallback and needs no change: only
  the priority holder ever fires it, so the server drain and the client cannot
  double-fire.
- The UI vocabulary is inverted relative to storage — the toggles read "Stop
  on…" while the stored boolean means _skipped_, negated at exactly one site
  (`controller-phase-row.tsx`). Server-side code must use the stored sense
  (`isPhaseSkipped`).
- `computeExpectedInput` runs once per drain iteration (bounded at 50). It is
  pure and cheap; if it ever shows up in a profile, cache it and refresh after
  `advancePhase`.
- The 50-iteration safety bound in `drainAutoPasses` is unchanged.
