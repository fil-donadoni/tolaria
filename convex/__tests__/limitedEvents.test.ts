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
import { applyPick, startDraft } from "../limited/draftEngine";
import {
    assertDraftSeatsFilled,
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    projectLimitedEvent,
    type LimitedEventRow,
} from "../limited/eventProjection";
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
        expect(() => assignFreeSeat(event.seats, "user1", "Alice")).toThrow(
            /already have a seat/
        );

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

describe("Limited Event Draft: create → join → start → scripted picks → pools (issue #1112)", () => {
    it("scripted picks through the exact submitPick path give every seat a 3×pack-size Pool", () => {
        // 1. createLimitedEvent — admin creates a 4-seat Draft on 3× LEA.
        const packSlots = ["lea", "lea", "lea"];
        assertPackSlotsDraftable(packSlots);
        let event: LimitedEventRow = {
            _id: "draftEvent1",
            createdBy: "admin1",
            type: "draft",
            status: "open",
            seatCount: 4,
            packSlots,
            seats: buildEmptySeats(4),
            createdAt: 0,
            updatedAt: 0,
        };

        // 2. joinLimitedEvent — a table of humans (2+, PRD #1107 story 9/
        // issue #1112 scope: "no bots yet") — all 4 seats join as humans.
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user1", "Alice"),
        };
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user2", "Bob"),
        };
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user3", "Carol"),
        };
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user4", "Dave"),
        };
        const filled = fillBotSeats(event.seats); // idempotent no-op here — mirrors what startLimitedEvent always calls.
        expect(filled.every((s) => !s.isBot)).toBe(true);

        // 3. startLimitedEvent — round 0's boosters dealt from the real
        // checked-in LEA Booster Config.
        const seed = 555;
        const started = startDraft(
            filled,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta
        );
        event = {
            ...event,
            seats: started.seats,
            status: "started",
            draftRound: started.draftRound,
            draftPacksRemaining: started.draftPacksRemaining,
            updatedAt: 1,
        };
        expect(event.seats.every((s) => s.currentPack?.length === 15)).toBe(
            true
        );

        // 4. submitPick, scripted for every seat until the draft completes —
        // exactly the pure function the mutation calls, in the same order.
        // Picks always take the first card of whichever seat currently holds
        // a non-empty pack (deterministic scan order, not real user input,
        // but drives the identical pick→pass→queue→advance state machine).
        let round = event.draftRound!;
        let remaining = event.draftPacksRemaining!;
        let seats = event.seats;
        let completed = false;
        let safety = 0;
        while (!completed) {
            const seatIndex = seats.findIndex(
                (s) => s.currentPack && s.currentPack.length > 0
            );
            if (seatIndex === -1) {
                throw new Error(
                    "test: no seat has a pack to pick from but the draft isn't completed"
                );
            }
            const pickId = seats[seatIndex].currentPack![0].pickId;
            const result = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                seatIndex,
                pickId,
                seed,
                getBoosterConfig,
                resolveCardMeta
            );
            seats = result.seats;
            round = result.draftRound;
            remaining = result.draftPacksRemaining;
            completed = result.completed;
            if (++safety > 10_000) {
                throw new Error(
                    "test: draft never completed — infinite loop guard tripped"
                );
            }
        }
        event = {
            ...event,
            seats,
            draftRound: round,
            draftPacksRemaining: remaining,
            draftCompletedAt: 2,
        };

        // 5. Every seat's Pool is 3 boosters × 15 cards/booster = 45 real,
        // named LEA cards — proof the whole loop ran against the actual
        // catalogue, not stubs.
        const expectedPerSeat = 15 * packSlots.length;
        for (const seat of event.seats) {
            expect(seat.pool).toHaveLength(expectedPerSeat);
            expect(seat.currentPack).toBeUndefined();
            expect(seat.packQueue).toEqual([]);
            for (const card of seat.pool!) {
                expect(card.cardName).not.toBe(card.scryfallId);
                expect(card.cardId.length).toBeGreaterThan(0);
            }
        }

        // 6. Privacy: the human's own Pool/currentPack are visible to them;
        // every other seat's are stripped (PRD #1107 story 15).
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.userId === "user1")!;
        expect(own.pool).toHaveLength(expectedPerSeat);
        for (const seat of view.seats.filter((s) => s.userId !== "user1")) {
            expect(seat.pool).toBeNull();
            expect(seat.currentPack).toBeNull();
            expect(seat.poolCount).toBe(expectedPerSeat);
        }
    });

    it("rejects starting a draft with any unfilled seat — bot drafting is not shipped (#1112/#1113)", () => {
        // Bot drafting (#1113) is out of scope: no driver ever calls
        // `submitPick` for a bot seat, so a bot-filled seat's `currentPack`
        // would never pass and every downstream human seat would wait on it
        // forever — a permanent deadlock. `startLimitedEvent`'s draft branch
        // must refuse to start (and must NOT `fillBotSeats`) until every
        // seat is human-occupied.
        let seats = buildEmptySeats(3);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        // Seat 2 is still unclaimed — this is the exact shape
        // `startLimitedEvent` reads from `event.seats` before ever calling
        // `fillBotSeats`.
        expect(seats[2].userId).toBeUndefined();
        expect(() => assertDraftSeatsFilled(seats)).toThrow(
            /all 3 seats are filled by human players/
        );

        // Filling the last seat with a human (never a bot) clears the guard.
        seats = assignFreeSeat(seats, "user3", "Carol");
        expect(() => assertDraftSeatsFilled(seats)).not.toThrow();
    });
});
