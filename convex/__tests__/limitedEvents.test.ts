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
import { manaValue } from "../gre/constants";
import { makeRng } from "../gre/rng";
import {
    applyPick,
    resolveAutoPickTimeout,
    runBotAutoPicks,
    startDraft,
    type ChooseBotPick,
    type TimerConfig,
} from "../limited/draftEngine";
import { chooseBotPick, type GetCardEvalMeta } from "../limited/botDrafter";
import {
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
            getBoosterConfig,
            resolveCardMeta
        );
        const afterInitialBots = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
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
                getBoosterConfig,
                resolveCardMeta
            );
            const afterBots = runBotAutoPicks(
                picked.seats,
                picked.draftRound,
                picked.draftPacksRemaining,
                packSlots,
                seed,
                getBoosterConfig,
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
        event = { ...event, seats, draftRound: round, draftPacksRemaining: remaining, draftCompletedAt: 2 };
        const view = projectLimitedEvent(event, "user1");
        const own = view.seats.find((s) => s.userId === "user1")!;
        expect(own.pool).toHaveLength(expectedPerSeat);
        for (const seat of view.seats.filter((s) => s.seatIndex !== HUMAN_SEAT)) {
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
            getBoosterConfig,
            resolveCardMeta
        );
        const result = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
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
        const timerConfig: TimerConfig = { timerSeconds: 30, now: 5_000 };

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
        // Seat 0 is the lone human; seat 1 is a bot, resolved immediately.
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
        const timerConfig: TimerConfig = { timerSeconds: 30, now: 1_000 };

        let seats = fillBotSeats(
            assignFreeSeat(buildEmptySeats(4), "human1", "Alice")
        );
        expect(seats[HUMAN_SEAT].isBot).toBeFalsy();

        const dealt = startDraft(
            seats,
            packSlots,
            seed,
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        let afterBots = runBotAutoPicks(
            dealt.seats,
            dealt.draftRound,
            dealt.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
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
                getBoosterConfig,
                resolveCardMeta,
                timerConfig
            );
            afterBots = runBotAutoPicks(
                picked.seats,
                picked.draftRound,
                picked.draftPacksRemaining,
                packSlots,
                seed,
                getBoosterConfig,
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
        const timerConfig: TimerConfig = { timerSeconds: 10, now: 0 };

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
            getBoosterConfig,
            resolveCardMeta,
            timerConfig
        );
        const afterRealPick = runBotAutoPicks(
            humanPicked.seats,
            humanPicked.draftRound,
            humanPicked.draftPacksRemaining,
            packSlots,
            seed,
            getBoosterConfig,
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
});
