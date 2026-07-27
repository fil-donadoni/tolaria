# 0076 — Limited Event play phase: embedded in the event document, bot matches evaluated not simulated

## Status

Accepted. **Supersedes ADR 0055 decision 1** ("the Limited Event ends at the
built Deck; pairing, rounds and standings are deferred"). ADR 0055's decisions 2
(pool-as-sideboard) and 3 (server-side Bot Drafter) are unchanged and this
record depends on both.

Introduced by PRD #1628, first slice issue #1640 (schema + creation-time
configuration). The pairing algorithm, standings, bot-match evaluator and round
state machine land in later slices of the same PRD; this record fixes the
decisions they all build on.

## Context

ADR 0055 deliberately stopped the Limited Event at the built Deck: "pairing,
rounds and standings are deferred — they can be layered on top later without
touching the event's core." That narrowing shipped a usable v1, and the layering
prediction held (nothing below changes the draft or deckbuild core). But the
deferral also produced the two symptoms QA reported:

- **Nothing is registered.** You beat every bot at the table and the event page
  looks exactly as it did before. There is no record of how the deck you drafted
  actually performed — which is the entire study loop the environment exists for.
- **There is no event to be inside of.** Play is free-for-all: any seat can
  challenge any other seat, any number of times, in any order. Seven bots draft
  real decks and then never play each other.

So the event gains a **play phase**: after every seat has a deck, it runs Swiss
rounds, pairs every seat each round, records results and derives standings.

Three questions had genuine alternatives, and the first slice has to answer all
three because every later slice inherits the answers.

## Decision

### 1. The event's lifecycle gains a play phase, and its status is never compared literally

`limitedEvents.status` extends from `"open" | "started"` to
`"open" | "started" | "playing" | "finished"`. `"started"` keeps its meaning
(draft/deckbuild); `"playing"` begins when the existing `computeEventCompletion`
flips to complete; `"finished"` when the last round is decided.

Widening a status union is where this kind of change usually goes wrong. The
old two-member union let every consumer get away with a raw
`status === "started"` — and several did, including Auto-Build's pool-final gate
(`isEventPoolFinal`). A literal comparison there would have made **every bot
seat's Auto-Built deck disappear the instant the rounds started** — the decks
those rounds are played and evaluated against — with no test failing, because
no test yet reached the play phase.

So the union moves behind a seam: **`convex/limited/eventStatus.ts` is the
single authority on what each phase permits**, exposing named predicates
(`isSeatingOpen`, `arePoolsDealt`, `areDraftPicksLegal`, `areRoundsRunning`,
`isEventConcluded`) computed from one table declared
`satisfies Record<LimitedEventStatus, LimitedEventPhaseFacts>`. A fifth status
is then a **compile error** naming exactly which facts it must declare, not a
silently-false predicate. This is the same shape as the target-filter registry
(ADR 0068): the guard is that a missing entry must not typecheck.

Every consumer in `convex/` and `src/` that asks a **phase question** was
migrated to the predicates in the same change — a raw literal comparison used to
decide what a phase permits is now a review blocker. The `arePoolsDealt`
predicate carries the load-bearing invariant: **a Pool is never un-dealt**, so
pools, submitted decks and Auto-Built decks stay readable through `playing` and
`finished`.

Two kinds of literal are deliberately **exempt**, because neither is a phase
question:

- **Index selection.** `listOpenLimitedEvents` keeps
  `.withIndex("by_status", (q) => q.eq("status", "open"))`. This names the index
  range to scan, not what the phase permits; there is no predicate form of it
  (an index bound must be a concrete value, and routing it through a predicate
  would degrade the query to a full scan + filter). The lobby list is defined as
  "events in the `open` status", so the literal IS the specification.
- **Writes.** `status: "open"` at creation and `status: "started"` at event
  start are assignments naming the phase being entered, not comparisons
  branching on one.

The distinction is what the guard is actually about: a literal that *reads a
status to decide behaviour* silently becomes wrong when a member is added; a
literal that *names a specific status* does not.

### 2. The play phase lives EMBEDDED in the event document

`limitedEvents` gains `matchFormat`, `roundDeadlineMinutes`, `currentRound` and
`rounds[]` (each round carrying its `pairings[]`, each pairing its optional
`result`). No new tables.

Considered and rejected:

- **Separate `limitedRounds` / `limitedPairings` tables.** Breaks the symmetry
  with the already-embedded `seats[]`, adds a join to every event render, and
  buys isolation this domain's scale does not need: at most 8 seats × 3 rounds =
  12 pairings, bounded by the existing 8-seat cap.
- **An append-only results log with derived pairings.** Rejected because a Swiss
  pairing is *chosen* — with randomness among equal-score seats — so it must be
  persisted, not re-derived. A re-derivation could disagree with what was
  actually played.

The complement matters as much: **standings are NEVER stored.** They are derived
at read time in the projection from the recorded results, so the table can never
disagree with the results it is computed from. Persist what was *chosen*
(pairings), derive what is *implied* (standings).

`matches` and `games` gain `limitedPairing: { round, seatA, seatB }` alongside
the existing `limitedEventId`, so a finished Match finds its pairing without
scanning the event's rounds.

**Every new field is optional**, and `matchFormat` is read through a tolerant
`resolveMatchFormat` that defaults to `"bo3"`. Events created before the play
phase existed keep validating and keep working untouched — no migration. The
projection then makes the field **definite on the wire**: the tolerance is a
storage concern, and no client should re-implement the default.

### 3. Bot-vs-bot matches are EVALUATED, not simulated through the GRE

A round's bot-vs-bot pairings resolve automatically, scored from each bot's
actual drafted deck: deck strength aggregated through the *same* seams the Bot
Drafter already uses (`CardEvalMeta`, `GetPickRating`, the
`scoreCandidateWithRating` weighting), converted to a per-game win probability
through a logistic curve **clamped to roughly 25–75 %**, then rolled per game
with an RNG seeded from `(eventId, roundNumber, seatA, seatB)`.

Rejected: **playing the match through the GRE.** The gameplay Brain is
client-side (ADR 0001); a real simulation would need either a server-side port
of it or a connected client driving it — and the latter lets a closed browser
tab freeze the whole table. The evaluator sits behind a seam, so a future
server-side Brain could replace it without touching rounds, standings or the
schema.

The clamp is the design point, not an implementation detail. Unclamped, a strong
deck sweeps the table deterministically and the event has no tension; at pure
50/50 the draft is irrelevant. The seeded RNG is what makes a re-render or a
page reload unable to rewrite a recorded result.

`result.source` (`"played" | "simulated" | "bye" | "timeout"`) is therefore
**required, not decorative**: a standings table where half the results are
simulated is unreadable without it, the UI needs it to explain an awarded win,
and tests assert on it (a deadline must produce a 0-2 `"timeout"`, never a
`"simulated"` 2-0).

## Consequences

- Free challenges and Play-vs-Bots are **replaced** while the event is
  `"playing"`, and return once it is `"finished"` — labelled as unrecorded
  playtesting.
- The event document grows, but boundedly: ≤ 12 pairings, no unbounded array.
- Later slices (pairing, standings, evaluator, round state machine) are pure
  modules in `convex/limited/**` with the mutations as thin shells, matching the
  module's existing discipline — each testable without a database.
- ADR 0055's "the event ends at the built Deck" must be read as historical from
  here on; its decisions 2 and 3 remain in force.

## Out of scope

Top-8 / elimination cut (Swiss only), real GRE simulation of bot matches,
deliberate draws, rematches after the event finishes, dropping mid-rounds
(handled by the deadline, not an explicit drop), multi-pod events, and
player-level ranking persistence across events.
