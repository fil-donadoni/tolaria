// Table-intro countdown before a Draft's first pick (issue #9167). Drives the
// REAL `startLimitedEvent` / `beginDraft` / `startDraftNow` handlers against
// the shared in-memory ctx: the persisted rows are what the mutations wrote.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
    beginDraft,
    DRAFT_COUNTDOWN_SECONDS,
    startDraftNow,
    startLimitedEvent,
} from "../limitedEvents";
import { pickTimerSecondsForCardsRemaining } from "../limited/pickTimerSchedule";
import type { LimitedEventSeat } from "../limited/eventTypes";
import { makeInMemoryDb } from "./fixtures/inMemoryDb.fixture";

type SeatRow = {
    seatIndex: number;
    currentPack?: unknown[];
    pool?: unknown[];
};
const EVENT_ID = "event-9167" as Id<"limitedEvents">;
const T0 = 1_800_000_000_000;

type Handler<A> = { _handler: (ctx: MutationCtx, args: A) => Promise<null> };
const startH = (startLimitedEvent as unknown as Handler<unknown>)._handler;
const beginH = (beginDraft as unknown as Handler<unknown>)._handler;
const nowH = (startDraftNow as unknown as Handler<unknown>)._handler;

function setup(identity: string) {
    const seats: LimitedEventSeat[] = [
        { seatIndex: 0, userId: "u1", nickname: "Alice" },
        ...Array.from({ length: 7 }, (_, i) => ({ seatIndex: i + 1 })),
    ];
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
                    seatCount: 8,
                    packSlots: ["lea", "lea", "lea"],
                    timerEnabled: true,
                    seats,
                    createdAt: 0,
                    updatedAt: 0,
                },
            ],
        },
        { identitySubject: identity }
    );
    const runAt: unknown[][] = [];
    const runAfter: unknown[][] = [];
    const ctx = {
        ...db.ctx,
        scheduler: {
            runAt: async (...a: unknown[]) => void runAt.push(a),
            runAfter: async (...a: unknown[]) => void runAfter.push(a),
        },
    } as unknown as MutationCtx;
    const event = () =>
        db.tables.limitedEvents[0] as Record<string, unknown> & {
            seats: LimitedEventSeat[];
            draftStartsAt?: number;
            draftRound?: number;
        };
    // Seat order is shuffled at start: find where the human landed.
    const humanSeat = () =>
        (event().seats as LimitedEventSeat[]).find((s) => s.userId === "u1")!;
    const humanPackSize = () => {
        const rows = db.tables.limitedSeats ?? [];
        const row = rows.find(
            (r: SeatRow) => r.seatIndex === humanSeat().seatIndex
        ) as SeatRow | undefined;
        return (row?.currentPack ?? []).length as number;
    };
    const botPicks = () =>
        (db.tables.limitedSeats ?? []).filter(
            (r: SeatRow) =>
                r.seatIndex !== humanSeat().seatIndex &&
                (r.pool ?? []).length > 0
        ).length;
    return { ctx, event, humanSeat, runAt, runAfter, humanPackSize, botPicks };
}

describe("draft start countdown (issue #9167)", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(T0);
    });
    afterEach(() => vi.useRealTimers());

    it("deals nothing and no Bot picks before draftStartsAt", async () => {
        const t = setup("u1|s");
        await startH(t.ctx, { eventId: EVENT_ID, withCountdown: true });
        const e = t.event();
        expect(e.status).toBe("started");
        expect(e.draftStartsAt).toBe(T0 + DRAFT_COUNTDOWN_SECONDS * 1000);
        expect(e.draftRound).toBeUndefined();
        expect(t.humanPackSize()).toBe(0);
        expect(t.botPicks()).toBe(0);
        expect(t.runAt).toHaveLength(1);
        expect(t.runAfter).toHaveLength(0);
    });

    it("round-0 deadlines = draftStartsAt + schedule once it begins", async () => {
        const t = setup("u1|s");
        await startH(t.ctx, { eventId: EVENT_ID, withCountdown: true });
        const startsAt = t.event().draftStartsAt as number;
        vi.setSystemTime(startsAt + 1500); // the job fires a little late
        await beginH(t.ctx, { eventId: EVENT_ID });
        const size = t.humanPackSize();
        expect(size).toBeGreaterThan(1);
        expect(t.event().draftRound).toBe(0);
        expect(t.humanSeat().pickDeadline).toBe(
            startsAt + pickTimerSecondsForCardsRemaining(size)! * 1000
        );
        expect(t.botPicks()).toBe(7);
    });

    it("Start now shifts the deadlines to the click and the schedule becomes a no-op", async () => {
        const t = setup("u1|s");
        await startH(t.ctx, { eventId: EVENT_ID, withCountdown: true });
        vi.setSystemTime(T0 + 3000);
        await nowH(t.ctx, { eventId: EVENT_ID });
        const size = t.humanPackSize();
        const deadline =
            T0 + 3000 + pickTimerSecondsForCardsRemaining(size)! * 1000;
        expect(t.event().draftStartsAt).toBe(T0 + 3000);
        expect(t.humanSeat().pickDeadline).toBe(deadline);
        // The originally scheduled job fires later: nothing moves.
        vi.setSystemTime(T0 + DRAFT_COUNTDOWN_SECONDS * 1000);
        await beginH(t.ctx, { eventId: EVENT_ID });
        expect(t.humanSeat().pickDeadline).toBe(deadline);
        expect(t.humanPackSize()).toBe(size);
    });

    it("only the creator may Start now", async () => {
        const t = setup("u1|s");
        await startH(t.ctx, { eventId: EVENT_ID, withCountdown: true });
        const other = setup("u2|s");
        other.event().status = "started";
        other.event().seed = 1;
        other.event().draftStartsAt = T0 + 1;
        await expect(nowH(other.ctx, { eventId: EVENT_ID })).rejects.toThrow(
            /creator/
        );
    });

    it("without the flag, start deals immediately (unchanged)", async () => {
        const t = setup("u1|s");
        await startH(t.ctx, { eventId: EVENT_ID });
        expect(t.event().draftStartsAt).toBeUndefined();
        expect(t.event().draftRound).toBe(0);
        expect(t.botPicks()).toBe(7);
    });
});
