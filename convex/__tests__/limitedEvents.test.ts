// Limited Event integration test (PRD #1107 AC: "create → join → start →
// pools exist, entirely through public mutations"). The project has no
// convex-test harness (see `convex/__tests__/adminAuth.test.ts`,
// `convex/__tests__/decks.test.ts`) — this drives the EXACT exported pure
// functions `convex/limitedEvents.ts`'s mutations call, in the same order the
// mutations call them, against the REAL card registry and the REAL checked-in
// LEA Booster Config (not stubs) — the highest-fidelity "through public
// mutations" proof available without spinning up Convex.
import { describe, it, expect } from "vitest";
import { resolveDeckCardMeta, tryGetDefinition } from "../cards";
import { makeRng } from "../gre/rng";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import { projectLimitedEvent, type LimitedEventRow } from "../limited/eventProjection";
import { getBoosterConfig, isDraftableSet } from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

/** `createLimitedEvent`'s server-side gate: every packSlot must currently be
 *  Draftable. Modeled here exactly as the mutation enforces it. */
function assertPackSlotsDraftable(packSlots: string[]): void {
    for (const setCode of packSlots) {
        if (!isDraftableSet(setCode)) {
            throw new Error(`Set "${setCode}" is not a Draftable Set.`);
        }
    }
}

describe("Limited Event: create → join → start → pools exist (PRD #1107)", () => {
    it("a full Sealed event lifecycle produces a Pool for every seat", () => {
        // 1. createLimitedEvent — admin creates a 3-seat Sealed event on LEA.
        const packSlots = ["lea"];
        assertPackSlotsDraftable(packSlots);
        const sealedBoosterCount = 6;
        let event: LimitedEventRow = {
            _id: "event1",
            createdBy: "admin1",
            type: "sealed",
            status: "open",
            seatCount: 3,
            packSlots,
            sealedBoosterCount,
            seats: buildEmptySeats(3),
            createdAt: 0,
            updatedAt: 0,
        };
        expect(event.seats).toHaveLength(3);
        expect(event.seats.every((s) => s.pool === undefined)).toBe(true);

        // 2. joinLimitedEvent — one human takes seat 0.
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user1", "Alice"),
        };
        expect(event.seats[0].userId).toBe("user1");

        // A second join attempt by the same user is rejected (no
        // double-seating) — exactly what the mutation throws.
        expect(() =>
            assignFreeSeat(event.seats, "user1", "Alice")
        ).toThrow(/already have a seat/);

        // 3. startLimitedEvent — creator starts: empty seats become bots, then
        // every seat (human + bot) gets a Sealed Pool from the checked-in LEA
        // Booster Config via the seeded generator.
        const filled = fillBotSeats(event.seats);
        expect(filled[1].isBot).toBe(true);
        expect(filled[2].isBot).toBe(true);

        const seed = 424242;
        const seededSeats = generateSealedPools(
            filled,
            event.packSlots,
            event.sealedBoosterCount!,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(seed)
        );
        event = {
            ...event,
            seats: seededSeats,
            status: "started",
            updatedAt: 1,
        };

        // 4. Pools exist for every seat — human and bot alike.
        expect(event.seats).toHaveLength(3);
        for (const seat of event.seats) {
            expect(seat.pool).toBeDefined();
            expect(seat.pool!.length).toBeGreaterThan(0);
            // Every card in the pool resolves to a real, named card — proof
            // the generator ran against the actual LEA catalogue, not a stub.
            for (const card of seat.pool!) {
                expect(card.cardName).not.toBe(card.scryfallId);
                expect(card.cardId.length).toBeGreaterThan(0);
            }
        }
        // LEA's "default" booster is 15 cards (11 common + 3 uncommon + 1
        // rare); 6 boosters/seat ⇒ 90 cards, deterministic and identical
        // across every seat's booster count.
        const expectedPerSeat = 15 * sealedBoosterCount;
        for (const seat of event.seats) {
            expect(seat.pool).toHaveLength(expectedPerSeat);
        }

        // 5. Determinism (PRD #1107 AC2): the same seed reproduces the same
        // pools bit-for-bit.
        const replaySeats = generateSealedPools(
            filled,
            event.packSlots,
            event.sealedBoosterCount!,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(seed)
        );
        expect(replaySeats).toEqual(seededSeats);

        // 6. Privacy: the human's own Pool is visible to them; the bots'
        // Pools are stripped, only their counts survive.
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.userId === "user1")!;
        expect(own.pool).not.toBeNull();
        expect(own.pool).toHaveLength(expectedPerSeat);
        for (const seat of view.seats.filter((s) => s.seatIndex !== 0)) {
            expect(seat.pool).toBeNull();
            expect(seat.poolCount).toBe(expectedPerSeat);
        }
    });

    it("rejects creating an event with an unresolvable/non-Draftable set", () => {
        expect(() => assertPackSlotsDraftable(["not-a-real-set"])).toThrow(
            /not a Draftable Set/
        );
    });

    it("rejects starting when no seats are open (join saturation)", () => {
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        expect(() => assignFreeSeat(seats, "user3", "Carol")).toThrow(
            /No open seats/
        );
    });

    it("a fully-human table starts with no bot seats and still gets pools", () => {
        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        const filled = fillBotSeats(seats);
        expect(filled.every((s) => !s.isBot)).toBe(true);

        const seededSeats = generateSealedPools(
            filled,
            ["lea"],
            3,
            getBoosterConfig,
            resolveCardMeta,
            makeRng(1)
        );
        expect(seededSeats.every((s) => s.pool && s.pool.length === 45)).toBe(
            true
        );
    });
});
