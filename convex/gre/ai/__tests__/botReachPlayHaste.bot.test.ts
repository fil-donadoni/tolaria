// Bot-play sweep (ADR 0105 § 7.2, issue #3830) — haste, Squee and the cast-shape / stack / unmodelled pins.
// One fixture per outcome on the generated position; the sweep itself runs over the whole
// `ready` set in `oracle:compile`, these files are the evidence its verdicts
// mean what the lockfile says (split by cost, issue #6148).

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../../cards";
import { withTemporaryDefinition } from "../../../cards/registry";
import type { CardDefinition } from "../../../cards/types";
import { decidingPlayer } from "../../search";
import { enumerateMoves } from "../../moves";
import {
    REACH_WINDOWS,
    botReachSpec,
    buildBotReachState,
    castShape,
    classifyNoMove,
    playBotReach,
    playBotReachSeats,
} from "../botReach";
import {
    NO_OP_SORCERY,
    UNTARGETABLE_INSTANT,
    COUNTER_INSTANT,
    FLASH_ETB_COUNTER,
    HASTE_CREATURE,
    SELF_GRANTED_HASTE_CREATURE,
    KICKED_SWEEP_CREATURE,
} from "./botReachPlay.fixture";

describe("Bot-play sweep (ADR 0105 § 7.2) — haste, Squee and the cast-shape / stack / unmodelled pins", () => {
    // Issue #4470 (Bot Gap `never-chosen › Sorcery ›
    // chooseNumber+coinFlipSeries+draw+if`) — Squee's Revenge's "if you win
    // all the flips, draw two cards for each flip" priced its `then` branch
    // as CERTAIN (`opValuers.ts`'s pre-#4470 `if` walker), so its static
    // hand-value out-priced Lightning Bolt's and the search preferred NEVER
    // casting it over any real line of play. `opValuers.ts`'s
    // `coinFlipSeriesWinProbability` discount is what turns this `ignored`
    // into `played` — a regression here means that discount regressed.
    it("played — Squee's Revenge, once its coin-flip win-check is priced at its real odds instead of 1.0", () => {
        expect(playBotReach(getCardByName("Squee's Revenge")).outcome).toBe(
            "played"
        );
    });

    // Issue #4069 (and its twin Bot Gap `Creature [haste]`): into an untapped
    // blocker the first main phase's `pass` beats the cast on every seed, and
    // the Bot casts the creature in the second. A sweep that posed only the
    // first window read that hold as a refusal.
    it("played — a printed-haste creature the Bot holds past combat", () => {
        withTemporaryDefinition(HASTE_CREATURE, () => {
            expect(playBotReach(HASTE_CREATURE)).toEqual({ outcome: "played" });
        });
    });

    it("played — a creature granted haste by a static effect, held past combat", () => {
        withTemporaryDefinition(SELF_GRANTED_HASTE_CREATURE, () => {
            expect(playBotReach(SELF_GRANTED_HASTE_CREATURE)).toEqual({
                outcome: "played",
            });
        });
    });

    it("the second window is the same turn's post-combat main phase", () => {
        withTemporaryDefinition(HASTE_CREATURE, () => {
            for (const window of REACH_WINDOWS) {
                expect(botReachSpec(HASTE_CREATURE, window).phase).toBe(window);
                for (const seat of [0, 1] as const) {
                    const { state, holderId } = buildBotReachState(
                        HASTE_CREATURE,
                        seat,
                        window
                    );
                    expect(state.phase).toBe(window);
                    expect(decidingPlayer(state)).toBe(holderId);
                }
            }
        });
    });

    it("position-unmodelled — the position cannot pose the card, so it ships", () => {
        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            expect(playBotReach(UNTARGETABLE_INSTANT)).toEqual({
                outcome: "ignored",
                cause: "position-unmodelled",
                form: "Instant target:Planeswalker",
            });
        });
    });

    it("frozen — the engine offers the action and no Move uses the card", () => {
        // The discriminator, on two REAL positions. No shipped card exhibits
        // the frozen arm today (`legalActions` and the enumerator agree on
        // every card of the first full pass), which is why it is asserted
        // here rather than through a card that cannot be written.
        const bears = getCardByName("Grizzly Bears");
        const castable = buildBotReachState(bears, 0);
        expect(
            classifyNoMove(
                castable.state,
                castable.holderId,
                castable.instanceId,
                bears
            )
        ).toEqual({
            outcome: "frozen",
            cause: "no-legal-move",
            form: "Creature",
        });

        withTemporaryDefinition(UNTARGETABLE_INSTANT, () => {
            const blocked = buildBotReachState(UNTARGETABLE_INSTANT, 0);
            expect(
                classifyNoMove(
                    blocked.state,
                    blocked.holderId,
                    blocked.instanceId,
                    UNTARGETABLE_INSTANT
                ).outcome
            ).toBe("ignored");
        });
    });

    it("both seats — the holder owns the decision whichever seat it is", () => {
        const def = getCardByName("Grizzly Bears");
        for (const seat of [0, 1] as const) {
            const { state, holderId, instanceId } = buildBotReachState(
                def,
                seat
            );
            expect(holderId).toBe(state.players[seat]!.id);
            expect(decidingPlayer(state)).toBe(holderId);
            const holder = state.players[seat]!;
            expect(holder.hand.some((c) => c.id === instanceId)).toBe(true);
        }
    });

    it("both seats — the card is actually played from each seat", () => {
        const seats = playBotReachSeats(getCardByName("Grizzly Bears"));
        const base = buildBotReachState(
            getCardByName("Grizzly Bears"),
            0
        ).state.players.map((p) => p.id);
        expect(seats.map((s) => s.holderId)).toEqual(base);
        // Neither seat freezes. Not "both played": at the sweep's budget the
        // second-built seat's search is noisier on this very position (see
        // docs/findings/3830-bot-reach-seat-asymmetric-search-noise.md), and
        // `played` means SOME seat chose the card — `ignored` is "never".
        expect(seats[0]!.verdict.outcome).toBe("played");
        expect(seats[1]!.verdict.outcome).not.toBe("frozen");
    });

    it("a spell-targeting card gets a spell on the stack to target", () => {
        // CR 115.1 — the one branch that VARIES the generated position. No
        // `ready` card declares a spell target today, so without this fixture
        // the branch decides nothing anywhere (review of PR #4057,
        // finding 11).
        withTemporaryDefinition(COUNTER_INSTANT, () => {
            const { state, holderId, instanceId } = buildBotReachState(
                COUNTER_INSTANT,
                0
            );
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.castById).not.toBe(holderId);
            const moves = enumerateMoves(state, holderId).filter(
                (m) => "cardInstanceId" in m && m.cardInstanceId === instanceId
            );
            expect(moves.length).toBeGreaterThan(0);
            expect(playBotReach(COUNTER_INSTANT).outcome).not.toBe("frozen");
        });
    });

    it("a flash permanent whose enters trigger targets a spell gets one to target", () => {
        // CR 603.6a — the target lives on the TRIGGER, not the card (Mystic
        // Snake, issue #4282): without a spell on the stack the trigger has
        // no target and the creature is only a vanilla 2/2 for four.
        withTemporaryDefinition(FLASH_ETB_COUNTER, () => {
            const { state, holderId, instanceId } = buildBotReachState(
                FLASH_ETB_COUNTER,
                0
            );
            expect(state.stack).toHaveLength(1);
            expect(state.stack[0]!.castById).not.toBe(holderId);
            const moves = enumerateMoves(state, holderId).filter(
                (m) => "cardInstanceId" in m && m.cardInstanceId === instanceId
            );
            expect(moves.length).toBeGreaterThan(0);
            // The verdict itself (issue #4282): with the spell to counter on
            // the stack the search picks the creature at some seat.
            expect(playBotReach(FLASH_ETB_COUNTER).outcome).toBe("played");
        });
    });

    it("a sorcery-speed permanent with a spell-targeting trigger is not posed a stack", () => {
        // CR 117.1a — a noninstant is castable only on an empty stack, so a
        // spell on the stack would make the card unplayable, not pose it.
        const sorcerySpeed: CardDefinition = {
            ...FLASH_ETB_COUNTER,
            id: "bot-reach-test:sorcery-speed-etb-counter",
            name: "Bot Reach Slow Snake",
            staticAbilities: [],
        };
        withTemporaryDefinition(sorcerySpeed, () => {
            const { state } = buildBotReachState(sorcerySpeed, 0);
            expect(state.stack).toHaveLength(0);
        });
    });

    it("a verdict does not depend on the order cards are swept in", () => {
        // The sweep registers 3,400 definitions into one long-running
        // process; a verdict that moved with registration order would make
        // the lockfile non-reproducible.
        // A PAIR THAT DISAGREES — one `played`, one `ignored`. Two cards with
        // the same verdict cannot see an order dependency at all: whatever
        // leaked between them would carry the answer they already share.
        withTemporaryDefinition(NO_OP_SORCERY, () => {
            const bears = getCardByName("Grizzly Bears");
            const forward = [playBotReach(bears), playBotReach(NO_OP_SORCERY)];
            const backward = [playBotReach(NO_OP_SORCERY), playBotReach(bears)];
            expect(forward[0]!.outcome).toBe("played");
            expect(forward[1]!.outcome).toBe("ignored");
            expect(forward).toEqual([backward[1], backward[0]]);
        });
    });

    it("the form is the cast shape, never the card", () => {
        expect(castShape(UNTARGETABLE_INSTANT)).toBe(
            "Instant target:Planeswalker"
        );
        expect(castShape(getCardByName("Fireball"))).toBe(
            "Sorcery target:any X"
        );
    });

    // Issue #4284: the pose seeded lands in the colours of the printed cost
    // only, so a kicker paid in another colour was never payable and the card
    // was measured on its unkicked half alone (`never-chosen › Creature ›
    // destroy+forEach+if`).
    it("the pose's lands cover a kicker leg's colours as well as the cost's", () => {
        const lands = botReachSpec(KICKED_SWEEP_CREATURE)
            .cards.filter((c) => c.zone === "battlefield")
            .map((c) => c.name);
        expect(lands).toContain("Mountain");
        expect(lands).toContain("Plains");
    });

    it("a kicker leg's lands are added, never dealt out of the printed cost's", () => {
        const heavy: CardDefinition = {
            ...KICKED_SWEEP_CREATURE,
            manaCost: { R: 3 },
        };
        const lands = botReachSpec(heavy)
            .cards.filter((c) => c.zone === "battlefield")
            .map((c) => c.name);
        expect(
            lands.filter((n) => n === "Mountain").length
        ).toBeGreaterThanOrEqual(3);
        expect(lands.filter((n) => n === "Plains")).toHaveLength(2);
    });
});
