// Limited Event play-phase gate (PRD #1628, ADR 0076, issue #1648): "the
// server rejects a free challenge or event-bound playtest while the event is
// in its play phase — the gate is not UI-only". PR #1676 (issue #1645)
// already replaced the free challenge panel and the Play-vs-Bots panel on the
// client while `areRoundsRunning(event.status)`; this file pins the SERVER
// side of that same rule, which — before this change — did not exist:
// `challengeLimitedSeat` and `createSoloGame`'s event binding accepted a
// "playing" event with no rejection at all.
//
// The project has no convex-test harness (see `limitedChallenge.test.ts` /
// `limitedPlayPhaseOpen.test.ts`), so this drives the REGISTERED mutations'
// own `_handler` — the function Convex actually deploys — against a stub
// `MutationCtx`, the same idiom those two files use, and against the REAL
// card registry + the REAL checked-in LEA Booster Config.
import { describe, it, expect } from "vitest";
import type { MutationCtx } from "../_generated/server";
import {
    challengeLimitedSeat,
    createSoloGame,
    joinGame,
    startPairingMatch,
} from "../game";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import type { GateDeck } from "../formats";
import { makeRng } from "../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import { getBoosterConfig } from "../limited/registry";
import type { LimitedEventStatus } from "../limited/eventStatus";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** A 2-human Sealed LEA event at a given lifecycle status — the ONLY axis
 *  this file varies. Pools/seats are otherwise identical to
 *  `limitedChallenge.test.ts`'s `buildTwoHumanEvent`. */
function buildTwoHumanEvent(
    eventId: string,
    seed: number,
    status: LimitedEventStatus
) {
    let seats = buildEmptySeats(2);
    seats = assignFreeSeat(seats, "alice", "Alice");
    seats = assignFreeSeat(seats, "bob", "Bob");
    seats = generateSealedPools(
        seats,
        ["lea"],
        6,
        getBoosterConfig,
        resolveCardMeta,
        makeRng(seed)
    );
    return {
        _id: eventId,
        createdBy: "alice",
        type: "sealed" as const,
        status,
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        matchFormat: "bo3" as const,
        seats,
        createdAt: 0,
        updatedAt: 0,
    };
}

type TwoHumanEvent = ReturnType<typeof buildTwoHumanEvent>;

/** A legal 40-card Limited deck for `seatIndex`, built entirely from that
 *  seat's own Pool — identical shape to `limitedChallenge.test.ts`. */
function deckForSeat(event: TwoHumanEvent, seatIndex: number): GateDeck {
    const seat = event.seats.find((s) => s.seatIndex === seatIndex)!;
    const nonBasic = seat.pool!.filter(
        (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
    );
    const basic = seat.pool!.find(
        (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
    )!;
    const main = nonBasic.slice(0, 30);
    const basics = Array.from(
        { length: Math.max(0, 40 - main.length) },
        () => ({ cardId: basic.cardId, cardName: basic.cardName })
    );
    return {
        name: `Seat ${seatIndex} Deck`,
        format: "limited",
        cards: [
            ...main.map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
            ...basics,
        ],
        sideboard: nonBasic
            .slice(30)
            .map((c) => ({ cardId: c.cardId, cardName: c.cardName })),
        limitedEventId: event._id,
        limitedSeatId: String(seatIndex),
    };
}

/** A minimal freeform "opponent" deck — the shape `LimitedVsAiPanel` builds
 *  for the bot's Auto-Built deck (`format: "freeform"`, `noReasons` validator,
 *  ADR 0036). Content is irrelevant to this file's gate; a handful of the
 *  challenger's own pool cards keeps it real without a second Pool. */
function freeformOpponentDeck(deck: GateDeck) {
    return {
        id: "bot-deck",
        name: "Bot",
        format: "freeform",
        cards: deck.cards.slice(0, 5),
    };
}

/** Generic stub `MutationCtx` — `db.get`/`db.patch`/`db.insert` over an
 *  in-memory doc map, `db.query(table).withIndex(...)` filtering that map by
 *  table + equality, exactly the idiom `limitedPlayPhaseOpen.test.ts` uses for
 *  `startLimitedEvent`. Every table this file's two mutations touch
 *  (`matches`, `games`, `limitedSeats`, `formatBanlists`) that has no seeded
 *  row simply comes back empty, which is the real state for a `"limited"`
 *  deck's inline Pool (no split `limitedSeats` child row) and for a format
 *  with no DB banlist override. */
function makeStubCtx(event: TwoHumanEvent, callerUserId: string) {
    const docs = new Map<string, Record<string, unknown>>([
        [event._id, { ...event }],
        ["alice", { _id: "alice", nickname: "Alice" }],
        ["bob", { _id: "bob", nickname: "Bob" }],
    ]);
    let nextId = 0;
    const ctx = {
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
            insert: async (
                table: string,
                doc: Record<string, unknown>
            ): Promise<string> => {
                const _id = `${table}-${nextId++}`;
                docs.set(_id, { ...doc, _id, __table: table });
                return _id;
            },
            query: (table: string) => ({
                withIndex: (
                    _name: string,
                    build?: (q: {
                        eq: (field: string, value: unknown) => unknown;
                    }) => unknown
                ) => {
                    const filters: [string, unknown][] = [];
                    if (build) {
                        const q = {
                            eq(field: string, value: unknown) {
                                filters.push([field, value]);
                                return q;
                            },
                        };
                        build(q);
                    }
                    const matching = () =>
                        [...docs.values()].filter(
                            (row) =>
                                row.__table === table &&
                                filters.every(
                                    ([field, value]) => row[field] === value
                                )
                        );
                    return {
                        collect: async () => matching(),
                        unique: async () => matching()[0] ?? null,
                        take: async (n: number) => matching().slice(0, n),
                    };
                },
            }),
        },
        scheduler: { runAfter: async () => undefined },
    };
    return { ctx: ctx as unknown as MutationCtx, docs };
}

/** Re-points a stub ctx at a DIFFERENT authenticated caller while sharing the
 *  SAME underlying `docs` map — the two-user idiom `limitedPairingMatch.test.ts`
 *  uses (`asUser`), needed here so a Game/Match one seat creates is visible to
 *  the OTHER seat's accept call. */
function asUser(ctx: MutationCtx, userId: string): MutationCtx {
    return {
        ...ctx,
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
    } as unknown as MutationCtx;
}

/** Same 2-human Sealed LEA table as `buildTwoHumanEvent`, plus a live Round 1
 *  pairing seat 0 vs seat 1 — what `startPairingMatch` needs to start the
 *  round Match that `joinGame`'s gate must NOT reject. */
function buildPairedTwoHumanEvent(
    eventId: string,
    seed: number,
    status: LimitedEventStatus
) {
    return {
        ...buildTwoHumanEvent(eventId, seed, status),
        currentRound: 1,
        rounds: [
            {
                roundNumber: 1,
                startedAt: 0,
                pairings: [{ seatA: 0, seatB: 1 }],
            },
        ],
    };
}

/** Drives a registered mutation's `_handler` directly — the function Convex
 *  actually deploys — bypassing the `args`/`returns` validator wrapper (which
 *  needs the real Convex runtime). Same idiom as
 *  `limitedPlayPhaseOpen.test.ts`'s `runStartLimitedEvent`. */
function runHandler<TArgs>(
    fn: unknown,
    ctx: MutationCtx,
    args: TArgs
): Promise<unknown> {
    return (
        fn as unknown as {
            _handler: (ctx: MutationCtx, args: TArgs) => Promise<unknown>;
        }
    )._handler(ctx, args);
}

describe("free challenge is rejected server-side while the event's rounds are running (issue #1648)", () => {
    it("rejects challengeLimitedSeat while status is playing", async () => {
        const event = buildTwoHumanEvent("event-gate-1", 111, "playing");
        const { ctx } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        await expect(
            runHandler(challengeLimitedSeat, ctx, {
                eventId: event._id,
                challengedSeatIndex: 1,
                deck,
            })
        ).rejects.toThrow(/rounds are running/);
    });

    it("still allows challengeLimitedSeat during draft/deckbuild (unaffected, AC)", async () => {
        const event = buildTwoHumanEvent("event-gate-2", 222, "started");
        const { ctx, docs } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        const gameId = await runHandler(challengeLimitedSeat, ctx, {
            eventId: event._id,
            challengedSeatIndex: 1,
            deck,
        });

        expect(gameId).toBeTruthy();
        const matches = [...docs.values()].filter(
            (d) => d.__table === "matches"
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].limitedChallenge).toMatchObject({
            challengerSeatIndex: 0,
            challengedUserId: "bob",
            challengedSeatIndex: 1,
        });
    });

    it("allows challengeLimitedSeat again once the event has finished (unrecorded playtesting)", async () => {
        const event = buildTwoHumanEvent("event-gate-3", 333, "finished");
        const { ctx, docs } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        const gameId = await runHandler(challengeLimitedSeat, ctx, {
            eventId: event._id,
            challengedSeatIndex: 1,
            deck,
        });

        expect(gameId).toBeTruthy();
        expect(
            [...docs.values()].filter((d) => d.__table === "matches")
        ).toHaveLength(1);
    });
});

describe("event-bound Play-vs-Bots playtest is rejected server-side while the event's rounds are running (issue #1648)", () => {
    it("rejects createSoloGame's event binding while status is playing", async () => {
        const event = buildTwoHumanEvent("event-gate-4", 444, "playing");
        const { ctx } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        await expect(
            runHandler(createSoloGame, ctx, {
                name: "Alice vs Bot",
                deck,
                deck2: freeformOpponentDeck(deck),
                vsAi: true,
                limitedEventId: event._id,
            })
        ).rejects.toThrow(/rounds are running/);
    });

    it("still allows the event-bound playtest during draft/deckbuild (unaffected, AC)", async () => {
        const event = buildTwoHumanEvent("event-gate-5", 555, "started");
        const { ctx, docs } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        const gameId = await runHandler(createSoloGame, ctx, {
            name: "Alice vs Bot",
            deck,
            deck2: freeformOpponentDeck(deck),
            vsAi: true,
            limitedEventId: event._id,
        });

        expect(gameId).toBeTruthy();
        const matches = [...docs.values()].filter(
            (d) => d.__table === "matches"
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].limitedEventId).toBe(event._id);
        expect(matches[0].vsAi).toBe(true);
    });

    it("allows the event-bound playtest again once the event has finished (unrecorded playtesting)", async () => {
        const event = buildTwoHumanEvent("event-gate-6", 666, "finished");
        const { ctx, docs } = makeStubCtx(event, "alice");
        const deck = deckForSeat(event, 0);

        const gameId = await runHandler(createSoloGame, ctx, {
            name: "Alice vs Bot",
            deck,
            deck2: freeformOpponentDeck(deck),
            vsAi: true,
            limitedEventId: event._id,
        });

        expect(gameId).toBeTruthy();
        expect(
            [...docs.values()].filter((d) => d.__table === "matches")
        ).toHaveLength(1);
    });
});

describe("joinGame's Limited-challenge accept is gated too (finding 1, issue #1648 review)", () => {
    // Gating CREATION (`challengeLimitedSeat`, above) is not enough: nothing
    // cancels a free challenge that was already sent during deckbuild once the
    // event flips to `playing` (`openPlayPhaseIfReady`, `limitedEvents.ts`,
    // only patches status/rounds) — it is still a `waiting` Game the addressed
    // seat can `joinGame` into. This reproduces exactly that lifecycle: the
    // challenge is created while `started`, then the event is flipped to
    // `playing` UNDERNEATH it (no code path touches the challenge Game), and
    // only THEN does the challenged seat try to accept.
    it("rejects joinGame accepting a free challenge once the event's rounds are running", async () => {
        const event = buildTwoHumanEvent("event-gate-7", 777, "started");
        const { ctx, docs } = makeStubCtx(event, "alice");

        const gameId = (await runHandler(challengeLimitedSeat, ctx, {
            eventId: event._id,
            challengedSeatIndex: 1,
            deck: deckForSeat(event, 0),
        })) as string;

        // The event's rounds start — nothing here touches the leftover
        // challenge Game/Match, exactly as `openPlayPhaseIfReady` behaves.
        docs.set(event._id, { ...docs.get(event._id), status: "playing" });

        await expect(
            runHandler(joinGame, asUser(ctx, "bob"), {
                gameId,
                deck: deckForSeat(event, 1),
            })
        ).rejects.toThrow(/rounds are running/);
    });

    // Companion: a round pairing Match ALSO carries `limitedChallenge`
    // (`startPairingMatch` stamps both), so a naive `game.limitedChallenge`
    // gate would reject the pairing accept itself — the actual round the
    // event's rounds-running phase exists to run. Excluded via
    // `!game.limitedPairing`; this proves that exclusion holds.
    it("still allows accepting the ROUND PAIRING Match while the event's rounds are running", async () => {
        const event = buildPairedTwoHumanEvent("event-gate-8", 888, "playing");
        const { ctx, docs } = makeStubCtx(event, "alice");

        const gameId = (await runHandler(startPairingMatch, ctx, {
            eventId: event._id,
            deck: deckForSeat(event, 0),
        })) as string;

        await runHandler(joinGame, asUser(ctx, "bob"), {
            gameId,
            deck: deckForSeat(event, 1),
        });

        const game = docs.get(gameId)!;
        const match = docs.get(game.matchId as string)!;
        expect(match.status).toBe("pregame");
        expect((match.players as unknown[]).length).toBe(2);
    });
});
