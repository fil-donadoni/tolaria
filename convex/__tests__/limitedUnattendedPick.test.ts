// The Unattended Pick, end to end through the real mutation shells (ADR 0095,
// issue #2271).
//
// `draftTimer.test.ts` proves the pure helpers — `assignFreshPack` stamps a
// **Default Pick**, `resolveAutoPickTimeout` resolves in three arms,
// `markUnattendedPick`/`clearUnattendedPicks` keep the bookkeeping. None of
// that says the MUTATION wires them together: the Pool index a mark points at
// is computed in `autoPickSeatTimeout`'s own body (`pool.length` BEFORE
// `applyPick` appends), and the clear happens in `submitPick`'s. An off-by-one
// there marks the wrong card in the Pool and every helper test still passes.
//
// The project has no convex-test harness (see `convex/__tests__/decks.test.ts`),
// so — the same idiom as `limitedAutoPickLastCard.test.ts` — this drives the
// REGISTERED mutations' own `_handler` against the shared in-memory ctx
// (`fixtures/inMemoryDb.ts`) plus a recording `scheduler`, and asserts the
// DOCUMENTS they leave behind, then reads them back through the real client
// projection.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { autoPickSeatTimeout, submitPick } from "../limitedEvents";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
import type { DraftPackCard } from "../limited/eventTypes";

const EVENT_ID = "event1";
const HUMAN_SEAT = 0;

const USERS = [{ _id: "user1", nickname: "Alice" }];

/** Same unresolvable-id fixture card as `limitedAutoPickLastCard.test.ts`:
 *  the producers' fallback makes `cardId === cardName === scryfallId`, so
 *  every round-trip assertion below is an exact identity. */
function packCard(n: number): DraftPackCard {
    return {
        scryfallId: `sf-${n}`,
        cardId: `sf-${n}`,
        cardName: `sf-${n}`,
        pickId: `r0-p0-c${n}`,
    };
}

function poolCard(n: number) {
    return { scryfallId: `sf-${n}`, cardId: `sf-${n}`, cardName: `sf-${n}` };
}

function makeCtx(rows: Record<string, InMemoryRow[]>) {
    const base = makeInMemoryDb(rows, { identitySubject: "user1|session1" });
    const ctx = {
        ...(base.ctx as unknown as Record<string, unknown>),
        scheduler: { runAfter: async () => {} },
    } as unknown as MutationCtx;
    return { ctx, tables: base.tables };
}

/** A timer-ON draft in progress. Seat 0 is the human under test; seats 1-3
 *  are Bot Drafters holding nothing, so nothing cascades and every assertion
 *  stays about seat 0. */
function draftInProgress(
    seat0: Record<string, unknown>
): Record<string, InMemoryRow[]> {
    return {
        users: USERS,
        limitedEvents: [
            {
                _id: EVENT_ID,
                createdBy: "user1",
                type: "draft",
                status: "started",
                name: "Test Draft",
                seatCount: 4,
                seed: 7,
                timerEnabled: true,
                packSlots: ["lea"],
                draftRound: 0,
                draftPacksRemaining: 4,
                createdAt: 0,
                updatedAt: 0,
                seats: [
                    {
                        seatIndex: HUMAN_SEAT,
                        userId: "user1",
                        nickname: "Alice",
                        ...seat0,
                    },
                    ...[1, 2, 3].map((seatIndex) => ({
                        seatIndex,
                        isBot: true,
                        nickname: `Bot ${seatIndex}`,
                        pool: [],
                        currentPack: [],
                        packQueue: [],
                    })),
                ],
            },
        ],
        limitedSeats: [],
        limitedSelections: [],
        userDecks: [],
        cardRatings: [],
    };
}

const runAutoPickSeatTimeout = (
    ctx: MutationCtx,
    seatIndex: number,
    expectedSeq: number
) =>
    (
        autoPickSeatTimeout as unknown as {
            _handler: (
                ctx: MutationCtx,
                args: {
                    eventId: Id<"limitedEvents">;
                    seatIndex: number;
                    expectedSeq: number;
                }
            ) => Promise<null>;
        }
    )._handler(ctx, {
        eventId: EVENT_ID as Id<"limitedEvents">,
        seatIndex,
        expectedSeq,
    });

const runSubmitPick = (ctx: MutationCtx, pickId: string) =>
    (
        submitPick as unknown as {
            _handler: (
                ctx: MutationCtx,
                args: { eventId: Id<"limitedEvents">; pickId: string }
            ) => Promise<null>;
        }
    )._handler(ctx, { eventId: EVENT_ID as Id<"limitedEvents">, pickId });

/** The stored seat, read back the way every consumer does: the event row's
 *  slim seat merged with the seat store's payload row. */
function storedSeat(tables: Record<string, InMemoryRow[]>, seatIndex: number) {
    const event = tables.limitedEvents[0];
    const slim = (event.seats as Record<string, unknown>[])[seatIndex];
    const payload = (tables.limitedSeats ?? []).find(
        (row) => row.seatIndex === seatIndex
    );
    return { ...slim, ...(payload ?? {}) } as Record<string, unknown>;
}

describe("Unattended Pick — the mutation shells (ADR 0095, issue #2271)", () => {
    it("an Auto-Pick with nothing selected marks the Pool index it just produced — not the one before it", async () => {
        // Two cards already in the Pool, so a mark of `0` (or of the pool's
        // post-pick length) reads as an off-by-one rather than as a pass.
        const { ctx, tables } = makeCtx(
            draftInProgress({
                pool: [poolCard(90), poolCard(91)],
                currentPack: [packCard(1), packCard(2), packCard(3)],
                packQueue: [],
                pickSeq: 4,
            })
        );

        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 4);

        const seat = storedSeat(tables, HUMAN_SEAT);
        const pool = seat.pool as { scryfallId: string }[];
        expect(pool).toHaveLength(3);
        expect(seat.unattendedPickIndices).toEqual([2]);
        // The marked index is the card the Auto-Pick actually took.
        expect(pool[2].scryfallId).not.toBe("sf-90");
        expect(pool[2].scryfallId).not.toBe("sf-91");

        // …and the client is told, own seat only, through the real
        // projection (the wire the ring renders from).
        const event = tables.limitedEvents[0];
        const view = projectLimitedEvent(
            {
                ...event,
                seats: (event.seats as Record<string, unknown>[]).map(
                    (_slim, seatIndex) => storedSeat(tables, seatIndex)
                ),
            } as unknown as LimitedEventRow,
            "user1" as Id<"users">,
            false
        );
        expect(view.seats[HUMAN_SEAT].unattendedPickIndices).toEqual([2]);
        expect(view.seats[1].unattendedPickIndices).toBeNull();
    });

    it("an Auto-Pick that honoured a Selected Card marks nothing — the Seat chose that card, the clock only committed it", async () => {
        const { ctx, tables } = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(1), packCard(2), packCard(3)],
                packQueue: [],
                pickSeq: 4,
                selectedPickId: packCard(2).pickId,
            })
        );

        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 4);

        const seat = storedSeat(tables, HUMAN_SEAT);
        expect((seat.pool as { scryfallId: string }[])[0].scryfallId).toBe(
            "sf-2"
        );
        expect(seat.unattendedPickIndices).toBeUndefined();
    });

    it("the next hand-made submitPick clears every mark the seat was carrying", async () => {
        const { ctx, tables } = makeCtx(
            draftInProgress({
                pool: [poolCard(90), poolCard(91)],
                currentPack: [packCard(1), packCard(2), packCard(3)],
                packQueue: [],
                pickSeq: 4,
                unattendedPickIndices: [0, 1],
            })
        );

        await runSubmitPick(ctx, packCard(1).pickId);

        const seat = storedSeat(tables, HUMAN_SEAT);
        expect(
            (seat.pool as { scryfallId: string }[]).map((c) => c.scryfallId)
        ).toEqual(["sf-90", "sf-91", "sf-1"]);
        expect(seat.unattendedPickIndices).toBeUndefined();
    });
});
