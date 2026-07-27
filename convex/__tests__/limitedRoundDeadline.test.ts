// Round deadline expiry (PRD #1628 stories 3/32-35, ADR 0076, issue #1647):
// "when the deadline expires, every undecided pairing is closed... the round
// advances exactly as if the results had been played."
//
// The project has no convex-test harness (see `convex/__tests__/adminAuth.test.ts`),
// so — exactly as `limitedPlayPhaseOpen.test.ts` and `limitedPairingMatch.test.ts`
// do — this drives the REGISTERED `expireRoundDeadline` internalMutation's own
// handler against a stub `MutationCtx`, and asserts the DOCUMENT it leaves
// behind through the real projection.
import { describe, it, expect } from "vitest";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { expireRoundDeadline, scheduleRoundDeadline } from "../limitedEvents";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { makeRng } from "../gre/rng";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
import {
    buildEmptySeats,
    assignFreeSeat,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import { getRuntimeBoosterConfig } from "../limited/registry";
import { openRound } from "../limited/rounds";
import type { LimitedRound } from "../limited/eventTypes";

// ── The exact resolver wiring `convex/limitedEvents.ts` injects — identical
// to `limitedPlayPhaseOpen.test.ts`'s own copy. ───────────────────────────────

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** A real 8-seat LEA Sealed event, already in the PLAY PHASE with round 1
 *  open: seat 0 is human, seats 1-7 are bots. `roundDeadlineMinutes` controls
 *  whether/when round 1's deadline has already elapsed relative to the REAL
 *  clock — every test computes it from `Date.now()` rather than faking
 *  timers, since `expireRoundDeadline` (like `autoPickSeatTimeout`) reads
 *  `Date.now()` itself. */
function eventWithOpenRound(options?: {
    seatCount?: number;
    roundDeadlineMinutes?: number;
    /** Minutes before "now" the round started. */
    startedMinutesAgo?: number;
    status?: LimitedEventRow["status"];
}): LimitedEventRow {
    const seatCount = options?.seatCount ?? 8;
    const roundDeadlineMinutes = options?.roundDeadlineMinutes;
    const startedAt = Date.now() - (options?.startedMinutesAgo ?? 0) * 60_000;
    const packSlots = ["lea"];
    const seats = generateSealedPools(
        fillBotSeats(
            assignFreeSeat(buildEmptySeats(seatCount), "user1", "Alice")
        ),
        packSlots,
        6,
        getRuntimeBoosterConfig,
        resolveCardMeta,
        makeRng(1647)
    );

    const cache = new Map<number, number>();
    const seatStrength = (seatIndex: number) => {
        const cached = cache.get(seatIndex);
        if (cached !== undefined) return { mean: cached };
        // A cheap, deterministic-per-seat "strength" — the exact numeric
        // scoring model doesn't matter to this test, only that bot-vs-bot
        // pairings always resolve (never a human seat asked for a strength).
        const strength = 2 + seatIndex * 0.1;
        cache.set(seatIndex, strength);
        return { mean: strength };
    };

    const round = openRound({
        eventId: "event-1647",
        roundNumber: 1,
        seats,
        previousRounds: [],
        matchFormat: "bo3",
        startedAt,
        roundDeadlineMinutes,
        seatStrength,
    });

    return {
        _id: "event-1647",
        createdBy: "user1",
        type: "sealed",
        status: options?.status ?? "playing",
        seatCount,
        packSlots,
        sealedBoosterCount: 6,
        matchFormat: "bo3",
        roundDeadlineMinutes,
        currentRound: 1,
        rounds: [round],
        seats,
        createdAt: 0,
        updatedAt: 0,
    };
}

// ── Stub MutationCtx — same idiom as `limitedPlayPhaseOpen.test.ts` ─────────

interface StubCtxHandle {
    ctx: MutationCtx;
    row: () => Record<string, unknown>;
    scheduledCalls: { delayMs: number; args: Record<string, unknown> }[];
}

function makeStubCtx(event: Record<string, unknown>): StubCtxHandle {
    const docs = new Map<string, Record<string, unknown>>([
        [event._id as string, { ...event }],
    ]);
    const scheduledCalls: { delayMs: number; args: Record<string, unknown> }[] =
        [];
    const ctx = {
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

const runExpireRoundDeadline = async (
    ctx: MutationCtx,
    eventId: string,
    roundNumber: number
) =>
    await (
        expireRoundDeadline as unknown as {
            _handler: (
                ctx: MutationCtx,
                args: { eventId: Id<"limitedEvents">; roundNumber: number }
            ) => Promise<null>;
        }
    )._handler(ctx, {
        eventId: eventId as Id<"limitedEvents">,
        roundNumber,
    });

describe("expireRoundDeadline — closes the round and advances it (issue #1647)", () => {
    it("closes the human's undecided pairing 0-2, marked timeout, and advances to round 2", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 1,
            startedMinutesAgo: 2, // deadline was 1 minute after start -> already 1 minute past
        });
        const round1BeforeExpiry = event.rounds![0];
        const humanPairing = round1BeforeExpiry.pairings.find(
            (p) => p.seatA === 0 || p.seatB === 0
        )!;
        expect(humanPairing.result).toBeUndefined();
        const simulatedPairings = round1BeforeExpiry.pairings.filter(
            (p) => p !== humanPairing
        );
        expect(simulatedPairings).toHaveLength(3);

        const { ctx, row, scheduledCalls } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        const after = row();
        const rounds = after.rounds as LimitedRound[];
        const closedRound1 = rounds[0];
        const closedHumanPairing = closedRound1.pairings.find(
            (p) => p.seatA === 0 || p.seatB === 0
        )!;

        // The human is the absent side, whichever seat slot they're in.
        const humanIsSeatA = closedHumanPairing.seatA === 0;
        expect(closedHumanPairing.result).toEqual({
            winsA: humanIsSeatA ? 0 : 2,
            winsB: humanIsSeatA ? 2 : 0,
            source: "timeout",
        });

        // The three already-simulated pairings are untouched (never rewritten).
        for (const original of simulatedPairings) {
            const stillThere = closedRound1.pairings.find(
                (p) => p.seatA === original.seatA && p.seatB === original.seatB
            )!;
            expect(stillThere.result).toEqual(original.result);
        }

        // The round advances exactly like a played result: round 2 opens.
        expect(after.currentRound).toBe(2);
        expect(rounds).toHaveLength(2);
        expect(rounds[1].roundNumber).toBe(2);
        expect(after.status).toBe("playing");

        // Round 2 also got its own deadline scheduled (issue #1647: the
        // schedule must not silently stop after round 1).
        expect(scheduledCalls).toHaveLength(1);
        expect(scheduledCalls[0].args.roundNumber).toBe(2);
        expect(scheduledCalls[0].args.eventId).toBe("event-1647");
    });

    it("reaches the client as a real timeout result through the projection", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 1,
            startedMinutesAgo: 2,
        });
        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        const view = projectLimitedEvent(
            row() as unknown as LimitedEventRow,
            "user1"
        );
        const round1 = view.rounds[0];
        const closedHumanPairing = round1.pairings.find(
            (p) => p.seatA === 0 || p.seatB === 0
        )!;
        expect(closedHumanPairing.result?.source).toBe("timeout");
        // Standings reflect the timeout loss: the human scored 0 points.
        const humanRow = view.standings.find((r) => r.seatIndex === 0)!;
        expect(humanRow.points).toBe(0);
        expect(humanRow.matchLosses).toBe(1);
    });

    it("never rewrites a round that was already fully decided before the deadline fired", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 1,
            startedMinutesAgo: 2,
        });
        // Simulate the human having already played and won, exactly what
        // `recordPlayedPairing` would have written.
        const round1 = event.rounds![0];
        const decidedRound1: LimitedRound = {
            ...round1,
            pairings: round1.pairings.map((p) =>
                p.seatA === 0 || p.seatB === 0
                    ? {
                          ...p,
                          result: {
                              winsA: 2,
                              winsB: 1,
                              source: "played" as const,
                          },
                      }
                    : p
            ),
        };
        event.rounds = [decidedRound1];

        const { ctx, row, scheduledCalls } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        // No-op: the round was already complete, so nothing is patched at
        // all — not even an advance (a played result advancing the round is
        // `recordLimitedPairingResult`'s job, not the deadline's).
        expect(row().updatedAt).toBe(event.updatedAt);
        expect(row().currentRound).toBe(1);
        expect(scheduledCalls).toHaveLength(0);
    });

    it("a rescheduled or superseded timer cannot fire twice for the same round", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 1,
            startedMinutesAgo: 2,
        });
        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );

        await runExpireRoundDeadline(ctx, "event-1647", 1);
        const afterFirst = { ...row() };

        // A second firing of the exact same schedule (e.g. a duplicate
        // `runAfter`, or this handler racing its own earlier invocation).
        await runExpireRoundDeadline(ctx, "event-1647", 1);
        const afterSecond = row();

        expect(afterSecond).toEqual(afterFirst);
    });

    it("an event with no deadline configured never times out", async () => {
        const event = eventWithOpenRound({ roundDeadlineMinutes: undefined });
        expect(event.rounds![0].deadlineAt).toBeUndefined();
        const humanPairingBefore = event.rounds![0].pairings.find(
            (p) => p.seatA === 0 || p.seatB === 0
        )!;
        expect(humanPairingBefore.result).toBeUndefined();

        const { ctx, row, scheduledCalls } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        // A stray/erroneous firing (defence in depth — this schedule should
        // never even have been armed for a deadline-less round).
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        const humanPairingAfter = (
            row().rounds as LimitedRound[]
        )[0].pairings.find((p) => p.seatA === 0 || p.seatB === 0)!;
        expect(humanPairingAfter.result).toBeUndefined();
        expect(row().currentRound).toBe(1);
        expect(scheduledCalls).toHaveLength(0);
    });

    it("never closes anything for a round whose deadline hasn't elapsed yet", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 50,
            startedMinutesAgo: 1, // deadline is 49 minutes from now
        });
        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        const humanPairingAfter = (
            row().rounds as LimitedRound[]
        )[0].pairings.find((p) => p.seatA === 0 || p.seatB === 0)!;
        expect(humanPairingAfter.result).toBeUndefined();
    });

    it("no-ops once the event has already finished", async () => {
        const event = eventWithOpenRound({
            roundDeadlineMinutes: 1,
            startedMinutesAgo: 2,
            status: "finished",
        });
        const { ctx, row } = makeStubCtx(
            event as unknown as Record<string, unknown>
        );
        await runExpireRoundDeadline(ctx, "event-1647", 1);

        expect(row().updatedAt).toBe(event.updatedAt);
    });

    it("no-ops when the event row no longer exists", async () => {
        const { ctx } = makeStubCtx({
            _id: "some-other-event",
        } as unknown as Record<string, unknown>);
        // Should simply return without throwing.
        await expect(
            runExpireRoundDeadline(ctx, "event-1647", 1)
        ).resolves.toBeNull();
    });
});

describe("scheduleRoundDeadline (issue #1647)", () => {
    function schedulerStub() {
        const calls: { delayMs: number; args: unknown }[] = [];
        const ctx = {
            scheduler: {
                runAfter: async (
                    delayMs: number,
                    _fn: unknown,
                    args: unknown
                ) => {
                    calls.push({ delayMs, args });
                },
            },
        };
        return { ctx: ctx as unknown as MutationCtx, calls };
    }

    it("never schedules when the round has no configured deadline", async () => {
        const { ctx, calls } = schedulerStub();
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            pairings: [{ seatA: 0, seatB: 1 }],
        };
        await scheduleRoundDeadline(
            ctx,
            "event-x" as Id<"limitedEvents">,
            round,
            0
        );
        expect(calls).toHaveLength(0);
    });

    it("never schedules when the round is already fully decided", async () => {
        const { ctx, calls } = schedulerStub();
        const round: LimitedRound = {
            roundNumber: 1,
            startedAt: 0,
            deadlineAt: 5000,
            pairings: [
                { seatA: 0, result: { winsA: 2, winsB: 0, source: "bye" } },
            ],
        };
        await scheduleRoundDeadline(
            ctx,
            "event-x" as Id<"limitedEvents">,
            round,
            0
        );
        expect(calls).toHaveLength(0);
    });

    it("schedules exactly one firing, at the deadline's remaining delay", async () => {
        const { ctx, calls } = schedulerStub();
        const round: LimitedRound = {
            roundNumber: 2,
            startedAt: 1000,
            deadlineAt: 4000,
            pairings: [{ seatA: 0, seatB: 1 }],
        };
        await scheduleRoundDeadline(
            ctx,
            "event-x" as Id<"limitedEvents">,
            round,
            1000
        );
        expect(calls).toEqual([
            { delayMs: 3000, args: { eventId: "event-x", roundNumber: 2 } },
        ]);
    });
});
