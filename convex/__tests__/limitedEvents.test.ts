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
import { getCardColors } from "../cards/colors";
import { assertDeckLegal, type GateDeck } from "../formats";
import { manaValue } from "../gre/constants";
import { makeRng } from "../gre/rng";
import { computeEventCompletion } from "../limited/completion";
import {
    CUBE_SOURCE_KEY,
    CUBE_PACK_SIZE,
    cubePoolSize,
    isCubeSource,
    maxCubeSeats,
} from "../limited/cube";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
    type TimerConfig,
} from "../limited/draftEngine";
import {
    chooseBotPick,
    type GetCardEvalMeta,
    type GetPickRating,
} from "../limited/botDrafter";
import {
    resolveEventPickRating,
    type GetDbRating,
} from "../limited/cardRatings";
import { getPickRating, getPickRatingByCardId } from "../limited/pickRatings";
import {
    assignFreeSeat,
    buildEmptySeats,
    fillBotSeats,
    generateSealedPools,
    type ResolveCardMeta,
} from "../limited/eventLogic";
import {
    projectLimitedEvent,
    type HumanDeckView,
    type LimitedEventRow,
} from "../limited/eventProjection";
import {
    assertLimitedSeatOwnership,
    resolvePoolFromEvent,
} from "../limited/poolResolution";
import { upsertPoolArrangementEntry } from "../limited/poolArrangement";
import {
    getBoosterConfig,
    getRuntimeBoosterConfig,
    isDraftableSet,
} from "../limited/registry";

const resolveCardMeta: ResolveCardMeta = (scryfallId) => {
    const def = tryGetDefinition(scryfallId);
    if (!def) return null;
    const meta = resolveDeckCardMeta(scryfallId);
    return meta ? { cardId: meta.cardId, cardName: def.name } : null;
};

// The same `GetCardEvalMeta` wiring `convex/limitedEvents.ts` uses, against
// the REAL card registry — the Bot Drafter's Pick Heuristic input.
const getCardEvalMeta: GetCardEvalMeta = (scryfallId) => {
    const meta = resolveDeckCardMeta(scryfallId);
    if (!meta) return null;
    const def = tryGetDefinition(meta.cardId);
    if (!def) return null;
    return {
        cardId: meta.cardId,
        colors: getCardColors(def),
        manaValue: manaValue(def.manaCost),
        rarity: meta.rarity,
    };
};

const botChoosePick: ChooseBotPick = (seat, pack) =>
    chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta);

/** `createLimitedEvent`'s server-side gate: every DISTINCT packSlot must
 *  currently be Draftable (issue #1246: deduped, since a 3-element Draft
 *  `packSlots` is typically the same set 3×). Modeled here exactly as the
 *  mutation enforces it. */
function assertPackSlotsDraftable(packSlots: string[]): void {
    for (const setCode of new Set(packSlots)) {
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
            getRuntimeBoosterConfig,
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
            getRuntimeBoosterConfig,
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

    it("a Sealed event on ICE (a partially-implemented Draftable Set, ADR 0059) never deals a card with no implemented CardDefinition", () => {
        const packSlots = ["ice"];
        assertPackSlotsDraftable(packSlots);

        let seats = buildEmptySeats(2);
        seats = assignFreeSeat(seats, "user1", "Alice");
        seats = assignFreeSeat(seats, "user2", "Bob");
        const filled = fillBotSeats(seats);

        const seededSeats = generateSealedPools(
            filled,
            packSlots,
            6,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            makeRng(99)
        );

        expect(seededSeats.every((s) => (s.pool?.length ?? 0) > 0)).toBe(true);
        for (const seat of seededSeats) {
            for (const card of seat.pool!) {
                // The runtime drop (ADR 0059, `getRuntimeBoosterConfig`) means
                // every dealt card resolves to a real, implemented
                // CardDefinition — no placeholder ever reaches a Pool, even
                // though the checked-in ICE config isn't 100% implemented.
                expect(tryGetDefinition(card.scryfallId)).not.toBeNull();
                expect(card.cardName).not.toBe(card.scryfallId);
            }
        }
    });

    it("rejects creating an event with an unresolvable/non-Draftable set", () => {
        expect(() => assertPackSlotsDraftable(["not-a-real-set"])).toThrow(
            /not a Draftable Set/
        );
    });

    // Issue #1246: `packSlots` already supports a multi-set shape (e.g. a
    // future INV/PLS/APC block draft) — a mixed list with one Draftable and
    // one non-Draftable entry must still be rejected, proving the gate
    // validates EVERY distinct entry rather than short-circuiting on the
    // first (Draftable) one it happens to check.
    it("rejects a mixed packSlots list where only ONE distinct entry is non-Draftable (multi-set smuggling)", () => {
        expect(() =>
            assertPackSlotsDraftable(["lea", "not-a-real-set"])
        ).toThrow(/not a Draftable Set/);
        // Order shouldn't matter either.
        expect(() =>
            assertPackSlotsDraftable(["not-a-real-set", "lea"])
        ).toThrow(/not a Draftable Set/);
    });

    it("accepts a mixed packSlots list where every distinct entry IS Draftable", () => {
        expect(() =>
            assertPackSlotsDraftable(["lea", "ice", "lea"])
        ).not.toThrow();
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
            getRuntimeBoosterConfig,
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
            getRuntimeBoosterConfig,
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
                getRuntimeBoosterConfig,
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

    it("solo draft (1 human + 3 bots) completes end-to-end with nobody ever driving the bot seats (issue #1113, PRD #1107 story 9)", () => {
        // 1. createLimitedEvent — admin creates a 4-seat Draft on 3× LEA.
        const packSlots = ["lea", "lea", "lea"];
        assertPackSlotsDraftable(packSlots);
        let event: LimitedEventRow = {
            _id: "soloDraftEvent",
            createdBy: "admin1",
            type: "draft",
            status: "open",
            seatCount: 4,
            packSlots,
            seats: buildEmptySeats(4),
            createdAt: 0,
            updatedAt: 0,
        };

        // 2. joinLimitedEvent — only ONE human ever joins. This is the primary
        // use case (PRD #1107 story 9: "I want to draft completely alone").
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user1", "Alice"),
        };
        expect(event.seats.filter((s) => s.userId !== undefined)).toHaveLength(
            1
        );

        // 3. startLimitedEvent — empty seats become Bot Drafters (issue
        // #1113: unlike #1112, a Draft is now allowed to do this), round 0 is
        // dealt, and every bot's pending pick resolves immediately.
        const filled = fillBotSeats(event.seats);
        expect(filled.filter((s) => s.isBot)).toHaveLength(3);

        const seed = 777;
        const dealt = startDraft(
            filled,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );
        const afterInitialBots = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick
        );
        event = {
            ...event,
            seats: afterInitialBots.seats,
            status: "started",
            draftRound: afterInitialBots.draftRound,
            draftPacksRemaining: afterInitialBots.draftPacksRemaining,
            updatedAt: 1,
            ...(afterInitialBots.completed ? { draftCompletedAt: 2 } : {}),
        };

        // 4. Drive ONLY the human seat's picks (`submitPick`'s exact path);
        // every bot pick happens purely as a side effect of `runBotAutoPicks`
        // after each human submission — nothing in this loop ever targets a
        // bot seatIndex, mirroring "no driver ever calls submitPick for a bot
        // seat" but now because it never NEEDS to, not because bots can't
        // draft.
        let round = event.draftRound!;
        let remaining = event.draftPacksRemaining!;
        let seats = event.seats;
        let completed = event.draftCompletedAt !== undefined;
        let safety = 0;
        const HUMAN_SEAT = 0;
        while (!completed) {
            const humanPack = seats[HUMAN_SEAT].currentPack;
            expect(humanPack).toBeDefined();
            expect(humanPack!.length).toBeGreaterThan(0);
            const pickId = humanPack![0].pickId;

            const picked = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                HUMAN_SEAT,
                pickId,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta
            );
            const afterBots = runBotAutoPicks(
                picked.seats,
                picked.draftRound,
                picked.draftPacksRemaining,
                packSlots,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta,
                botChoosePick,
                picked.completed
            );
            seats = afterBots.seats;
            round = afterBots.draftRound;
            remaining = afterBots.draftPacksRemaining;
            completed = afterBots.completed;
            if (++safety > 1000) {
                throw new Error(
                    "test: solo draft never completed — infinite loop guard tripped"
                );
            }
        }

        // 5. Every seat — human AND every bot — has a full 45-card Pool
        // (3 boosters × 15 cards), and nothing is left mid-pick.
        const expectedPerSeat = 15 * packSlots.length;
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(expectedPerSeat);
            expect(seat.currentPack).toBeUndefined();
            expect(seat.packQueue).toEqual([]);
        }

        // 6. Privacy: the bots' Pools/picks never leaked into the human
        // viewer's projection during the draft — same discipline as any
        // other seat (PRD #1107 story 15/26).
        event = {
            ...event,
            seats,
            draftRound: round,
            draftPacksRemaining: remaining,
            draftCompletedAt: 2,
        };
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.userId === "user1")!;
        expect(own.pool).toHaveLength(expectedPerSeat);
        for (const seat of view.seats.filter(
            (s) => s.seatIndex !== HUMAN_SEAT
        )) {
            expect(seat.isBot).toBe(true);
            expect(seat.pool).toBeNull();
            expect(seat.currentPack).toBeNull();
            expect(seat.poolCount).toBe(expectedPerSeat);
        }
    });

    it("scripted 8-seat all-bot draft completes with no human seats at all", () => {
        // No connected client whatsoever — every seat is a Bot Drafter. This
        // is the degenerate-but-supported extreme of issue #1113's guard
        // relaxation: a Draft no longer requires ANY human seat to start.
        const packSlots = ["lea"];
        const seats = fillBotSeats(buildEmptySeats(8));
        expect(seats.every((s) => s.isBot)).toBe(true);

        const seed = 314;
        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );
        const result = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick
        );

        expect(result.completed).toBe(true);
        const expectedPerSeat = 15 * packSlots.length;
        for (const seat of result.seats) {
            expect(seat.pool).toHaveLength(expectedPerSeat);
            expect(seat.currentPack).toBeUndefined();
        }
    });
});

describe("Limited Event Draft Timer + Auto-Pick (issue #1114, PRD #1107 stories 5, 14, 16, 27)", () => {
    it("Auto-Pick, on expiry, chooses EXACTLY what the real Bot Drafter would choose from the same pack/pool", () => {
        // Against the REAL LEA registry (not a stub) — the acceptance
        // criterion is literally "same choice the Bot Drafter would make".
        const packSlots = ["lea"];
        const seed = 9001;
        const timerConfig: TimerConfig = { now: 5_000 };

        const started = startDraft(
            fillBotSeats(buildEmptySeats(2)).map((s, i) =>
                i === 0 ? { ...s, isBot: false, userId: "human1" } : s
            ),
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        // Seat 0 is the lone human; seat 1 is a bot, resolved immediately.
        const afterBots = runBotAutoPicks(
            started.seats,
            started.draftRound,
            started.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            false,
            timerConfig
        );
        const humanSeat = afterBots.seats[0];
        expect(humanSeat.currentPack).toBeDefined();

        // What the timeout path picks…
        const timeoutPickId = resolveAutoPickTimeout(
            afterBots.seats,
            0,
            humanSeat.pickSeq!,
            botChoosePick
        );
        // …versus what calling the SAME bot engine directly on the SAME
        // pack/pool produces.
        const directPickId = chooseBotPick(
            humanSeat.currentPack!,
            humanSeat.pool ?? [],
            getCardEvalMeta
        );
        expect(timeoutPickId).toBe(directPickId);
    });

    it("a permanently-absent human seat's Auto-Picks (via the exact autoPickSeatTimeout sequence) complete the draft with a heuristic-coherent Pool", () => {
        // Mirrors the "solo draft" test above, but the human seat (seat 0)
        // NEVER submits a real pick — every one of its picks is driven by
        // the exact sequence `autoPickSeatTimeout` runs:
        // resolveAutoPickTimeout → applyPick → runBotAutoPicks. This is the
        // acceptance criterion "a draft with a permanently absent human
        // completes; the absent seat's picks are heuristic-coherent."
        const packSlots = ["lea", "lea"];
        const seed = 31337;
        const HUMAN_SEAT = 0;
        const timerConfig: TimerConfig = { now: 1_000 };

        let seats = fillBotSeats(
            assignFreeSeat(buildEmptySeats(4), "human1", "Alice")
        );
        expect(seats[HUMAN_SEAT].isBot).toBeFalsy();

        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        let afterBots = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            false,
            timerConfig
        );
        seats = afterBots.seats;
        let round = afterBots.draftRound;
        let remaining = afterBots.draftPacksRemaining;
        let completed = afterBots.completed;
        let safety = 0;

        while (!completed) {
            const humanSeat = seats[HUMAN_SEAT];
            expect(humanSeat.currentPack).toBeDefined();
            expect(humanSeat.currentPack!.length).toBeGreaterThan(0);

            // Exactly the `autoPickSeatTimeout` mutation body's sequence.
            const pickId = resolveAutoPickTimeout(
                seats,
                HUMAN_SEAT,
                humanSeat.pickSeq!,
                botChoosePick
            );
            expect(pickId).not.toBeNull();
            const picked = applyPick(
                seats,
                round,
                remaining,
                packSlots,
                HUMAN_SEAT,
                pickId!,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta,
                timerConfig
            );
            afterBots = runBotAutoPicks(
                picked.seats,
                picked.draftRound,
                picked.draftPacksRemaining,
                packSlots,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta,
                botChoosePick,
                picked.completed,
                timerConfig
            );
            seats = afterBots.seats;
            round = afterBots.draftRound;
            remaining = afterBots.draftPacksRemaining;
            completed = afterBots.completed;

            if (++safety > 1000) {
                throw new Error(
                    "test: absent-human draft never completed — infinite loop guard tripped"
                );
            }
        }

        const expectedPerSeat = 15 * packSlots.length;
        for (const seat of seats) {
            expect(seat.pool).toHaveLength(expectedPerSeat);
            expect(seat.currentPack).toBeUndefined();
            for (const card of seat.pool!) {
                expect(card.cardName).not.toBe(card.scryfallId);
            }
        }
    });

    it("a stale/superseded schedule (a human picked before the timer fired) is a no-op — never a forced pick", () => {
        // The seq guard IS the mechanism that makes "a client can't force an
        // Auto-Pick on a seat whose human already acted" true: a schedule
        // captured at an earlier pickSeq simply fails to match once the
        // human's own pick (or a later pack) has moved the seat's live
        // pickSeq forward, regardless of who/what invokes the timeout path.
        const packSlots = ["lea"];
        const seed = 55;
        const timerConfig: TimerConfig = { now: 0 };

        const started = startDraft(
            fillBotSeats(buildEmptySeats(2)).map((s, i) =>
                i === 0 ? { ...s, isBot: false, userId: "human1" } : s
            ),
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterBots = runBotAutoPicks(
            started.seats,
            started.draftRound,
            started.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            false,
            timerConfig
        );
        const staleExpectedSeq = afterBots.seats[0].pickSeq!;

        // The human picks for real BEFORE the scheduled timeout ever fires.
        const humanPicked = applyPick(
            afterBots.seats,
            afterBots.draftRound,
            afterBots.draftPacksRemaining,
            packSlots,
            0,
            afterBots.seats[0].currentPack![0].pickId,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterRealPick = runBotAutoPicks(
            humanPicked.seats,
            humanPicked.draftRound,
            humanPicked.draftPacksRemaining,
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            humanPicked.completed,
            timerConfig
        );

        // The stale schedule (captured before the real pick) now resolves to
        // null — a no-op — never re-picking or otherwise disturbing the
        // seat's state.
        const stalePickId = resolveAutoPickTimeout(
            afterRealPick.seats,
            0,
            staleExpectedSeq,
            botChoosePick
        );
        expect(stalePickId).toBeNull();
    });

    it("ADR 0060 / issue #1249: Auto-Pick honours the seat's Selected Card over the Bot Drafter heuristic, through the exact autoPickSeatTimeout sequence", () => {
        // Against the REAL LEA registry/heuristic, exactly like the sibling
        // "same choice the Bot Drafter would make" test above — but here a
        // Selected Card (`selectedPickId`, issue #1248's persisted seat field)
        // is set to a DIFFERENT card than what the heuristic would choose, so
        // this proves the selection actually wins, not just "happens to
        // agree with the heuristic."
        const packSlots = ["lea"];
        const seed = 9001;
        const timerConfig: TimerConfig = { now: 5_000 };

        const started = startDraft(
            fillBotSeats(buildEmptySeats(2)).map((s, i) =>
                i === 0 ? { ...s, isBot: false, userId: "human1" } : s
            ),
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterBots = runBotAutoPicks(
            started.seats,
            started.draftRound,
            started.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            false,
            timerConfig
        );
        const humanSeat = afterBots.seats[0];
        expect(humanSeat.currentPack).toBeDefined();

        // What the heuristic alone would pick, for contrast.
        const heuristicPickId = chooseBotPick(
            humanSeat.currentPack!,
            humanSeat.pool ?? [],
            getCardEvalMeta
        );
        // The human's tentative Selected Card — a DIFFERENT card in the same
        // pack (mirrors `selectDraftPick`'s persisted `selectedPickId`).
        const selected = humanSeat.currentPack!.find(
            (c) => c.pickId !== heuristicPickId
        )!;
        expect(selected).toBeDefined();

        const seatsWithSelection = afterBots.seats.map((s, i) =>
            i === 0 ? { ...s, selectedPickId: selected.pickId } : s
        );

        // Exactly the `autoPickSeatTimeout` mutation body's sequence.
        const timeoutPickId = resolveAutoPickTimeout(
            seatsWithSelection,
            0,
            humanSeat.pickSeq!,
            botChoosePick
        );
        expect(timeoutPickId).toBe(selected.pickId);
        expect(timeoutPickId).not.toBe(heuristicPickId);

        const picked = applyPick(
            seatsWithSelection,
            afterBots.draftRound,
            afterBots.draftPacksRemaining,
            packSlots,
            0,
            timeoutPickId!,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const pickedPool = picked.seats[0].pool!;
        expect(pickedPool[pickedPool.length - 1].scryfallId).toBe(
            selected.scryfallId
        );
    });

    it("ADR 0060 / issue #1249: a stale Selected Card (no longer in the live currentPack) is ignored — Auto-Pick still falls back to the heuristic, never a forced phantom pick", () => {
        const packSlots = ["lea"];
        const seed = 9001;
        const timerConfig: TimerConfig = { now: 5_000 };

        const started = startDraft(
            fillBotSeats(buildEmptySeats(2)).map((s, i) =>
                i === 0 ? { ...s, isBot: false, userId: "human1" } : s
            ),
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterBots = runBotAutoPicks(
            started.seats,
            started.draftRound,
            started.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            botChoosePick,
            false,
            timerConfig
        );
        const humanSeat = afterBots.seats[0];
        expect(humanSeat.currentPack).toBeDefined();

        const heuristicPickId = chooseBotPick(
            humanSeat.currentPack!,
            humanSeat.pool ?? [],
            getCardEvalMeta
        );

        // A selection referencing a card that is NOT in the live pack —
        // e.g. left over from an earlier pack that already emptied/passed on.
        const seatsWithStaleSelection = afterBots.seats.map((s, i) =>
            i === 0 ? { ...s, selectedPickId: "r0-p0-c999" } : s
        );

        const timeoutPickId = resolveAutoPickTimeout(
            seatsWithStaleSelection,
            0,
            humanSeat.pickSeq!,
            botChoosePick
        );
        expect(timeoutPickId).toBe(heuristicPickId);
    });
});

describe("Limited Event completion + full-disclosure review (issue #1116): sealed event → build → completion → all pools readable by any participant", () => {
    /** Mirrors `userDecks.create`'s persisted shape (`convex/userDecks.ts`) —
     *  what the mutation would insert. `_creationTime` stands in for the
     *  field Convex stamps automatically; `loadHumanDecksBySeat`
     *  (`convex/limitedEvents.ts`) sorts by it to break ties. */
    interface FakeUserDeckRow {
        _creationTime: number;
        format: "limited";
        cards: { cardId: string; cardName: string }[];
        sideboard: { cardId: string; cardName: string }[];
        colors: string[];
        limitedEventId: string;
        limitedSeatId: string;
    }

    /** Builds a Limited-legal deck straight from a seat's Pool — the exact
     *  main/side split `limitedDeckbuild.test.ts` uses (≥40 Maindeck padded
     *  with the Pool's own basics, everything else to the Sideboard). */
    function buildLegalDeckFromPool(
        pool: readonly { cardId: string; cardName: string }[]
    ): {
        cards: { cardId: string; cardName: string }[];
        sideboard: {
            cardId: string;
            cardName: string;
        }[];
    } {
        const nonBasic = pool.filter(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic !== true
        );
        const basic = pool.find(
            (c) => resolveDeckCardMeta(c.cardId)?.isBasic === true
        )!;
        const mainCount = Math.min(30, nonBasic.length);
        const mainFromPool = nonBasic.slice(0, mainCount);
        const sideFromPool = nonBasic.slice(mainCount);
        const basicsNeeded = Math.max(0, 40 - mainFromPool.length);
        return {
            cards: [
                ...mainFromPool,
                ...Array.from({ length: basicsNeeded }, () => ({
                    cardId: basic.cardId,
                    cardName: basic.cardName,
                })),
            ],
            sideboard: sideFromPool,
        };
    }

    /** Mirrors `loadHumanDecksBySeat` (`convex/limitedEvents.ts`) against a
     *  plain in-memory row list, since there is no convex-test harness to
     *  drive the real DB-backed query through. */
    function humanDecksBySeatFrom(
        rows: readonly FakeUserDeckRow[]
    ): Map<number, HumanDeckView> {
        const bySeat = new Map<number, HumanDeckView>();
        for (const row of [...rows].sort(
            (a, b) => b._creationTime - a._creationTime
        )) {
            const seatIndex = Number(row.limitedSeatId);
            if (!Number.isInteger(seatIndex) || bySeat.has(seatIndex)) {
                continue;
            }
            bySeat.set(seatIndex, {
                cards: row.cards,
                sideboard: row.sideboard,
                colors: row.colors,
            });
        }
        return bySeat;
    }

    it("a 3-seat sealed event (2 humans, 1 bot) completes exactly when both humans submit, then every pool + deck is readable by any participant", () => {
        // 1. createLimitedEvent — a 3-seat Sealed LEA event.
        const packSlots = ["lea"];
        assertPackSlotsDraftable(packSlots);
        let event: LimitedEventRow = {
            _id: "completion-event-1",
            createdBy: "admin1",
            type: "sealed",
            status: "open",
            seatCount: 3,
            packSlots,
            sealedBoosterCount: 6,
            seats: buildEmptySeats(3),
            createdAt: 0,
            updatedAt: 0,
        };

        // 2. joinLimitedEvent — Alice and Bob take seats 0/1; seat 2 stays
        // open and becomes a Bot Drafter at start.
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user1", "Alice"),
        };
        event = {
            ...event,
            seats: assignFreeSeat(event.seats, "user2", "Bob"),
        };

        // 3. startLimitedEvent — bot fills seat 2, every seat's Pool is
        // dealt in full (Sealed: final the instant the event starts).
        const filled = fillBotSeats(event.seats);
        const seededSeats = generateSealedPools(
            filled,
            event.packSlots,
            event.sealedBoosterCount!,
            getRuntimeBoosterConfig,
            resolveCardMeta,
            makeRng(2026)
        );
        event = { ...event, seats: seededSeats, status: "started" };
        const aliceSeat = event.seats.find((s) => s.userId === "user1")!;
        const bobSeat = event.seats.find((s) => s.userId === "user2")!;
        const botSeat = event.seats.find((s) => s.isBot)!;

        const eventContext = {
            type: event.type,
            status: event.status,
            draftCompletedAt: event.draftCompletedAt,
        };

        // 4. BEFORE either human submits a deck: not completed, and the
        // projection STILL strips every other seat's Pool (the "strips
        // during" direction) — even though the bot's Pool is already final.
        let deckRows: FakeUserDeckRow[] = [];
        let completion = computeEventCompletion(
            event.seats,
            eventContext,
            (seatIndex) => humanDecksBySeatFrom(deckRows).has(seatIndex)
        );
        expect(completion.completed).toBe(false);
        expect(completion.seatsWithDeck).toBe(1); // only the bot seat counts so far

        let view = projectLimitedEvent(
            event,
            "user1",
            completion.completed,
            completion.seatsWithDeck,
            humanDecksBySeatFrom(deckRows)
        );
        expect(view.completed).toBe(false);
        const bobViewBefore = view.seats.find((s) => s.seatIndex === 1)!;
        expect(bobViewBefore.pool).toBeNull();
        expect(bobViewBefore.humanDeck).toBeNull();

        // 5. Alice builds + submits her deck — `userDecks.create`'s exact
        // seat-ownership gate, then the persisted row.
        expect(() =>
            assertLimitedSeatOwnership(
                event,
                String(aliceSeat.seatIndex),
                "user1"
            )
        ).not.toThrow();
        const aliceDeck = buildLegalDeckFromPool(aliceSeat.pool!);
        deckRows = [
            ...deckRows,
            {
                _creationTime: 10,
                format: "limited",
                cards: aliceDeck.cards,
                sideboard: aliceDeck.sideboard,
                colors: ["R"],
                limitedEventId: event._id,
                limitedSeatId: String(aliceSeat.seatIndex),
            },
        ];
        // Alice's own deck is also a REAL legal deck through the
        // authoritative game-start gate — completion tracks EXISTENCE, but
        // this proves the deck built along the way is a genuine playable one.
        const resolvePoolAlice = () =>
            resolvePoolFromEvent(event, String(aliceSeat.seatIndex));
        const aliceGateDeck: GateDeck = {
            name: "Alice's Sealed Deck",
            format: "limited",
            cards: aliceDeck.cards,
            sideboard: aliceDeck.sideboard,
            limitedEventId: event._id,
            limitedSeatId: String(aliceSeat.seatIndex),
        };
        expect(() =>
            assertDeckLegal(
                aliceGateDeck,
                undefined,
                undefined,
                resolvePoolAlice
            )
        ).not.toThrow();

        // 6. Still not completed — Bob hasn't submitted yet.
        completion = computeEventCompletion(
            event.seats,
            eventContext,
            (seatIndex) => humanDecksBySeatFrom(deckRows).has(seatIndex)
        );
        expect(completion.completed).toBe(false);
        expect(completion.seatsWithDeck).toBe(2); // Alice + the bot

        // 7. Bob builds + submits his deck too.
        expect(() =>
            assertLimitedSeatOwnership(
                event,
                String(bobSeat.seatIndex),
                "user2"
            )
        ).not.toThrow();
        const bobDeck = buildLegalDeckFromPool(bobSeat.pool!);
        deckRows = [
            ...deckRows,
            {
                _creationTime: 20,
                format: "limited",
                cards: bobDeck.cards,
                sideboard: bobDeck.sideboard,
                colors: ["U"],
                limitedEventId: event._id,
                limitedSeatId: String(bobSeat.seatIndex),
            },
        ];

        // 8. NOW every seat has a deck (Alice + Bob submitted, the bot was
        // free the whole time) — the event is completed.
        const humanDecksBySeat = humanDecksBySeatFrom(deckRows);
        completion = computeEventCompletion(
            event.seats,
            eventContext,
            (seatIndex) => humanDecksBySeat.has(seatIndex)
        );
        expect(completion.completed).toBe(true);
        expect(completion.seatsWithDeck).toBe(3);

        // 9. The "reveals at completion" direction: EVERY seat's Pool AND
        // human Deck are now readable by ANY participant — Alice's view,
        // Bob's view, AND a non-participant outsider's view all agree.
        for (const viewerId of ["user1", "user2", "outsider-user"]) {
            view = projectLimitedEvent(
                event,
                viewerId,
                completion.completed,
                completion.seatsWithDeck,
                humanDecksBySeat
            );
            expect(view.completed).toBe(true);
            expect(view.seatsWithDeck).toBe(3);

            const aliceView = view.seats.find((s) => s.seatIndex === 0)!;
            const bobView = view.seats.find((s) => s.seatIndex === 1)!;
            const botView = view.seats.find((s) => s.seatIndex === 2)!;

            expect(aliceView.pool).toEqual(aliceSeat.pool);
            expect(bobView.pool).toEqual(bobSeat.pool);
            expect(botView.pool).toEqual(botSeat.pool);

            expect(aliceView.humanDeck).toEqual({
                cards: aliceDeck.cards,
                sideboard: aliceDeck.sideboard,
                colors: ["R"],
            });
            expect(bobView.humanDeck).toEqual({
                cards: bobDeck.cards,
                sideboard: bobDeck.sideboard,
                colors: ["U"],
            });
            // The bot seat's Deck travels through `autoBuiltDeck` elsewhere
            // (`convex/limitedEvents.ts`'s `projectEventForViewer`), never
            // through `humanDeck` — this pure-projection seam only ever
            // reports `null` here for a bot seat.
            expect(botView.humanDeck).toBeNull();
        }
    });
});

describe("Limited Event Pool Arrangement (ADR 0060, issue #1247): setPoolArrangementEntry's exact mutation-shell path", () => {
    /** Mirrors `setPoolArrangementEntry`'s handler body exactly: derive the
     *  caller's seatIndex from userId, bounds-check `poolIndex` against the
     *  seat's ACTUAL Pool length, fold the patch via `upsertPoolArrangementEntry`,
     *  and write the new seat back. No convex-test harness (project
     *  convention, see this file's header) — this drives the same pure
     *  sequence the mutation calls, in the same order. */
    function applySetPoolArrangementEntry(
        event: LimitedEventRow,
        callerUserId: string,
        args: { poolIndex: number; sideboard?: boolean; column?: number | null }
    ): LimitedEventRow {
        const seatIndex = event.seats.findIndex(
            (s) => s.userId === callerUserId
        );
        if (seatIndex === -1) {
            throw new Error("You do not have a Seat in this event.");
        }
        const seat = event.seats[seatIndex];
        const poolSize = seat.pool?.length ?? 0;
        if (
            !Number.isInteger(args.poolIndex) ||
            args.poolIndex < 0 ||
            args.poolIndex >= poolSize
        ) {
            throw new Error("poolIndex is out of range for this seat's Pool.");
        }
        const nextArrangement = upsertPoolArrangementEntry(
            seat.poolArrangement ?? [],
            args
        );
        const seats = [...event.seats];
        seats[seatIndex] = { ...seat, poolArrangement: nextArrangement };
        return { ...event, seats, updatedAt: event.updatedAt + 1 };
    }

    function eventWithTwoSealedSeats(): LimitedEventRow {
        return {
            _id: "arrangement-event-1",
            createdBy: "admin1",
            type: "sealed",
            status: "started",
            seatCount: 2,
            packSlots: ["lea"],
            sealedBoosterCount: 6,
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                        },
                        {
                            scryfallId: "s2",
                            cardId: "c2",
                            cardName: "Card Two",
                        },
                    ],
                },
                {
                    seatIndex: 1,
                    userId: "user2",
                    nickname: "Bob",
                    pool: [
                        {
                            scryfallId: "s3",
                            cardId: "c3",
                            cardName: "Card Three",
                        },
                    ],
                },
            ],
            createdAt: 0,
            updatedAt: 0,
        };
    }

    it("sideboards the caller's own card at poolIndex, persisted on their seat only", () => {
        let event = eventWithTwoSealedSeats();
        event = applySetPoolArrangementEntry(event, "user1", {
            poolIndex: 1,
            sideboard: true,
        });
        expect(event.seats[0].poolArrangement).toEqual([
            { poolIndex: 1, sideboard: true },
        ]);
        // Bob's seat is untouched.
        expect(event.seats[1].poolArrangement).toBeUndefined();
    });

    it("rejects a poolIndex the caller has no Seat for", () => {
        const event = eventWithTwoSealedSeats();
        expect(() =>
            applySetPoolArrangementEntry(event, "no-such-user", {
                poolIndex: 0,
                sideboard: true,
            })
        ).toThrow(/do not have a Seat/);
    });

    it("rejects a poolIndex out of range for the caller's ACTUAL Pool length (defense against a stale/forged client index)", () => {
        const event = eventWithTwoSealedSeats();
        // Bob's pool has only 1 card (index 0) — index 5 is out of range.
        expect(() =>
            applySetPoolArrangementEntry(event, "user2", {
                poolIndex: 5,
                sideboard: true,
            })
        ).toThrow(/out of range/);
        // Also rejects a negative index.
        expect(() =>
            applySetPoolArrangementEntry(event, "user1", {
                poolIndex: -1,
                sideboard: true,
            })
        ).toThrow(/out of range/);
    });

    it("privacy: the mutated Arrangement is visible ONLY to its own seat's viewer through projectLimitedEvent — never another seat's, even after the same patch call", () => {
        let event = eventWithTwoSealedSeats();
        event = applySetPoolArrangementEntry(event, "user1", {
            poolIndex: 0,
            column: 3,
        });

        const aliceView = projectLimitedEvent(event, "user1");
        const aliceOwn = aliceView.seats.find((s) => s.seatIndex === 0)!;
        expect(aliceOwn.poolArrangement).toEqual([{ poolIndex: 0, column: 3 }]);

        const bobView = projectLimitedEvent(event, "user2");
        const aliceFromBob = bobView.seats.find((s) => s.seatIndex === 0)!;
        expect(aliceFromBob.poolArrangement).toBeNull();
        // Bob's own (untouched) seat still projects to null, not [].
        const bobOwn = bobView.seats.find((s) => s.seatIndex === 1)!;
        expect(bobOwn.poolArrangement).toBeNull();
    });

    it("a second edit merges onto the first instead of clobbering the other dimension", () => {
        let event = eventWithTwoSealedSeats();
        event = applySetPoolArrangementEntry(event, "user1", {
            poolIndex: 0,
            column: 3,
        });
        event = applySetPoolArrangementEntry(event, "user1", {
            poolIndex: 0,
            sideboard: true,
        });
        expect(event.seats[0].poolArrangement).toEqual([
            { poolIndex: 0, column: 3, sideboard: true },
        ]);
    });
});

describe("Limited Event Selected Card (ADR 0060, issue #1248): selectDraftPick's exact mutation-shell path", () => {
    /** Mirrors `selectDraftPick`'s handler body exactly: derive the caller's
     *  seatIndex from userId, reject a non-Draft event, reject a `pickId`
     *  not actually present in the seat's `currentPack`, otherwise overwrite
     *  `selectedPickId` (a `null` `pickId` clears it). No convex-test
     *  harness (project convention, see this file's header) — this drives
     *  the same pure sequence the mutation calls, in the same order. */
    function applySelectDraftPick(
        event: LimitedEventRow,
        callerUserId: string,
        pickId: string | null
    ): LimitedEventRow {
        if (event.type !== "draft") {
            throw new Error("This event is not a Draft.");
        }
        const seatIndex = event.seats.findIndex(
            (s) => s.userId === callerUserId
        );
        if (seatIndex === -1) {
            throw new Error("You do not have a Seat in this event.");
        }
        const seat = event.seats[seatIndex];
        if (
            pickId !== null &&
            !(seat.currentPack ?? []).some((c) => c.pickId === pickId)
        ) {
            throw new Error("That card is not in your current pack.");
        }
        const seats = [...event.seats];
        seats[seatIndex] = {
            ...seat,
            selectedPickId: pickId ?? undefined,
        };
        return { ...event, seats, updatedAt: event.updatedAt + 1 };
    }

    function draftEventWithPack(): LimitedEventRow {
        return {
            _id: "select-event-1",
            createdBy: "admin1",
            type: "draft",
            status: "started",
            seatCount: 2,
            packSlots: ["lea"],
            seats: [
                {
                    seatIndex: 0,
                    userId: "user1",
                    nickname: "Alice",
                    pool: [],
                    currentPack: [
                        {
                            scryfallId: "s1",
                            cardId: "c1",
                            cardName: "Card One",
                            pickId: "r0-p0-c0",
                        },
                        {
                            scryfallId: "s2",
                            cardId: "c2",
                            cardName: "Card Two",
                            pickId: "r0-p0-c1",
                        },
                    ],
                },
                { seatIndex: 1, userId: "user2", nickname: "Bob", pool: [] },
            ],
            createdAt: 0,
            updatedAt: 0,
        };
    }

    it("selects a card actually present in the caller's own currentPack", () => {
        let event = draftEventWithPack();
        event = applySelectDraftPick(event, "user1", "r0-p0-c1");
        expect(event.seats[0].selectedPickId).toBe("r0-p0-c1");
        // Bob's seat is untouched.
        expect(event.seats[1].selectedPickId).toBeUndefined();
    });

    it("a later call OVERWRITES the previous selection — never a toggle", () => {
        let event = draftEventWithPack();
        event = applySelectDraftPick(event, "user1", "r0-p0-c0");
        event = applySelectDraftPick(event, "user1", "r0-p0-c1");
        expect(event.seats[0].selectedPickId).toBe("r0-p0-c1");
    });

    it("`pickId: null` clears the selection", () => {
        let event = draftEventWithPack();
        event = applySelectDraftPick(event, "user1", "r0-p0-c0");
        event = applySelectDraftPick(event, "user1", null);
        expect(event.seats[0].selectedPickId).toBeUndefined();
    });

    it("rejects a pickId not present in the caller's current pack (stale/forged selection)", () => {
        const event = draftEventWithPack();
        expect(() => applySelectDraftPick(event, "user1", "r0-p0-c99")).toThrow(
            /not in your current pack/
        );
    });

    it("rejects a caller with no Seat in the event", () => {
        const event = draftEventWithPack();
        expect(() =>
            applySelectDraftPick(event, "no-such-user", "r0-p0-c0")
        ).toThrow(/do not have a Seat/);
    });

    it("rejects selection on a non-Draft (Sealed) event", () => {
        const sealed: LimitedEventRow = {
            ...draftEventWithPack(),
            type: "sealed",
        };
        expect(() => applySelectDraftPick(sealed, "user1", "r0-p0-c0")).toThrow(
            /not a Draft/
        );
    });

    it("privacy: selectedPickId is visible ONLY to its own seat's viewer through projectLimitedEvent — never another seat's", () => {
        let event = draftEventWithPack();
        event = applySelectDraftPick(event, "user1", "r0-p0-c1");

        const aliceView = projectLimitedEvent(event, "user1");
        const aliceOwn = aliceView.seats.find((s) => s.seatIndex === 0)!;
        expect(aliceOwn.selectedPickId).toBe("r0-p0-c1");

        const bobView = projectLimitedEvent(event, "user2");
        const aliceFromBob = bobView.seats.find((s) => s.seatIndex === 0)!;
        expect(aliceFromBob.selectedPickId).toBeNull();
        // A non-participant viewer sees it stripped too.
        const outsiderView = projectLimitedEvent(event, "outsider-user");
        const aliceFromOutsider = outsiderView.seats.find(
            (s) => s.seatIndex === 0
        )!;
        expect(aliceFromOutsider.selectedPickId).toBeNull();
    });

    it("projects to null (not an empty string) for a viewer's own seat with nothing selected", () => {
        const view = projectLimitedEvent(draftEventWithPack(), "user1");
        const own = view.seats.find((s) => s.seatIndex === 0)!;
        expect(own.selectedPickId).toBeNull();
    });
});

/** `createLimitedEvent`'s cube gate (ADR 0062 §4), modeled exactly as the
 *  mutation enforces it: the Vintage Cube is a curated POOL that deliberately
 *  bypasses the per-set Draftability gate, but is Draft-ONLY — a Sealed event
 *  on the cube must be rejected server-side (defense-in-depth: the dialog
 *  blocks it, but the mutation must not rely on the client). Non-cube slots
 *  still go through the Draftability gate unchanged. */
function assertPackSlotsAllowed(
    packSlots: string[],
    type: "sealed" | "draft",
    seatCount: number
): void {
    for (const setCode of new Set(packSlots)) {
        if (isCubeSource(setCode)) {
            if (type === "sealed") {
                throw new Error(
                    "The Vintage Cube is Draft-only — it cannot be used for a Sealed event."
                );
            }
            // Singleton capacity cap (ADR 0062 rev) — reject an oversized table
            // rather than deal a card twice. Uses the REAL `maxCubeSeats` /
            // `cubePoolSize` the mutation calls, so only the throw comparison is
            // mirrored, never the math.
            const maxSeats = maxCubeSeats(
                cubePoolSize(),
                CUBE_PACK_SIZE,
                packSlots.length
            );
            if (seatCount > maxSeats) {
                throw new Error(
                    `The Vintage Cube's implemented pool supports at most ${maxSeats} seats over ${packSlots.length} boosters without repeating a card.`
                );
            }
            continue;
        }
        if (!isDraftableSet(setCode)) {
            throw new Error(`Set "${setCode}" is not a Draftable Set.`);
        }
    }
}

describe("Limited Event: Vintage Cube gate (Draft-only, ADR 0062 §4)", () => {
    const cubeSlots = [CUBE_SOURCE_KEY, CUBE_SOURCE_KEY, CUBE_SOURCE_KEY];

    it("rejects a Sealed event on the cube source (server-side, not just the dialog)", () => {
        expect(() =>
            assertPackSlotsAllowed([CUBE_SOURCE_KEY], "sealed", 2)
        ).toThrow(/Draft-only/);
    });

    it("accepts a Draft event on the cube source, bypassing the Draftability gate", () => {
        // The cube is NOT a Draftable Set in the registry sense (no per-set
        // sheets), yet a Draft on it must be allowed — the gate is bypassed
        // for the curated pool.
        expect(isDraftableSet(CUBE_SOURCE_KEY)).toBe(true);
        expect(() =>
            assertPackSlotsAllowed(cubeSlots, "draft", 2)
        ).not.toThrow();
    });

    it("still rejects a genuinely non-Draftable real set (cube bypass is cube-specific)", () => {
        expect(() =>
            assertPackSlotsAllowed(["definitely-not-a-set"], "draft", 2)
        ).toThrow(/not a Draftable Set/);
    });

    // ADR 0062 rev (one-copy-max is a hard invariant): a table that can't be
    // filled singleton from the implemented pool is rejected at creation, not
    // dealt with-replacement. Boundaries are derived from the LIVE pool so the
    // test doesn't rot as cube cards are implemented (the cap self-lifts).
    it("rejects a cube Draft whose seat count exceeds the singleton capacity", () => {
        const cap = maxCubeSeats(cubePoolSize(), CUBE_PACK_SIZE, 3);
        expect(() =>
            assertPackSlotsAllowed(cubeSlots, "draft", cap + 1)
        ).toThrow(/without repeating a card/);
    });

    it("accepts a cube Draft exactly at the singleton capacity", () => {
        const cap = maxCubeSeats(cubePoolSize(), CUBE_PACK_SIZE, 3);
        expect(() =>
            assertPackSlotsAllowed(cubeSlots, "draft", cap)
        ).not.toThrow();
    });
});

describe("Limited Event Bot Pick Rating DB layer (PRD #1296 Slice A, ADR 0065, issue #1297): the exact loadEventPickRating + makeBotChoosePick wiring convex/limitedEvents.ts's mutations use", () => {
    /** Mirrors `convex/limitedEvents.ts`'s `makeBotChoosePick` exactly. */
    function makeBotChoosePick(getPickRating: GetPickRating): ChooseBotPick {
        return (seat, pack) =>
            chooseBotPick(
                pack,
                seat.pool ?? [],
                getCardEvalMeta,
                getPickRating
            );
    }

    /** Mirrors `loadEventPickRating`'s eventual in-memory result: a
     *  `GetDbRating` built from a plain `(scope, cardId) -> rating` map,
     *  standing in for a `cardRatings` table scan (no convex-test harness —
     *  project convention, see this file's header). */
    function fakeDb(rows: Record<string, Record<string, number>>): GetDbRating {
        return (scope, cardId) => rows[scope]?.[cardId] ?? null;
    }

    /** A rating comfortably above any real seed-file ceiling
     *  (`PICK_RATING_MAX` = 5) — guarantees the forced target DOMINATES
     *  regardless of whether the pack happens to already contain a
     *  seed-rated bomb (e.g. Black Lotus) tied at the real ceiling. Bounds
     *  enforcement is the future Admin write mutation's job (PRD #1296
     *  Slice B); this pure layering seam is intentionally unbounded, exactly
     *  like `scoreCandidateWithRating`'s own `rating` parameter. */
    const DOMINANT_TEST_RATING = 100;

    it("a database rating for a SET scope (lea) changes which card the bot picks vs. today's exact wiring", () => {
        const packSlots = ["lea"];
        const seed = 424242;
        const dealt = startDraft(
            fillBotSeats(buildEmptySeats(2)),
            packSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );
        const pack = dealt.seats[0].currentPack!;
        expect(pack.length).toBeGreaterThan(1);

        // Baseline: today's EXACT pre-Slice-A wiring (`getPickRatingByCardId`).
        const baselinePickId = chooseBotPick(
            pack,
            [],
            getCardEvalMeta,
            getPickRatingByCardId
        );
        const target = pack.find((c) => c.pickId !== baselinePickId)!;
        expect(target).toBeDefined();

        const getPickRating = resolveEventPickRating(
            packSlots,
            fakeDb({ lea: { [target.cardId]: DOMINANT_TEST_RATING } })
        );
        const layeredPickId = makeBotChoosePick(getPickRating)(
            dealt.seats[0],
            pack
        );

        expect(layeredPickId).toBe(target.pickId);
        expect(layeredPickId).not.toBe(baselinePickId);
    });

    it("a database rating for the vintage-cube scope changes which card the bot picks", () => {
        const cubeSlots = [CUBE_SOURCE_KEY];
        const seed = 13;
        const dealt = startDraft(
            fillBotSeats(buildEmptySeats(2)),
            cubeSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );
        const pack = dealt.seats[0].currentPack!;
        expect(pack.length).toBe(CUBE_PACK_SIZE);

        const baselinePickId = chooseBotPick(
            pack,
            [],
            getCardEvalMeta,
            getPickRatingByCardId
        );
        const target = pack.find((c) => c.pickId !== baselinePickId)!;
        expect(target).toBeDefined();

        const getPickRating = resolveEventPickRating(
            cubeSlots,
            fakeDb({
                [CUBE_SOURCE_KEY]: { [target.cardId]: DOMINANT_TEST_RATING },
            })
        );
        const layeredPickId = makeBotChoosePick(getPickRating)(
            dealt.seats[0],
            pack
        );

        expect(layeredPickId).toBe(target.pickId);
        expect(layeredPickId).not.toBe(baselinePickId);
    });

    it("regression: an empty cardRatings table reproduces today's EXACT multi-round, all-bot lea draft outcome (pool for pool)", () => {
        const packSlots = ["lea", "lea"];
        const seed = 909090;

        // `getPickRatingByCardId` is registry-agnostic BY DESIGN — its own
        // doc comment: "if [a card id appearing in more than one checked-in
        // file] ever changes, the first file found wins". PRD #1296 Slice D
        // (issue #1299) makes that case real: `data/pick-ratings/vintage-
        // cube.json` legitimately rates some of the SAME canonical card ids
        // as `lea.json` (original dual lands, Power Nine — printed in LEA
        // AND pooled into the cube), so `getPickRatingByCardId` now leaks a
        // vintage-cube rating into a pure LEA draft and is no longer a
        // faithful "lea draft, no DB" baseline. `getPickRating("lea", ...)`
        // stays scoped to exactly the file this draft's `packSlots` name —
        // what actually matters here: Slice A's DB-layering is a no-op vs.
        // the LEA-scoped seed lookup when the database is empty, a
        // guarantee no future additional checked-in file can perturb.
        const oldChoosePick: ChooseBotPick = (seat, pack) =>
            chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta, (cardId) =>
                getPickRating("lea", cardId)
            );
        const newChoosePick = makeBotChoosePick(
            resolveEventPickRating(packSlots, fakeDb({}))
        );

        function runFullBotDraft(pick: ChooseBotPick) {
            const seats = fillBotSeats(buildEmptySeats(4));
            const dealt = startDraft(
                seats,
                packSlots,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta
            );
            return runBotAutoPicks(
                dealt.seats,
                dealt.draftRound,
                dealt.draftPacksRemaining,
                packSlots,
                seed,
                getRuntimeBoosterConfig,
                resolveCardMeta,
                pick
            );
        }

        const oldResult = runFullBotDraft(oldChoosePick);
        const newResult = runFullBotDraft(newChoosePick);

        expect(oldResult.completed).toBe(true);
        expect(newResult.completed).toBe(true);
        expect(newResult.seats).toEqual(oldResult.seats);
    });
});

describe("checked-in Vintage Cube Pick Rating seed (PRD #1296 Slice D, issue #1299): bots draft the cube on curated data, not the raw heuristic", () => {
    // Same "REAL production lookup, no fake DB" wiring the LEA "scripted
    // all-bot draft" test in `botDrafter.test.ts` uses — the point of this
    // suite is proving the SHIPPED `data/pick-ratings/vintage-cube.json` seed
    // (wired into `pickRatings.ts`'s `CHECKED_IN_PICK_RATINGS` under the
    // reserved `CUBE_SOURCE_KEY`) is actually picked up by
    // `resolveEventPickRating`/`getPickRatingByCardId` and changes real bot
    // picks — not just that the file parses.
    const realBotChoosePickRated: ChooseBotPick = (seat, pack) =>
        chooseBotPick(
            pack,
            seat.pool ?? [],
            getCardEvalMeta,
            getPickRatingByCardId
        );
    const realBotChoosePickHeuristicOnly: ChooseBotPick = (seat, pack) =>
        chooseBotPick(pack, seat.pool ?? [], getCardEvalMeta);

    // Comfortably above `PICK_RATING_NEUTRAL` (2.5) so `PICK_RATING_DOMINANCE_
    // WEIGHT` guarantees the curated rating overrides the Pick Heuristic —
    // mirrors the LEA suite's own `OBVIOUS_BOMB_THRESHOLD`.
    const OBVIOUS_BOMB_THRESHOLD = 4.5;

    it("resolveEventPickRating, given the vintage-cube scope and an EMPTY database, surfaces the checked-in seed rating for a real cube card (Black Lotus)", () => {
        const blackLotusId = "b0faa7f2-b547-42c4-a810-839da50dadfe";
        const emptyDb: GetDbRating = () => null;
        const getPickRating = resolveEventPickRating(
            [CUBE_SOURCE_KEY],
            emptyDb
        );
        expect(getPickRating(blackLotusId)).toBe(5);
        expect(getPickRatingByCardId(blackLotusId)).toBe(5);
    });

    it("a scripted all-bot Vintage Cube draft: every pack containing a curated bomb (rating >= 4.5) is taken over the heuristic's own favorite", () => {
        const cubeSlots = [CUBE_SOURCE_KEY, CUBE_SOURCE_KEY, CUBE_SOURCE_KEY];
        const seed = 20260717;
        const seats = fillBotSeats(buildEmptySeats(8));
        const dealt = startDraft(
            seats,
            cubeSlots,
            seed,
            getRuntimeBoosterConfig,
            resolveCardMeta
        );

        let sawAtLeastOneObviousBomb = false;
        let sawRatingDivergence = false;
        for (const seat of dealt.seats) {
            const pack = seat.currentPack!;
            expect(pack.length).toBe(CUBE_PACK_SIZE);

            const bombs = pack
                .map((c) => {
                    const rating = getPickRatingByCardId(c.cardId);
                    return rating !== null && rating >= OBVIOUS_BOMB_THRESHOLD
                        ? { pickId: c.pickId, cardName: c.cardName }
                        : null;
                })
                .filter(
                    (b): b is { pickId: string; cardName: string } => b !== null
                );
            if (bombs.length === 0) continue;
            sawAtLeastOneObviousBomb = true;

            const ratedPick = realBotChoosePickRated(seat, pack);
            expect(bombs.some((b) => b.pickId === ratedPick)).toBe(true);

            // And the heuristic-only pick (no rating layer) is NOT guaranteed
            // to agree — this is the "bots draft on real ratings instead of
            // the raw heuristic" acceptance criterion (issue #1299), not a
            // vacuous truth. At least one bomb pack in this seeded draft must
            // diverge from the pure-heuristic pick. (The heuristic's own pick
            // may itself coincidentally be a different bomb — the acceptance is
            // that the RATED pick is always a bomb, above, and that ratings
            // demonstrably move the pick off the heuristic favorite at least
            // once, tracked here — not that the heuristic never lands on a
            // bomb.)
            const heuristicOnlyPick = realBotChoosePickHeuristicOnly(
                seat,
                pack
            );
            if (heuristicOnlyPick !== ratedPick) {
                sawRatingDivergence = true;
            }
        }

        expect(sawAtLeastOneObviousBomb).toBe(true);
        expect(sawRatingDivergence).toBe(true);
    });
});
