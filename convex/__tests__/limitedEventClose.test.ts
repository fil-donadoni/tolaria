// Issue #2357: "close a Limited Event" (the creator's one whole-life close
// action) + the viewer's own match record on a list row. Two things this
// file proves that no pre-existing file does:
//
//  1. `viewerMatchRecordFor`/`projectEventSummary`'s derived record — blank
//     before the play phase, present (even at 0-0) once rounds are running,
//     final once concluded, draws surfaced only when non-zero — round-tripped
//     through `limitedEventSummaryValidator` (the REAL validator the wire
//     boundary checks at runtime), the same idiom
//     `limitedEventViewValidator.test.ts` uses for the detail view.
//  2. `cancelLimitedEvent`'s REAL registered handler, branch by branch — the
//     hand-mirror in `limitedEvents.test.ts` proves the same logic in
//     isolation; this drives the actual `_handler` Convex deploys.
//  3. `autoPickSeatTimeout` no-ops once the event has concluded — the sibling
//     scheduled callbacks (`expireRoundDeadline`, `nudgeEventRounds`) already
//     carry this exact case in their own files
//     (`limitedRoundDeadline.test.ts`, `limitedRoundNudge.test.ts`); this one
//     didn't have it yet.
import { describe, it, expect } from "vitest";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import {
    cancelLimitedEvent,
    autoPickSeatTimeout,
    myLimitedEvents,
    myCurrentLimitedEvents,
    projectEventSummary,
    limitedEventSummaryValidator,
    viewerMatchRecordFor,
} from "../limitedEvents";
import { type InMemoryRow, makeInMemoryDb } from "./fixtures/inMemoryDb";
import { validatorJsonOf, validationErrors } from "./fixtures/validatorWalk";
import { buildEmptySeats, assignFreeSeat } from "../limited/eventLogic";
import { UI_GATE_LABEL_PREFIX, UI_GATE_OPEN_LABEL } from "../limitedFixtures";
import type { LimitedRound } from "../limited/eventTypes";

const summaryValidatorJson = validatorJsonOf(limitedEventSummaryValidator);

/** A minimal 2-seat event row — enough for `viewerMatchRecordFor` and
 *  `projectEventSummary`; not a real Sealed/Draft table (no Pools), which
 *  neither function reads. Cast through `Doc<"limitedEvents">` the same way
 *  the rest of this test suite does when it needs the schema-shaped row
 *  (`limitedEvents.test.ts:1645`). */
function buildEvent(overrides: {
    status: Doc<"limitedEvents">["status"];
    rounds?: LimitedRound[];
    label?: string;
}): Doc<"limitedEvents"> {
    let seats = buildEmptySeats(2);
    seats = assignFreeSeat(seats, "user1", "Alice");
    seats = assignFreeSeat(seats, "user2", "Bob");
    return {
        _id: "event-2357" as Id<"limitedEvents">,
        _creationTime: 0,
        createdBy: "user1",
        type: "sealed",
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        seats,
        createdAt: 0,
        updatedAt: 0,
        ...overrides,
    } as unknown as Doc<"limitedEvents">;
}

describe("viewerMatchRecordFor (issue #2357): the list row's derived match record", () => {
    it("is blank while seating is open — never a 0-0", () => {
        const event = buildEvent({ status: "open" });
        expect(viewerMatchRecordFor(event, "user1")).toBeUndefined();
    });

    it("is blank during draft/deckbuild — the event hasn't reached the play phase", () => {
        const event = buildEvent({ status: "started" });
        expect(viewerMatchRecordFor(event, "user1")).toBeUndefined();
    });

    it("is present (even 0-0) once rounds are running, before any pairing is decided", () => {
        const event = buildEvent({
            status: "playing",
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [{ seatA: 0, seatB: 1 }],
                },
            ],
        });
        expect(viewerMatchRecordFor(event, "user1")).toEqual({
            wins: 0,
            losses: 0,
            draws: 0,
        });
    });

    it("reports the viewer's OWN seat, not the event's aggregate — partial mid-Rounds", () => {
        const event = buildEvent({
            status: "playing",
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
            ],
        });
        expect(viewerMatchRecordFor(event, "user1")).toEqual({
            wins: 1,
            losses: 0,
            draws: 0,
        });
        // The OPPONENT's own record, symmetric — proves this is keyed by
        // seat, not a single event-wide number reused for every viewer.
        expect(viewerMatchRecordFor(event, "user2")).toEqual({
            wins: 0,
            losses: 1,
            draws: 0,
        });
    });

    it("keys the row by seatIndex, not by position in the SORTED standings", () => {
        // `computeStandings` returns rows sorted by points, so on a two-seat
        // event the winner's seatIndex and its sort position coincide and
        // `standings[seatIndex]` reads correctly by accident. Three seats
        // where the LAST seat wins everything breaks that coincidence: the
        // viewer at seat 0 sits at sort position 1+, so a positional lookup
        // hands back the leader's record instead of the viewer's.
        let seats = buildEmptySeats(3);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        seats = assignFreeSeat(seats, "user3", "Carol");
        const event = {
            ...buildEvent({ status: "finished" }),
            seatCount: 3,
            seats,
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 2,
                            seatB: 0,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
                {
                    roundNumber: 2,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 2,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
            ],
        } as unknown as Doc<"limitedEvents">;

        // Seat 2 is the leader, so it is standings[0].
        expect(viewerMatchRecordFor(event, "user3")).toEqual({
            wins: 2,
            losses: 0,
            draws: 0,
        });
        // Seat 0 lost — a positional read would report the leader's 2-0.
        expect(viewerMatchRecordFor(event, "user1")).toEqual({
            wins: 0,
            losses: 1,
            draws: 0,
        });
    });

    it("is blank on a force-closed event that never paired anyone — not a 0-0", () => {
        // The flow this whole issue exists to create: the creator closes a
        // stalled deckbuilding table, so the status jumps straight to the
        // terminal one with no rounds ever created. The phase gate alone
        // passes here (`isEventConcluded` is true), and
        // `computeStandings(seats, [])` would hand back a zeroed row — the
        // `0-0` the AC forbids. Emptiness has to be read off the DATA.
        const event = buildEvent({ status: "finished" });
        expect(event.rounds).toBeUndefined();
        expect(viewerMatchRecordFor(event, "user1")).toBeUndefined();
    });

    it("is final once concluded, with draws surfaced only when the viewer has one", () => {
        const event = buildEvent({
            status: "finished",
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
                {
                    roundNumber: 2,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 1, winsB: 1, source: "played" },
                        },
                    ],
                },
            ],
        });
        expect(viewerMatchRecordFor(event, "user1")).toEqual({
            wins: 1,
            losses: 0,
            draws: 1,
        });
    });

    it("is blank for a viewer holding no Seat in the event", () => {
        const event = buildEvent({
            status: "finished",
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
            ],
        });
        expect(viewerMatchRecordFor(event, "someone-else")).toBeUndefined();
    });

    it("is blank for an unauthenticated (null) viewer", () => {
        const event = buildEvent({ status: "finished" });
        expect(viewerMatchRecordFor(event, null)).toBeUndefined();
    });
});

describe("projectEventSummary round-trips viewerMatchRecord through the REAL limitedEventSummaryValidator (issue #2357)", () => {
    function ctxFor(event: Doc<"limitedEvents">): QueryCtx {
        return makeInMemoryDb({
            limitedEvents: [event as unknown as InMemoryRow],
        }).ctx as unknown as QueryCtx;
    }

    it("a concluded event's summary passes return validation, record included", async () => {
        const event = buildEvent({
            status: "finished",
            rounds: [
                {
                    roundNumber: 1,
                    startedAt: 0,
                    pairings: [
                        {
                            seatA: 0,
                            seatB: 1,
                            result: { winsA: 2, winsB: 0, source: "played" },
                        },
                    ],
                },
            ],
        });
        const summary = await projectEventSummary(
            ctxFor(event),
            event,
            "user1"
        );
        expect(summary.viewerMatchRecord).toEqual({
            wins: 1,
            losses: 0,
            draws: 0,
        });
        expect(validationErrors(summary, summaryValidatorJson)).toEqual([]);
    });

    it("an open event's summary passes validation with viewerMatchRecord undefined", async () => {
        const event = buildEvent({ status: "open" });
        const summary = await projectEventSummary(
            ctxFor(event),
            event,
            "user1"
        );
        expect(summary.viewerMatchRecord).toBeUndefined();
        expect(validationErrors(summary, summaryValidatorJson)).toEqual([]);
    });

    // Issue #2822: `label` is the handle `check:ui` addresses its seeded
    // fixture by, and this projection is the ONLY hop of the chain
    // (schema -> summary validator -> `/limited?label=` filter ->
    // `data-limited-event-label`) that nothing else can see fail. The
    // validator conformance walk above cannot catch a dropped `label`
    // because the field is `v.optional`, and both frontend suites mock the
    // query — so a convex-only refactor that drops the line keeps the whole
    // gate green and the lane silently reports "no seeded Limited fixture on
    // this deployment" on a deployment where the fixture IS seeded.
    it("carries the event's `label` onto the list row — the handle the ui-gate fixture is addressed by (issue #2822)", async () => {
        const event = buildEvent({
            status: "open",
            label: UI_GATE_OPEN_LABEL,
        });
        const summary = await projectEventSummary(
            ctxFor(event),
            event,
            "user1"
        );
        expect(summary.label).toBe(UI_GATE_OPEN_LABEL);
        // The prefix filter `/limited?label=ui-gate/` narrows on exactly this
        // projected string, so assert the property the page's `startsWith`
        // relies on rather than only the equality above.
        expect(summary.label?.startsWith(UI_GATE_LABEL_PREFIX)).toBe(true);
        expect(validationErrors(summary, summaryValidatorJson)).toEqual([]);
    });

    it("leaves `label` undefined for an unlabelled event — the field is optional, not defaulted", async () => {
        const event = buildEvent({ status: "open" });
        const summary = await projectEventSummary(
            ctxFor(event),
            event,
            "user1"
        );
        expect(summary.label).toBeUndefined();
        expect(validationErrors(summary, summaryValidatorJson)).toEqual([]);
    });

    it("would REJECT a summary field the validator doesn't declare — proves the check has teeth", async () => {
        const event = buildEvent({ status: "open" });
        const summary = await projectEventSummary(
            ctxFor(event),
            event,
            "user1"
        );
        const withDrift = { ...summary, someFutureField: 1 };
        expect(validationErrors(withDrift, summaryValidatorJson)).toEqual([
            "<return>.someFutureField: EXTRA field, absent from the returns validator",
        ]);
    });
});

describe("cancelLimitedEvent — the REAL registered handler (issue #2357)", () => {
    // `getCurrentUser` reads `ctx.db.get(userId)` after auth resolves the
    // subject — both seats need a row for `getCurrentUser`/creator-ownership
    // to resolve at all.
    const USERS = [
        { _id: "user1", nickname: "Alice" },
        { _id: "user2", nickname: "Bob" },
    ];

    function runCancel(ctx: MutationCtx, eventId: Id<"limitedEvents">) {
        return (
            cancelLimitedEvent as unknown as {
                _handler: (
                    ctx: MutationCtx,
                    args: { eventId: Id<"limitedEvents"> }
                ) => Promise<null>;
            }
        )._handler(ctx, { eventId });
    }

    it("seating still open: the creator's close hard-deletes the event row", async () => {
        const event = buildEvent({ status: "open" });
        const db = makeInMemoryDb(
            {
                users: USERS,
                limitedEvents: [event as unknown as InMemoryRow],
            },
            { identitySubject: "user1|session1" }
        );
        await runCancel(db.ctx, event._id);
        expect(db.tables.limitedEvents).toHaveLength(0);
    });

    it("started (mid-deckbuild): the creator's close force-finishes it in place — seats/rounds untouched", async () => {
        const event = buildEvent({ status: "started" });
        const db = makeInMemoryDb(
            {
                users: USERS,
                limitedEvents: [event as unknown as InMemoryRow],
            },
            { identitySubject: "user1|session1" }
        );
        await runCancel(db.ctx, event._id);
        expect(db.tables.limitedEvents).toHaveLength(1);
        const row = db.tables.limitedEvents[0];
        expect(row.status).toBe("finished");
        expect(row.seats).toEqual(event.seats);
    });

    it("playing (mid-Round): force-finishes without touching decided or undecided Pairings", async () => {
        const rounds: LimitedRound[] = [
            {
                roundNumber: 1,
                startedAt: 0,
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 0, source: "played" },
                    },
                ],
            },
            {
                // Round 2 is still undecided — closing must NOT assign it a
                // winner (issue #2357 AC: "no undecided Pairing gains a
                // result").
                roundNumber: 2,
                startedAt: 0,
                pairings: [{ seatA: 0, seatB: 1 }],
            },
        ];
        const event = buildEvent({ status: "playing", rounds });
        const db = makeInMemoryDb(
            {
                users: USERS,
                limitedEvents: [event as unknown as InMemoryRow],
            },
            { identitySubject: "user1|session1" }
        );
        await runCancel(db.ctx, event._id);
        const row = db.tables.limitedEvents[0];
        expect(row.status).toBe("finished");
        expect(row.rounds).toEqual(rounds);
        // Standings count only the decided round — the undecided one
        // contributes nothing to either seat.
        const record = viewerMatchRecordFor(
            row as unknown as Doc<"limitedEvents">,
            "user1"
        );
        expect(record).toEqual({ wins: 1, losses: 0, draws: 0 });
    });

    it("already concluded: a second close is an idempotent no-op — the row is untouched", async () => {
        const event = buildEvent({ status: "finished" });
        const db = makeInMemoryDb(
            {
                users: USERS,
                limitedEvents: [event as unknown as InMemoryRow],
            },
            { identitySubject: "user1|session1" }
        );
        await runCancel(db.ctx, event._id);
        expect(db.writes).toHaveLength(0); // no patch, no delete
        expect(db.tables.limitedEvents[0].status).toBe("finished");
    });

    it("rejects a non-creator caller, at every phase", async () => {
        for (const status of [
            "open",
            "started",
            "playing",
            "finished",
        ] as const) {
            const event = buildEvent({ status });
            const db = makeInMemoryDb(
                {
                    users: USERS,
                    limitedEvents: [event as unknown as InMemoryRow],
                },
                { identitySubject: "user2|session2" }
            );
            await expect(runCancel(db.ctx, event._id)).rejects.toThrow(
                /Only the event's creator/
            );
        }
    });
});

describe("full path (issue #2357 AC): close removes the event from the in-progress surface and it appears on /limited/events with its concluded chip and record", () => {
    const USERS = [
        { _id: "user1", nickname: "Alice" },
        { _id: "user2", nickname: "Bob" },
    ];

    function runCancel(ctx: MutationCtx, eventId: Id<"limitedEvents">) {
        return (
            cancelLimitedEvent as unknown as {
                _handler: (
                    ctx: MutationCtx,
                    args: { eventId: Id<"limitedEvents"> }
                ) => Promise<null>;
            }
        )._handler(ctx, { eventId });
    }

    function runMyCurrentLimitedEvents(ctx: QueryCtx) {
        return (
            myCurrentLimitedEvents as unknown as {
                _handler: (ctx: QueryCtx) => Promise<unknown[]>;
            }
        )._handler(ctx);
    }

    function runMyLimitedEvents(ctx: QueryCtx) {
        return (
            myLimitedEvents as unknown as {
                _handler: (ctx: QueryCtx) => Promise<unknown[]>;
            }
        )._handler(ctx);
    }

    it("mid-Round close: the event leaves myCurrentLimitedEvents and shows up on myLimitedEvents finished, with the viewer's final record", async () => {
        const rounds: LimitedRound[] = [
            {
                roundNumber: 1,
                startedAt: 0,
                pairings: [
                    {
                        seatA: 0,
                        seatB: 1,
                        result: { winsA: 2, winsB: 1, source: "played" },
                    },
                ],
            },
        ];
        const event = buildEvent({ status: "playing", rounds });
        const db = makeInMemoryDb(
            {
                users: USERS,
                limitedEvents: [event as unknown as InMemoryRow],
            },
            { identitySubject: "user1|session1" }
        );

        // Before closing: the event is on BOTH the narrowed (in-progress)
        // and the full surface — it hasn't concluded yet.
        const beforeCurrent = await runMyCurrentLimitedEvents(db.ctx);
        expect(beforeCurrent).toHaveLength(1);
        const beforeAll = await runMyLimitedEvents(db.ctx);
        expect(beforeAll).toHaveLength(1);

        await runCancel(db.ctx, event._id);

        // After closing: dropped from the in-progress surface entirely.
        const afterCurrent = await runMyCurrentLimitedEvents(db.ctx);
        expect(afterCurrent).toHaveLength(0);

        // ...but still on the full (your-events) surface, concluded, with
        // the viewer's final match record — never a 0-0 (this event had a
        // real decided Pairing) and no draws surfaced (there were none).
        const afterAll = await runMyLimitedEvents(db.ctx);
        expect(afterAll).toHaveLength(1);
        const summary = afterAll[0] as {
            status: string;
            viewerMatchRecord?: { wins: number; losses: number; draws: number };
        };
        expect(summary.status).toBe("finished");
        expect(summary.viewerMatchRecord).toEqual({
            wins: 1,
            losses: 0,
            draws: 0,
        });
        // Round-tripped through the REAL returns validator, same as the
        // wire boundary checks at runtime.
        expect(validationErrors(summary, summaryValidatorJson)).toEqual([]);
    });
});

describe("autoPickSeatTimeout no-ops once the event has concluded (issue #2357 AC)", () => {
    /** A draft event whose seat 0 genuinely has something to Auto-Pick: a
     *  REAL `currentPack` (one card) plus a matching `pickSeq` — everything
     *  `autoPickSeatTimeout`'s preconditions (`event.type`, `event.seed`,
     *  `event.timerEnabled`, `event.draftCompletedAt`, the slim seat's
     *  `pickSeq`) and `resolveAutoPickTimeout` (`draftEngine.ts`) need to
     *  return a real pick id instead of `null` for a reason OTHER than the
     *  phase gate.
     *
     *  `hydrateSeats` (`limitedSeatStore.ts`) falls back to a seat's OWN
     *  inline `pool`/`currentPack` fields when no `limitedSeats` child row
     *  exists for it yet (the legacy-row tolerance) — so setting
     *  `currentPack` directly on the seat here is enough; no `limitedSeats`
     *  row needs seeding.
     *
     *  `draftPacksRemaining: 1` with a one-card pack means this single pick
     *  drains the pack AND (since `packSlots` — from `buildEvent` — has only
     *  one entry) completes the draft in the same `applyPick` call, so the
     *  fixture never needs `getRuntimeBoosterConfig`/real set data to deal a
     *  next round or pass a pack to seat 1. */
    function buildLiveDraftEvent(
        status: Doc<"limitedEvents">["status"]
    ): Doc<"limitedEvents"> {
        const event = buildEvent({ status });
        return {
            ...event,
            type: "draft" as const,
            seed: 1,
            timerEnabled: true,
            draftRound: 0,
            draftPacksRemaining: 1,
            seats: event.seats.map((s, i) =>
                i === 0
                    ? {
                          ...s,
                          isBot: false,
                          pickSeq: 3,
                          currentPack: [
                              {
                                  pickId: "r0-p0-c0",
                                  scryfallId: "test-card",
                                  cardId: "test-card",
                                  cardName: "Test Card",
                              },
                          ],
                      }
                    : s
            ),
        } as unknown as Doc<"limitedEvents">;
    }

    function runAutoPick(
        ctx: MutationCtx,
        eventId: Id<"limitedEvents">
    ): Promise<null> {
        const handler = (
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
        )._handler;
        return handler(ctx, { eventId, seatIndex: 0, expectedSeq: 3 });
    }

    it("positive control: the SAME fixture, with Auto-Picks legal (status started), actually Auto-Picks — proves the no-op below comes from the phase gate, not an inert fixture", async () => {
        const event = buildLiveDraftEvent("started");
        const db = makeInMemoryDb({
            limitedEvents: [event as unknown as InMemoryRow],
        });
        const result = await runAutoPick(db.ctx, event._id);
        // The handler's return type is always null (success or no-op) — the
        // proof of life is in the WRITES, not the return value.
        expect(result).toBeNull();
        expect(db.writes.length).toBeGreaterThan(0);

        // The event row's slim seat 0 shows the drained pack (poolCount
        // moved from 0 to 1)...
        const patchedEvent = db.tables.limitedEvents[0];
        const slimSeat0 = (patchedEvent.seats as { poolCount?: number }[])[0];
        expect(slimSeat0.poolCount).toBe(1);
        // ...and the heavy payload split off to `limitedSeats` shows the
        // actual picked card landed in the pool and the pack is gone.
        const seatRow = (db.tables.limitedSeats ?? []).find(
            (r) => r.seatIndex === 0
        );
        // Stored INTERNED (issue #2507): `scryfallId` is the only card
        // identity `limitedSeats` persists — `cardId`/`cardName` are resolved
        // back at the seam (`convex/limitedSeatStore.ts`).
        expect(seatRow?.pool).toEqual([{ scryfallId: "test-card" }]);
        expect(seatRow?.currentPack).toBeUndefined();
    });

    it("a stale Auto-Pick firing against a finished event does nothing", async () => {
        const event = buildLiveDraftEvent("finished");
        const db = makeInMemoryDb({
            limitedEvents: [event as unknown as InMemoryRow],
        });
        const result = await runAutoPick(db.ctx, event._id);
        expect(result).toBeNull();
        // No write at all — the guard returns before touching anything.
        expect(db.writes).toHaveLength(0);
    });
});
