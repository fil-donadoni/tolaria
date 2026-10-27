// Draft Pick Timer is forced on at start with 2+ human Seats (issue #2596,
// GLOSSARY.md "Pick Timer"). Drives the REAL `startLimitedEvent` handler
// against the shared in-memory ctx, so the persisted flag and the scheduled
// auto-picks are what the mutation actually wrote.
import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { startLimitedEvent } from "../limitedEvents";
import {
    countHumanSeats,
    effectiveDraftTimerEnabled,
} from "../limited/eventLogic";
import type { LimitedEventSeat } from "../limited/eventTypes";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

const EVENT_ID = "event-2596" as Id<"limitedEvents">;

const handler = (
    startLimitedEvent as unknown as {
        _handler: (
            ctx: MutationCtx,
            args: { eventId: Id<"limitedEvents"> }
        ) => Promise<null>;
    }
)._handler;

function seat(
    seatIndex: number,
    extra: Partial<LimitedEventSeat> = {}
): LimitedEventSeat {
    return { seatIndex, ...extra };
}

describe("countHumanSeats (issue #2596)", () => {
    it("counts 0 humans on an empty table", () => {
        expect(countHumanSeats([seat(0), seat(1)])).toBe(0);
    });
    it("counts 1 human", () => {
        expect(countHumanSeats([seat(0, { userId: "u1" }), seat(1)])).toBe(1);
    });
    it("counts 2 humans", () => {
        expect(
            countHumanSeats([
                seat(0, { userId: "u1" }),
                seat(1, { userId: "u2" }),
            ])
        ).toBe(2);
    });
    it("excludes bots and unclaimed seats", () => {
        expect(
            countHumanSeats([
                seat(0, { userId: "u1" }),
                seat(1, { isBot: true, nickname: "Bot" }),
                seat(2),
            ])
        ).toBe(1);
    });
});

describe("effectiveDraftTimerEnabled (issue #2596)", () => {
    const two = [seat(0, { userId: "u1" }), seat(1, { userId: "u2" })];
    const one = [seat(0, { userId: "u1" }), seat(1, { isBot: true })];
    it("forces the timer on with 2+ humans", () => {
        expect(effectiveDraftTimerEnabled(false, two)).toBe(true);
        expect(effectiveDraftTimerEnabled(undefined, two)).toBe(true);
    });
    it("keeps the creator's choice with 0 or 1 human", () => {
        expect(effectiveDraftTimerEnabled(false, one)).toBe(false);
        expect(effectiveDraftTimerEnabled(true, one)).toBe(true);
        expect(effectiveDraftTimerEnabled(true, [seat(0), seat(1)])).toBe(true);
    });
});

describe("startLimitedEvent forces the Pick Timer (issue #2596)", () => {
    async function start(seats: LimitedEventSeat[], timerEnabled: boolean) {
        const db = makeInMemoryDb(
            {
                users: [
                    { _id: "u1", nickname: "Alice" },
                    { _id: "u2", nickname: "Bob" },
                ],
                limitedEvents: [
                    {
                        _id: EVENT_ID,
                        createdBy: "u1",
                        type: "draft",
                        status: "open",
                        seatCount: seats.length,
                        packSlots: ["lea", "lea", "lea"],
                        timerEnabled,
                        seats,
                        createdAt: 0,
                        updatedAt: 0,
                    },
                ],
            },
            { identitySubject: "u1|session1" }
        );
        const scheduled: unknown[] = [];
        const ctx = {
            ...db.ctx,
            scheduler: {
                runAfter: async (...args: unknown[]) => {
                    scheduled.push(args);
                },
            },
        } as unknown as MutationCtx;
        await handler(ctx, { eventId: EVENT_ID });
        return { event: db.tables.limitedEvents[0], scheduled };
    }

    const humans = (n: number) =>
        Array.from({ length: 4 }, (_, i) =>
            i < n
                ? seat(i, { userId: `u${i + 1}`, nickname: `H${i + 1}` })
                : seat(i)
        );

    it("timer off + 2 humans → persisted on and auto-picks scheduled", async () => {
        const { event, scheduled } = await start(humans(2), false);
        expect(event.timerEnabled).toBe(true);
        expect(scheduled.length).toBeGreaterThanOrEqual(2);
    });

    it("timer off + 1 human → stays off, nothing scheduled", async () => {
        const { event, scheduled } = await start(humans(1), false);
        expect(event.timerEnabled).toBe(false);
        expect(scheduled).toHaveLength(0);
    });

    it("timer on + 1 human → stays on", async () => {
        const { event, scheduled } = await start(humans(1), true);
        expect(event.timerEnabled).toBe(true);
        expect(scheduled.length).toBeGreaterThanOrEqual(1);
    });
});
