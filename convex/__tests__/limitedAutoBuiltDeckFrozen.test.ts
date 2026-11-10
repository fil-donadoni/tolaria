// A Bot seat's Auto-Built deck is DECIDED once, when its Pool is final, and
// stored (issue #8896). Owner rule: a review never changes a choice already
// made — so a Card Profile edit after Pool-final must never reach the deck any
// reader returns (the pairing Match hookup, the event view, the archive).
//
// No convex-test harness (see `convex/__tests__/adminAuth.test.ts`): like
// `limitedPairingMatch.test.ts`, this drives the real functions against an
// in-memory stub ctx and a REAL LEA Sealed table, so the deck is built by the
// production Auto-Build path from a real Pool.
import { describe, it, expect } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
    getLimitedEvent,
    openPlayPhaseIfReady,
    resolveSeatAutoBuiltDeck,
} from "../limitedEvents";
import { makeRng } from "../gre/rng";
import { resolveDeckCardMeta } from "../cards";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
} from "../limited/eventLogic";
import { getBoosterConfig } from "../limited/registry";
import { resolveCardMeta } from "../limitedCardMeta";
import type { AutoBuiltDeck } from "../limited/autoBuild";

type Row = Record<string, unknown>;

interface Stub {
    ctx: MutationCtx;
    rows: (table: string) => Row[];
    insert: (table: string, doc: Row) => void;
    patch: (id: string, patch: Row) => void;
    get: (id: string) => Row;
}

/** An in-memory `MutationCtx`: `withIndex` applies every `eq` the range
 *  callback names, which is all the read paths under test use. */
function makeCtx(userId: string, seeds: Row[]): Stub {
    const docs = new Map<string, Row>();
    for (const seed of seeds) docs.set(seed._id as string, { ...seed });
    let counter = 0;
    const tableRows = (table: string) =>
        [...docs.values()].filter((d) => d.__table === table);
    const insert = (table: string, doc: Row) => {
        const id = `${table}-${++counter}`;
        docs.set(id, { ...doc, _id: id, __table: table });
        return id;
    };
    const ctx = {
        auth: {
            getUserIdentity: async () => ({ subject: `${userId}|session1` }),
        },
        db: {
            get: async (id: string) => docs.get(id) ?? null,
            insert: async (table: string, doc: Row) => insert(table, doc),
            patch: async (id: string, patch: Row) => {
                docs.set(id, { ...docs.get(id), ...patch });
            },
            replace: async (id: string, doc: Row) => {
                docs.set(id, {
                    ...doc,
                    _id: id,
                    __table: docs.get(id)?.__table,
                });
            },
            delete: async (id: string) => {
                docs.delete(id);
            },
            query: (table: string) => ({
                withIndex: (_name: string, fn?: (q: unknown) => unknown) => {
                    const eqs: [string, unknown][] = [];
                    const builder = {
                        eq: (field: string, value: unknown) => {
                            eqs.push([field, value]);
                            return builder;
                        },
                    };
                    fn?.(builder);
                    const rows = tableRows(table).filter((d) =>
                        eqs.every(([f, v]) => d[f] === v)
                    );
                    return {
                        collect: async () => rows,
                        first: async () => rows[0] ?? null,
                        take: async (n: number) => rows.slice(0, n),
                        unique: async () => {
                            if (rows.length > 1) throw new Error("not unique");
                            return rows[0] ?? null;
                        },
                        order: () => ({
                            first: async () => rows[0] ?? null,
                            collect: async () => rows,
                        }),
                    };
                },
            }),
        },
        scheduler: { runAfter: async () => undefined },
    };
    return {
        ctx: ctx as unknown as MutationCtx,
        rows: tableRows,
        insert: (table, doc) => void insert(table, doc),
        patch: (id, patch) => docs.set(id, { ...docs.get(id), ...patch }),
        get: (id) => docs.get(id)!,
    };
}

const EVENT_ID = "event-frozen";
const BOT_SEAT = 1;

/** A 2-seat LEA Sealed table in its deckbuild phase: Pools dealt (so final),
 *  seat 0 Alice (no deck yet), seat 1 a Bot Drafter. */
function deckbuildEvent(eventId: string): Row {
    let seats = assignFreeSeat(buildEmptySeats(2), "alice", "Alice");
    seats = fillBotSeats(seats);
    seats = generateSealedPools(
        seats,
        ["lea"],
        6,
        getBoosterConfig,
        resolveCardMeta,
        makeRng(8896)
    );
    return {
        _id: eventId,
        __table: "limitedEvents",
        createdBy: "alice",
        type: "sealed",
        status: "started",
        seatCount: 2,
        packSlots: ["lea"],
        sealedBoosterCount: 6,
        gamesFormat: "bo1",
        seats,
        createdAt: 0,
        updatedAt: 0,
    };
}

const seeds = (): Row[] => [
    { _id: "alice", __table: "users", nickname: "Alice" },
    deckbuildEvent(EVENT_ID),
];

async function eventDoc(stub: Stub, id = EVENT_ID) {
    return stub.get(id) as unknown as Doc<"limitedEvents">;
}

/** An Admin's Card Profile review: every non-land card the Bot left in its
 *  Sideboard now provides AND requires one shared Capability, so they score
 *  each other up in Auto-Build's Capability pass (ADR 0072). */
function reviewSideboardProfiles(stub: Stub, deck: AutoBuiltDeck) {
    for (const card of deck.sideboard) {
        const meta = resolveDeckCardMeta(card.cardId);
        if (!meta || meta.isLand) continue;
        stub.insert("cardCapabilities", {
            cardId: meta.cardId,
            provides: ["frozen-deck-test"],
            requires: ["frozen-deck-test"],
            reviewed: true,
        });
    }
}

const maindeckIds = (deck: AutoBuiltDeck | null) =>
    (deck?.cards ?? []).map((c) => c.cardId).sort();

describe("Auto-Built deck is fixed at Pool-final (issue #8896)", () => {
    it("stores the Bot seat's deck when the Pool is final, and none for a human seat", async () => {
        const stub = makeCtx("alice", seeds());
        await openPlayPhaseIfReady(
            stub.ctx,
            EVENT_ID as Id<"limitedEvents">,
            1
        );
        const stored = stub.rows("limitedAutoBuiltDecks");
        expect(stored.map((r) => r.seatIndex)).toEqual([BOT_SEAT]);
        expect((stored[0].cards as unknown[]).length).toBeGreaterThan(0);
    });

    it("a Card Profile edit after Pool-final never changes the deck any reader returns", async () => {
        const stub = makeCtx("alice", seeds());
        await openPlayPhaseIfReady(
            stub.ctx,
            EVENT_ID as Id<"limitedEvents">,
            1
        );
        const frozen = await resolveSeatAutoBuiltDeck(
            stub.ctx,
            await eventDoc(stub),
            BOT_SEAT
        );
        expect(frozen).not.toBeNull();

        reviewSideboardProfiles(stub, frozen!);
        // A further Pool-final/Drop write runs the freeze again: the first
        // decision stands, nothing is rebuilt.
        await openPlayPhaseIfReady(
            stub.ctx,
            EVENT_ID as Id<"limitedEvents">,
            2
        );

        // Precondition — the edit genuinely changes a FRESH build: the same
        // table under another id, with no stored deck, builds differently.
        // Without this the assertions below would pass on an edit that
        // changes nothing.
        stub.insert("limitedEvents", {
            ...deckbuildEvent("unused"),
        });
        const fresh = stub
            .rows("limitedEvents")
            .find((r) => r._id !== EVENT_ID)!;
        const rebuilt = await resolveSeatAutoBuiltDeck(
            stub.ctx,
            fresh as unknown as Doc<"limitedEvents">,
            BOT_SEAT
        );
        expect(maindeckIds(rebuilt)).not.toEqual(maindeckIds(frozen));

        // The pairing-Match reader (`convex/game.ts`'s `startPairingMatch`).
        const forMatch = await resolveSeatAutoBuiltDeck(
            stub.ctx,
            await eventDoc(stub),
            BOT_SEAT
        );
        expect(forMatch).toEqual(frozen);

        // The event view (live and archived alike).
        const view = await (
            getLimitedEvent as unknown as {
                _handler: (
                    ctx: MutationCtx,
                    args: { eventId: string }
                ) => Promise<{
                    seats: {
                        seatIndex: number;
                        autoBuiltDeck: AutoBuiltDeck | null;
                    }[];
                } | null>;
            }
        )._handler(stub.ctx, { eventId: EVENT_ID });
        const botView = view!.seats.find((s) => s.seatIndex === BOT_SEAT)!;
        expect(botView.autoBuiltDeck).toEqual(frozen);
    });

    it("a seat that drops after Pool-final with no submitted deck gets its deck stored at the Drop", async () => {
        const stub = makeCtx("alice", seeds());
        await openPlayPhaseIfReady(
            stub.ctx,
            EVENT_ID as Id<"limitedEvents">,
            1
        );
        const event = await eventDoc(stub);
        stub.patch(EVENT_ID, {
            seats: event.seats.map((s) =>
                s.seatIndex === 0 ? { ...s, droppedAt: 5 } : s
            ),
        });
        await openPlayPhaseIfReady(
            stub.ctx,
            EVENT_ID as Id<"limitedEvents">,
            5
        );
        expect(
            stub
                .rows("limitedAutoBuiltDecks")
                .map((r) => r.seatIndex)
                .sort()
        ).toEqual([0, BOT_SEAT]);
    });
});
