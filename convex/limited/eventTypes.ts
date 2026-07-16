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
}

export type LimitedEventType = "sealed" | "draft";
export type LimitedEventStatus = "open" | "started";

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
    /** Manual override of the auto Mana-Value column. Absent = auto. */
    column?: number;
    /** true = Sideboard, false/absent = Maindeck. */
    sideboard?: boolean;
}
