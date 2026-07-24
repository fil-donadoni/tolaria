// Pure Limited Event orchestration (PRD #1107, ADR 0054/0055, issue #1110).
// The project has no convex-test harness (`convex/__tests__/adminAuth.test.ts`,
// `convex/__tests__/decks.test.ts`) — every non-trivial decision a
// `convex/limitedEvents.ts` mutation makes is factored out here as a plain
// function of plain data, so it is unit-testable directly (and so the
// mutation's handler stays a thin DB-read/write shell around it).
import { generateBooster } from "./boosterGenerator";
import type { BoosterConfig } from "./boosterTypes";
import type { LimitedEventSeat, LimitedPoolCard } from "./eventTypes";

/** 2-8 Seats (PRD #1107 story 2) — a table smaller than 2 can't play a Match,
 *  larger than 8 isn't a supported Draft/Sealed pod size. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 8;

/** Default Sealed booster count per seat (PRD #1107 story 6). */
export const DEFAULT_SEALED_BOOSTER_COUNT = 6;

/** Fixed Draft booster count (PRD #1241 story 7, issue #1246): a classic
 *  Draft is always three boosters — NOT admin-editable like Sealed's
 *  `sealedBoosterCount`. The create-event path (`create-limited-event-
 *  dialog.tsx`) emits `packSlots` as `DRAFT_BOOSTER_COUNT` copies of the
 *  chosen set; `draftEngine.ts`'s `applyPick` already completes the draft
 *  exactly when `packSlots.length` rounds have emptied, so this constant is
 *  the ONLY thing standing between "draft ends after 1 booster" (the
 *  pre-#1246 bug — a single-element `packSlots`) and a real 3-booster
 *  draft. */
export const DRAFT_BOOSTER_COUNT = 3;

/** Builds the initial N empty Seats for a freshly-created event: every seat
 *  starts unclaimed (`userId`/`isBot` both absent) — `joinLimitedEvent` claims
 *  one per human, `startLimitedEvent` fills whichever are still empty with
 *  Bot Drafters. Throws on an out-of-range `seatCount` so a bad admin input
 *  never reaches the DB. */
export function buildEmptySeats(seatCount: number): LimitedEventSeat[] {
    if (
        !Number.isInteger(seatCount) ||
        seatCount < MIN_SEATS ||
        seatCount > MAX_SEATS
    ) {
        throw new Error(
            `seatCount must be an integer between ${MIN_SEATS} and ${MAX_SEATS} (got ${seatCount})`
        );
    }
    return Array.from({ length: seatCount }, (_, seatIndex) => ({
        seatIndex,
    }));
}

/** Assigns `userId` to the first free Seat (PRD #1107 story 7: "any user
 *  takes a free seat"). Throws if the user already holds a seat in this event
 *  (no double-seating) or if every seat is already claimed (human or bot). */
export function assignFreeSeat(
    seats: readonly LimitedEventSeat[],
    userId: string,
    nickname: string
): LimitedEventSeat[] {
    if (seats.some((seat) => seat.userId === userId)) {
        throw new Error("You already have a seat in this event.");
    }
    const index = seats.findIndex(
        (seat) => seat.userId === undefined && !seat.isBot
    );
    if (index === -1) {
        throw new Error("No open seats remain in this event.");
    }
    return seats.map((seat, i) =>
        i === index ? { ...seat, userId, nickname } : seat
    );
}

/** Clears `userId`/`nickname` off the Seat the given user occupies, returning
 *  it to the unclaimed state `assignFreeSeat` looks for (issue #1579: an
 *  occupant leaving an OPEN event's Seat). Throws if the user holds no Seat
 *  in this event — the mutation is the only caller and it must not silently
 *  no-op on a stale/duplicate leave. Never touches a Bot Seat (`isBot` Seats
 *  have no `userId` to match against a real user's id). */
export function releaseSeat(
    seats: readonly LimitedEventSeat[],
    userId: string
): LimitedEventSeat[] {
    const index = seats.findIndex((seat) => seat.userId === userId);
    if (index === -1) {
        throw new Error("You do not have a seat in this event.");
    }
    return seats.map((seat, i) => {
        if (i !== index) return seat;
        // Drop userId/nickname only — back to the unclaimed state
        // `assignFreeSeat` matches on. Every other field is preserved
        // (defense-in-depth: while OPEN nothing else populates a Seat, but
        // this stays correct if that ever changes).
        const rest = { ...seat };
        delete rest.userId;
        delete rest.nickname;
        return rest;
    });
}

/** Fills every still-empty Seat with a Bot Drafter placeholder at event start
 *  (PRD #1107 story 8) — a draft/sealed pod never stalls waiting for missing
 *  humans. A seat already claimed (human or, idempotently, an existing bot)
 *  is left untouched. */
export function fillBotSeats(
    seats: readonly LimitedEventSeat[]
): LimitedEventSeat[] {
    return seats.map((seat) =>
        seat.userId === undefined && !seat.isBot
            ? { ...seat, isBot: true, nickname: `Bot ${seat.seatIndex + 1}` }
            : seat
    );
}

/** Resolves a set code to its checked-in `BoosterConfig`, or `null` when the
 *  set has none — injected so this module never reads the repo data /
 *  registry directly (mirrors `ResolveCard` in `convex/formats.ts`). */
export type GetBoosterConfig = (setCode: string) => BoosterConfig | null;

/** Resolves a drawn card's Scryfall id to the canonical Card ID + display
 *  name a Pool entry carries — injected so this module never reads the card
 *  registry directly. `null` for an id the registry can't resolve (should not
 *  happen for a Draftable Set's own sheets, but is not assumed away). */
export type ResolveCardMeta = (
    scryfallId: string
) => { cardId: string; cardName: string } | null;

/** Generates every Seat's Sealed Pool (ADR 0054/0055, PRD #1107 story 17):
 *  `boosterCount` Boosters per seat, cycling `packSlots` as the ordered Pack
 *  Source list (so `packSlots: ["lea"]` opens `boosterCount` LEA boosters;
 *  `["lea","leb"]` alternates). Every seat — human AND bot — receives a Pool
 *  identically, via the SAME pure seeded `generateBooster`, so a single `rng`
 *  stream threaded across every seat in seat order makes the whole event's
 *  Pools reproducible given the event's seed (PRD #1107 AC2). Throws if
 *  `packSlots` is empty or references an unresolvable set — a Sealed event
 *  can't start with no Pack Source. */
export function generateSealedPools(
    seats: readonly LimitedEventSeat[],
    packSlots: readonly string[],
    boosterCount: number,
    getConfig: GetBoosterConfig,
    resolveCardMeta: ResolveCardMeta,
    rng: () => number
): LimitedEventSeat[] {
    if (packSlots.length === 0) {
        throw new Error("generateSealedPools: packSlots is empty");
    }
    return seats.map((seat) => {
        const pool: LimitedPoolCard[] = [];
        for (let i = 0; i < boosterCount; i++) {
            const setCode = packSlots[i % packSlots.length];
            const config = getConfig(setCode);
            if (!config) {
                throw new Error(
                    `generateSealedPools: no Booster Config for set "${setCode}"`
                );
            }
            for (const drawn of generateBooster(config, rng)) {
                const meta = resolveCardMeta(drawn.scryfallId);
                pool.push({
                    scryfallId: drawn.scryfallId,
                    cardId: meta?.cardId ?? drawn.scryfallId,
                    cardName: meta?.cardName ?? drawn.scryfallId,
                });
            }
        }
        return { ...seat, pool };
    });
}
