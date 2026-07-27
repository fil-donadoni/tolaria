// Round-cascade RECOVERY (`nudgeEventRounds`) — the entry point a stuck event
// was missing.
//
// Provenance: a live 7-seat event sat at `currentRound: 1` with round 1 fully
// decided (a bye for the human seat plus three simulated bot-vs-bot pairings)
// and never opened round 2. Every OTHER path that can advance a round is
// unreachable from that state by construction — `openPlayPhaseIfReady`
// self-gates on `!areRoundsRunning`, `recordLimitedPairingResult` needs an
// undecided human pairing, and `expireRoundDeadline` returns early on both a
// missing `deadlineAt` and an already-complete round — so the event was stuck
// for good. The same state is reachable on the current engine whenever
// `cascadeEventRounds` throws, since both of its callers deliberately swallow
// that throw to keep the recorded result.
//
// The project has no convex-test harness (see `convex/__tests__/adminAuth.test.ts`),
// so — exactly as `limitedRoundDeadline.test.ts` and `limitedPlayPhaseGate.test.ts`
// do — this drives the REGISTERED mutation's own handler against a stub
// `MutationCtx` carrying a real auth identity, and asserts the DOCUMENT it
// leaves behind.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { nudgeEventRounds } from "../limitedEvents";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { makeRng } from "../gre/rng";
import type { LimitedEventRow } from "../limited/eventProjection";
import {
    buildEmptySeats,
    assignFreeSeat,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import { getRuntimeBoosterConfig } from "../limited/registry";
import { openRound, isRoundComplete } from "../limited/rounds";
import type { LimitedRound } from "../limited/eventTypes";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** Deterministic per-seat strength — the numeric model is irrelevant here,
 *  only that every bot-vs-bot pairing resolves. Same shape as
 *  `limitedRoundDeadline.test.ts`'s. */
const seatStrength = (seatIndex: number) => ({ mean: 2 + seatIndex * 0.1 });

/** The reported event, rebuilt: 7 seats (seat 0 human, 1-6 bots), so round 1
 *  hands the odd seat out a bye and simulates the other three pairings — the
 *  whole round comes back decided with no human pairing to play, and no
 *  deadline to fire. `roundsForSeatCount(7)` is 3, so there ARE further rounds
 *  to open; the event is stuck, not finished.
 *
 *  The event id is load-bearing, not arbitrary: round 1's pairing stream is
 *  seeded from `(eventId, roundNumber)` alone (`roundPairingSeed`), and at
 *  round 1 every seat has the same score, so WHICH seat draws the bye is
 *  decided by that stream. `event-nudge-4` is an id whose stream hands it to
 *  seat 0 — the human — which is the reported state (a player with a bye and
 *  every other pairing simulated). Change the id and the bye moves to a bot,
 *  leaving a human pairing undecided and the round legitimately incomplete. */
function stuckEvent(options?: {
    seatCount?: number;
    status?: LimitedEventRow["status"];
    roundDeadlineMinutes?: number;
}): LimitedEventRow {
    const seatCount = options?.seatCount ?? 7;
    const packSlots = ["lea"];
    const seats = generateSealedPools(
        fillBotSeats(
            assignFreeSeat(buildEmptySeats(seatCount), "alice", "Alice")
        ),
        packSlots,
        6,
        getRuntimeBoosterConfig,
        resolveCardMeta,
        makeRng(1628)
    );
    const round = openRound({
        eventId: "event-nudge-4",
        roundNumber: 1,
        seats,
        previousRounds: [],
        matchFormat: "bo3",
        startedAt: 0,
        roundDeadlineMinutes: options?.roundDeadlineMinutes,
        seatStrength,
    });
    return {
        _id: "event-nudge-4",
        createdBy: "alice",
        type: "sealed",
        status: options?.status ?? "playing",
        seatCount,
        packSlots,
        sealedBoosterCount: 6,
        matchFormat: "bo3",
        roundDeadlineMinutes: options?.roundDeadlineMinutes,
        currentRound: 1,
        rounds: [round],
        seats,
        createdAt: 0,
        updatedAt: 0,
    } as unknown as LimitedEventRow;
}

interface StubCtxHandle {
    ctx: MutationCtx;
    row: () => Record<string, unknown>;
    scheduledCalls: { delayMs: number; args: Record<string, unknown> }[];
}

function makeStubCtx(
    event: Record<string, unknown>,
    callerUserId: string
): StubCtxHandle {
    const docs = new Map<string, Record<string, unknown>>([
        [event._id as string, { ...event }],
        ["alice", { _id: "alice", nickname: "Alice" }],
        ["mallory", { _id: "mallory", nickname: "Mallory" }],
    ]);
    const scheduledCalls: { delayMs: number; args: Record<string, unknown> }[] =
        [];
    const ctx = {
        // `auth.getUserId` reads `ctx.auth.getUserIdentity()`, whose `subject`
        // is `<userId>|<sessionId>`.
        auth: {
            getUserIdentity: async () => ({
                subject: `${callerUserId}|session1`,
            }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            patch: async (id: string, patch: Record<string, unknown>) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            query: () => ({
                withIndex: () => ({
                    collect: async () => [],
                    unique: async () => null,
                    take: async () => [],
                }),
            }),
        },
        scheduler: {
            runAfter: async (
                delayMs: number,
                _fn: unknown,
                args: Record<string, unknown>
            ) => {
                scheduledCalls.push({ delayMs, args });
            },
        },
    };
    return {
        ctx: ctx as unknown as MutationCtx,
        row: () => docs.get(event._id as string)!,
        scheduledCalls,
    };
}

const runNudge = async (ctx: MutationCtx, eventId: string) =>
    await (
        nudgeEventRounds as unknown as {
            _handler: (
                ctx: MutationCtx,
                args: { eventId: Id<"limitedEvents"> }
            ) => Promise<boolean>;
        }
    )._handler(ctx, { eventId: eventId as Id<"limitedEvents"> });

describe("nudgeEventRounds — recovers an event stuck on a decided round", () => {
    it("opens the next round for the reported 7-seat bye + all-bots state", async () => {
        const event = stuckEvent();
        // The precondition that made the event unreachable: round 1 fully
        // decided, the human's slot a bye (nothing to play), no deadline.
        expect(isRoundComplete(event.rounds![0])).toBe(true);
        expect(
            event.rounds![0].pairings.some((p) => p.seatB === undefined)
        ).toBe(true);
        expect(event.rounds![0].deadlineAt).toBeUndefined();

        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>,
            "alice"
        );
        const advanced = await runNudge(ctx, "event-nudge-4");

        expect(advanced).toBe(true);
        const after = row();
        expect(after.currentRound).toBe(2);
        const rounds = after.rounds as LimitedRound[];
        expect(rounds).toHaveLength(2);
        expect(rounds[1].roundNumber).toBe(2);
        // Round 2 stops at the human: their pairing is the one thing the
        // cascade cannot decide, which is what makes the event playable again
        // instead of silently simulating the player's match.
        const humanPairing = rounds[1].pairings.find(
            (p) => p.seatA === 0 || p.seatB === 0
        )!;
        expect(humanPairing.result).toBeUndefined();
        expect(after.status).toBe("playing");
    });

    it("schedules the newly opened round's deadline when the event has one", async () => {
        const { ctx, row, scheduledCalls } = makeStubCtx(
            stuckEvent({
                roundDeadlineMinutes: 50,
            }) as unknown as Record<string, unknown>,
            "alice"
        );
        await runNudge(ctx, "event-nudge-4");

        expect(row().currentRound).toBe(2);
        expect(scheduledCalls).toHaveLength(1);
        expect(scheduledCalls[0].args).toEqual({
            eventId: "event-nudge-4",
            roundNumber: 2,
        });
    });

    it("finishes the event when the cascade runs out of rounds", async () => {
        // 2 seats, both bots except the human — one round total
        // (`roundsForSeatCount(2)` is 1), so a complete round 1 means the
        // event is over rather than advanceable.
        const event = stuckEvent({ seatCount: 2 });
        // Both seats present means no bye; seat 0 is human, so round 1 is NOT
        // auto-decided — force the state this test is about.
        event.rounds![0].pairings[0].result = {
            winsA: 2,
            winsB: 0,
            source: "played",
        };
        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>,
            "alice"
        );

        expect(await runNudge(ctx, "event-nudge-4")).toBe(true);
        expect(row().status).toBe("finished");
    });

    it("is a no-op — and reports it — when the latest round is still being played", async () => {
        const event = stuckEvent({ seatCount: 8 });
        // 8 seats: no bye, and seat 0's pairing has a human in it, so round 1
        // comes back undecided. Nothing to recover.
        expect(isRoundComplete(event.rounds![0])).toBe(false);

        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>,
            "alice"
        );
        expect(await runNudge(ctx, "event-nudge-4")).toBe(false);
        expect(row().currentRound).toBe(1);
        expect((row().rounds as LimitedRound[]).length).toBe(1);
    });

    it("is a no-op on an event whose rounds are not running", async () => {
        const { ctx, row } = makeStubCtx(
            stuckEvent({ status: "finished" }) as unknown as Record<
                string,
                unknown
            >,
            "alice"
        );
        expect(await runNudge(ctx, "event-nudge-4")).toBe(false);
        expect((row().rounds as LimitedRound[]).length).toBe(1);
    });

    it("rejects a caller with no Seat at the table", async () => {
        const { ctx, row } = makeStubCtx(
            stuckEvent() as unknown as Record<string, unknown>,
            "mallory"
        );
        await expect(runNudge(ctx, "event-nudge-4")).rejects.toThrow(
            /do not have a Seat/
        );
        // And left the event exactly as it was.
        expect(row().currentRound).toBe(1);
        expect((row().rounds as LimitedRound[]).length).toBe(1);
    });

    it("is idempotent — a second nudge on the advanced event does nothing", async () => {
        const { ctx, row } = makeStubCtx(
            stuckEvent() as unknown as Record<string, unknown>,
            "alice"
        );
        expect(await runNudge(ctx, "event-nudge-4")).toBe(true);
        const afterFirst = JSON.stringify(row().rounds);

        expect(await runNudge(ctx, "event-nudge-4")).toBe(false);
        expect(JSON.stringify(row().rounds)).toBe(afterFirst);
        expect(row().currentRound).toBe(2);
    });
});
