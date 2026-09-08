// The last card of every pack (issue #2278). `CONTEXT.md` promises of a
// **Draft** that "an optional **Pick Timer** fires an **Auto-Pick** on expiry
// so an absent human never freezes the table" — and that promise used to have
// a hole exactly one card wide: the pick-timer schedule returns `null` at 1
// card remaining, and `null` was read as BOTH "render no countdown" and
// "schedule nothing". A **Seat** that walked away therefore stalled the whole
// table on the last card of every pack it was passed, once per pack, for
// everyone, until it came back.
//
// The fix splits the two meanings (`pickTimerSchedule.ts`); this file is the
// end-to-end proof that the split reaches the DB and the client:
//
//   1. the registered `autoPickSeatTimeout` internalMutation SCHEDULES a
//      follow-up Auto-Pick for a 1-card pack, and resolves one when it fires,
//   2. the card lands in the seat's **Pool** through the real seat store,
//   3. a **Selected Card** on a 1-card pack is still honoured (the path, not
//      just the degenerate outcome),
//   4. the real client projection still reports "nothing is timed" for it, so
//      no countdown can render.
//
// The project has no convex-test harness (see `convex/__tests__/decks.test.ts`),
// so — the same idiom as `limitedRoundDeadline.test.ts` and
// `limitedSeatStore.test.ts` — this drives the REGISTERED mutation's own
// `_handler` against the shared in-memory ctx (`fixtures/inMemoryDb.ts`) plus a
// recording `scheduler`, and asserts the DOCUMENTS it leaves behind.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { autoPickSeatTimeout } from "../limitedEvents";
import { makeInMemoryDb, type InMemoryRow } from "./fixtures/inMemoryDb";
import { projectLimitedEvent } from "../limited/eventProjection";
import type { LimitedEventRow } from "../limited/eventProjection";
import { AUTO_PICK_FLOOR_SECONDS } from "../limited/pickTimerSchedule";
import type { DraftPackCard } from "../limited/eventTypes";

const EVENT_ID = "event1";
const HUMAN_SEAT = 0;

/** An unresolvable id resolves to the producers' own fallback
 *  (`cardId === cardName === scryfallId`), exactly as `limitedSeatStore.test.ts`
 *  relies on — which keeps every round-trip assertion below an exact identity
 *  and exercises the fail-closed meta path at the same time. */
function packCard(n: number): DraftPackCard {
    return {
        scryfallId: `sf-${n}`,
        cardId: `sf-${n}`,
        cardName: `sf-${n}`,
        pickId: `r0-p0-c${n}`,
    };
}

interface ScheduledCall {
    delayMs: number;
    args: { eventId: string; seatIndex: number; expectedSeq: number };
}

/** The in-memory ctx plus the recording `scheduler` the mutation needs (the
 *  shared fixture deliberately implements only `db`/`auth`). */
function makeCtx(rows: Record<string, InMemoryRow[]>) {
    const base = makeInMemoryDb(rows);
    const scheduled: ScheduledCall[] = [];
    const ctx = {
        ...(base.ctx as unknown as Record<string, unknown>),
        scheduler: {
            runAfter: async (
                delayMs: number,
                _ref: unknown,
                args: {
                    eventId: string;
                    seatIndex: number;
                    expectedSeq: number;
                }
            ) => {
                scheduled.push({ delayMs, args });
            },
        },
    } as unknown as MutationCtx;
    return { ctx, scheduled, tables: base.tables };
}

/** A timer-ON draft in progress. Seat 0 is the (absent) human; seats 1-3 are
 *  Bot Drafters with nothing in front of them, so nothing cascades and the
 *  assertions stay about seat 0 alone. The payload is inline on the event row
 *  — the legacy shape `hydrateSeats` falls through to when a seat has no
 *  `limitedSeats` child row yet, which is a real state and the cheapest
 *  fixture. */
function draftInProgress(
    seat0: Record<string, unknown>
): Record<string, InMemoryRow[]> {
    return {
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
        userDecks: [],
        cardRatings: [],
    };
}

const runAutoPickSeatTimeout = async (
    ctx: MutationCtx,
    seatIndex: number,
    expectedSeq: number
) =>
    await (
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

/** The stored seat, read back the way every consumer does: through the event
 *  row's own seat array merged with the seat store's payload row. */
function storedSeat(tables: Record<string, InMemoryRow[]>, seatIndex: number) {
    const event = tables.limitedEvents[0];
    const slim = (event.seats as Record<string, unknown>[])[seatIndex];
    const payload = (tables.limitedSeats ?? []).find(
        (row) => row.seatIndex === seatIndex
    );
    return { ...slim, ...(payload ?? {}) };
}

describe("the last card of a pack is Auto-Picked for an absent Seat (issue #2278)", () => {
    it("an Auto-Pick that hands the seat a 1-card pack SCHEDULES the follow-up Auto-Pick, at the schedule's floor and with no displayed deadline", async () => {
        // Seat 0 holds a 2-card pack with a 1-card pack already queued behind
        // it: resolving the timeout picks from the 2-card pack and dequeues
        // the 1-card one, which is the exact moment the old code went silent.
        const { ctx, scheduled, tables } = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(1), packCard(2)],
                packQueue: [[packCard(3)]],
                pickSeq: 4,
            })
        );

        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 4);

        const seat = storedSeat(tables, HUMAN_SEAT);
        // The 1-card pack is now in front of the seat...
        expect(seat.currentPack).toHaveLength(1);
        expect(seat.pickSeq).toBe(5);
        // ...with NO deadline stamped, so no countdown can render for it...
        expect(seat.pickDeadline).toBeUndefined();
        // ...and yet a timeout IS scheduled, at the schedule's floor.
        expect(scheduled).toEqual([
            {
                delayMs: AUTO_PICK_FLOOR_SECONDS * 1000,
                args: {
                    eventId: EVENT_ID,
                    seatIndex: HUMAN_SEAT,
                    expectedSeq: 5,
                },
            },
        ]);
    });

    it("that follow-up, when it fires, lands the last card in the Pool with no human input — the table advances", async () => {
        const { ctx, scheduled, tables } = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(3)],
                packQueue: [],
                pickSeq: 5,
            })
        );

        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 5);

        const seat = storedSeat(tables, HUMAN_SEAT);
        expect(
            (seat.pool as { scryfallId: string }[]).map((c) => c.scryfallId)
        ).toEqual(["sf-3"]);
        // The pack is gone — the seat no longer blocks anyone.
        expect(seat.currentPack ?? []).toHaveLength(0);
        // Nothing is left in front of the seat, so nothing further is timed.
        expect(scheduled).toEqual([]);
    });

    it("honours a Selected Card on a 1-card pack — the selection path, not the heuristic fallback", async () => {
        // Degenerately the same card either way, so the OUTCOME cannot
        // discriminate: what pins the path is that a selection naming a card
        // the pack does NOT contain falls through to the heuristic instead of
        // being force-applied. Both halves run here.
        const honoured = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(3)],
                packQueue: [],
                pickSeq: 5,
                selectedPickId: packCard(3).pickId,
            })
        );
        await runAutoPickSeatTimeout(honoured.ctx, HUMAN_SEAT, 5);
        expect(
            (
                storedSeat(honoured.tables, HUMAN_SEAT).pool as {
                    scryfallId: string;
                }[]
            ).map((c) => c.scryfallId)
        ).toEqual(["sf-3"]);

        const stale = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(3)],
                packQueue: [],
                pickSeq: 5,
                selectedPickId: "r0-p0-c99", // names a card this pack never had
            })
        );
        await runAutoPickSeatTimeout(stale.ctx, HUMAN_SEAT, 5);
        // Fell through to the heuristic rather than throwing or no-opping —
        // the seat still got its card.
        expect(
            (
                storedSeat(stale.tables, HUMAN_SEAT).pool as {
                    scryfallId: string;
                }[]
            ).map((c) => c.scryfallId)
        ).toEqual(["sf-3"]);
    });

    it("a stale schedule on a 1-card pack is still a no-op — the seq guard is untouched", async () => {
        const { ctx, tables } = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(3)],
                packQueue: [],
                pickSeq: 6, // the human already picked; this schedule is stale
            })
        );

        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 5);

        const seat = storedSeat(tables, HUMAN_SEAT);
        expect(seat.pool ?? []).toHaveLength(0);
        expect(seat.currentPack).toHaveLength(1);
    });

    it("the client is told nothing is timed for a 1-card pack — through the real projection, so no countdown can render", async () => {
        const { ctx, tables } = makeCtx(
            draftInProgress({
                pool: [],
                currentPack: [packCard(1), packCard(2)],
                packQueue: [[packCard(3)]],
                pickSeq: 4,
            })
        );
        await runAutoPickSeatTimeout(ctx, HUMAN_SEAT, 4);

        // Project the row the mutation actually left behind, with the seat's
        // payload folded back in the way `hydrateSeats` does for a reader.
        const event = tables.limitedEvents[0];
        const view = projectLimitedEvent(
            {
                ...event,
                seats: (event.seats as Record<string, unknown>[]).map(
                    (_slim, seatIndex) => storedSeat(tables, seatIndex)
                ),
            } as unknown as LimitedEventRow,
            "user1"
        );
        const viewerSeat = view.seats[HUMAN_SEAT];
        expect(viewerSeat.currentPack).toHaveLength(1);
        // `limited-draft-timer.tsx` renders nothing at all on a null deadline
        // — that is the whole display contract this issue had to preserve.
        expect(viewerSeat.pickDeadline).toBeNull();
    });
});
