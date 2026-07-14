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

/** A single Seat on a `limitedEvents` row. `userId` is absent until a human
 *  joins (`joinLimitedEvent`) or `startLimitedEvent` fills it with a Bot
 *  Drafter placeholder (`isBot: true`). `pool` is absent until the event
 *  starts. */
export interface LimitedEventSeat {
    seatIndex: number;
    userId?: string;
    nickname?: string;
    isBot?: boolean;
    pool?: LimitedPoolCard[];
}

export type LimitedEventType = "sealed" | "draft";
export type LimitedEventStatus = "open" | "started";
