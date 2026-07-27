// Limited Event domain types (PRD #1107, ADR 0054/0055, issue #1110). Shared
// by the pure orchestration logic (`eventLogic.ts`), the privacy projection
// (`eventProjection.ts`) and the thin Convex mutation/query shell
// (`convex/limitedEvents.ts`) — kept in one place so all three agree on the
// seat/pool shape without re-declaring it.

/** One physical card opened into a seat's Pool (ADR 0054/0055): the exact
 *  printing drawn from a Booster (`scryfallId`) plus the canonical Card ID
 *  and display name it resolves to. One entry per card — NOT grouped into
 *  counts here; the `convex/formats.ts` `Pool`/`PoolCard` legality shape is
 *  the grouped view, derived from this at the (later) deckbuilding seam. */
export interface LimitedPoolCard {
    scryfallId: string;
    cardId: string;
    cardName: string;
}

/** One Draft pack card (issue #1112, ADR 0054/0055): a `LimitedPoolCard` plus
 *  a `pickId` unique across the whole event — a real booster can legally
 *  contain two copies of the same common, so `scryfallId` alone can't
 *  disambiguate which physical card a `submitPick` targets within a pack.
 *  Assigned once at pack generation (`draftEngine.ts`'s `generateRoundPacks`)
 *  and carried unchanged as the pack is passed table to table. Never present
 *  on a resolved `pool` entry — only on `currentPack`/`packQueue` cards. */
export interface DraftPackCard extends LimitedPoolCard {
    pickId: string;
}

/** A single Seat on a `limitedEvents` row. `userId` is absent until a human
 *  joins (`joinLimitedEvent`) or `startLimitedEvent` fills it with a Bot
 *  Drafter placeholder (`isBot: true`). `pool` is absent until the event
 *  starts (Sealed: dealt in full immediately; Draft: accumulates one pick at
 *  a time, issue #1112). */
export interface LimitedEventSeat {
    seatIndex: number;
    userId?: string;
    nickname?: string;
    isBot?: boolean;
    /** `pool.length`, denormalised onto the event row's slim seat so listing
     *  events never has to load the Pool itself (`convex/schema.ts`'s
     *  `limitedSeats` split). Absent on a seat whose Pool has never been
     *  dealt; kept in step with `pool` by `convex/limitedSeatStore.ts`, the
     *  only writer. Readers that HAVE a hydrated `pool` should prefer
     *  `pool.length` — this exists for the seat shapes that deliberately
     *  don't. */
    poolCount?: number;
    pool?: LimitedPoolCard[];
    /** Draft only (issue #1112): the pack currently in front of this seat to
     *  Pick from. Absent while waiting for the next pass (queue empty) or for
     *  a Sealed event. */
    currentPack?: DraftPackCard[];
    /** Draft only: packs passed to this seat while `currentPack` was still
     *  non-empty (PRD #1107 story 13 — a fast-picking seat isn't blocked on a
     *  slow neighbor). FIFO: `packQueue[0]` becomes the next `currentPack`
     *  once the current one is exhausted. */
    packQueue?: DraftPackCard[][];
    /** Draft only, timer-on events (issue #1114): epoch ms when this seat's
     *  CURRENT `currentPack` pick times out. Absent when the event has no
     *  configured timer, this is a Bot Drafter seat, or the seat has no
     *  current pack. Server-authoritative — never client-writable. */
    pickDeadline?: number;
    /** Draft only, timer-on events: monotonic counter bumped every time this
     *  seat's `currentPack` is freshly assigned (dealt or passed in) — see
     *  `draftEngine.ts`'s `resolveAutoPickTimeout` for the stale-schedule
     *  guard this powers (seq-based Auto-Pick cancellation, CLAUDE.md's
     *  priority-timeout pattern). */
    pickSeq?: number;
    /** The seat's Pool Arrangement (ADR 0060, issue #1247) — see
     *  `PoolArrangementEntry`. Absent means every card is still at its
     *  default placement (Maindeck, auto Mana-Value column). */
    poolArrangement?: PoolArrangementEntry[];
    /** Selected Card (ADR 0060, issue #1248): the `pickId` of the card in
     *  THIS seat's `currentPack` the player has tentatively clicked on — a
     *  SELECTION, never a commit (`submitPick`/the Pick gestures are the only
     *  thing that ever moves a card into `pool`). Absent means nothing is
     *  selected. Set by `selectDraftPick` (`convex/limitedEvents.ts`); a
     *  stale value referencing a card no longer in `currentPack` (the pack
     *  emptied/passed on) is simply ignored by every reader — `pickId`
     *  embeds its originating round (`r<round>-p<seat>-c<idx>`,
     *  `draftEngine.ts`), so it can never coincidentally match a LATER
     *  round's card. */
    selectedPickId?: string;
}

export type LimitedEventType = "sealed" | "draft";

// The lifecycle status union moved to its own module (ADR 0076, issue #1640):
// with the play phase it has four members, and every consumer now asks a NAMED
// question of `eventStatus.ts`'s exhaustive fact table instead of comparing the
// literal. Re-exported here so this stays the one type barrel for the event
// domain and no existing import path had to move.
export type { LimitedEventStatus } from "./eventStatus";
export type { LimitedMatchFormat } from "./matchFormat";

/** How a pairing's result came to be recorded (PRD #1628). NOT decorative: a
 *  standings table where half the rows are simulated is unreadable without it,
 *  the UI needs it to explain an awarded win, and the round tests assert on it
 *  (a deadline must produce a 0-2 `"timeout"`, never a `"simulated"` 2-0).
 *  - `"played"` — a real Match finished through the GRE.
 *  - `"simulated"` — a bot-vs-bot pairing resolved by evaluating both drafted
 *    decks (ADR 0076 decision 3: evaluated, never played through the engine).
 *  - `"bye"` — an odd table's unpaired seat, awarded the match win.
 *  - `"timeout"` — the round deadline closed an unplayed human pairing. */
export type LimitedPairingResultSource =
    | "played"
    | "simulated"
    | "bye"
    | "timeout";

/** The decided outcome of one pairing, in GAMES won by each side (not match
 *  points): standings derive points, match record AND game-win % from this, so
 *  the game counts are the primitive and everything else is computed
 *  (PRD #1628 story 47 — standings are derived, never stored). */
export interface LimitedPairingResult {
    winsA: number;
    winsB: number;
    source: LimitedPairingResultSource;
}

/** One pairing within a round: two seats, or one seat and a bye.
 *
 *  `seatIndex` values, not user ids — a seat is the event's unit of identity
 *  (a bot seat has no user), exactly as `seats[]` is keyed. */
export interface LimitedPairing {
    seatA: number;
    /** Absent = BYE. `seatA` is awarded the match win (PRD #1628 stories
     *  27-28); at most one bye per seat per event. */
    seatB?: number;
    /** The Match this pairing is played through — present only once a pairing
     *  involving a HUMAN has a Match created for it, so the pairing can be
     *  found from a finished Match (and vice versa) without a scan. A
     *  bot-vs-bot pairing and a bye never have one: neither is played.
     *  Stored as `v.id("matches")`, carried here as the opaque string this
     *  module's `_id`/`createdBy` already use — `convex/limited/**` never
     *  depends on `_generated` (see `LimitedEventRow`). */
    matchId?: string;
    /** Absent = undecided (still being played, or waiting on a human). */
    result?: LimitedPairingResult;
}

/** One Swiss round of the event's play phase (PRD #1628, ADR 0076). Rounds are
 *  EMBEDDED in the event document rather than living in their own table: at
 *  most 8 seats x 3 rounds = 12 pairings, and the symmetry with the already-
 *  embedded `seats` is worth more than the isolation a join would buy. */
export interface LimitedRound {
    roundNumber: number;
    startedAt: number;
    /** Epoch ms the round's undecided human pairings are closed as losses
     *  (PRD #1628 stories 32-35). Absent = the event has no round deadline
     *  configured, so the round never expires. */
    deadlineAt?: number;
    pairings: LimitedPairing[];
}

/** Per-seat, server-persisted Pool Arrangement (ADR 0060, issue #1247): how
 *  ONE opened Pool card is currently organised on the continuous draft→build
 *  surface — its Mana-Value column (with a manual per-card override) and
 *  whether it's parked in the Maindeck or the Sideboard. Keyed by
 *  `poolIndex`, the card's position within the seat's `pool` array — the
 *  stable identity a same-name duplicate needs, since `LimitedPoolCard`
 *  itself carries no per-copy id; `pool` is append-only (Sealed generates it
 *  once, Draft appends exactly one entry per Pick) and never reordered, so
 *  the index is stable for the seat's whole life. Absent for a given
 *  `poolIndex` (or the whole array absent/empty) means the card hasn't been
 *  moved yet and defaults to the Maindeck, in its own (auto, mana-value-
 *  derived) column — see `convex/limited/poolArrangement.ts`'s
 *  `resolvePoolPlacements`. The column-override DRAG GESTURE itself is wired
 *  by issue #1248 (tracked-by: #1248); this shape ships now — persistence +
 *  projection only — so that later change needs no further schema
 *  migration. */
export interface PoolArrangementEntry {
    poolIndex: number;
    /** Manual override of the auto Mana-Value column, OR the literal
     *  `"lands"` to pin the card into the Lands column regardless of its own
     *  type (issue #1573: column placement is player organization, not a
     *  rules statement — any card can be manually parked in Lands). Absent =
     *  auto (a Land card's own type routes it to Lands; every other card
     *  routes to its own Mana Value). */
    column?: number | "lands";
    /** true = Sideboard, false/absent = Maindeck. */
    sideboard?: boolean;
}
