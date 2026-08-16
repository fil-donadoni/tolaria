// MH3 blue — Tamiyo, Inquisitive Student // Tamiyo, Seasoned Scholar
// (issue #2385).
//
// The exile-and-return-transformed flip template's OWN Op-level coverage
// (CR 400.7 new-object semantics, CR 306.5b starting loyalty, wire format)
// lives with the Op itself in `convex/gre/effects/__tests__/interpreter.test.ts`
// (Jace, Vryn's Prodigy is the tracer). The +2's OWN delayed-trigger
// mechanism — the new `until-next-turn-creature-attacks-you` timing,
// multi-attacker fan-out, repeating/expiry — also has its permanent test
// there (`interpreter.test.ts`, review round 2 on PR #2487); what's tested
// HERE is what only THIS CARD can prove: the front face's own
// investigate/flip triggers fire off the real engine entry points, +2
// scheduled through the real loyalty-ability activation path and surviving
// the intervening opponent turn, and the −3/−7 abilities do what they say —
// including the two genuinely new primitives this card required
// (`targetMatchesGraveyardFilter`, the `divide` value grammar member) and
// the emblem's hand-size override.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import {
    drawCard,
    emitCardDrawn,
    processPendingActionTriggers,
    resolveTopOfStack,
    type CardInstanceState,
    type GameState,
} from "../../../../gre/state";
import { assertLoyaltyActivationLegal, payLoyaltyCost } from "../../../../game";
import { applyPendingChoiceSubmit } from "../../../../gre/pendingChoiceSubmit";
import { compactState, expandState } from "../../../../gre/serialize";
import {
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { projectPublicState } from "../../../../gameProjections";
import {
    advancePhase,
    effectiveMaxHandSize,
    emitAttackersDeclaredEvents,
} from "../../../../gre/phases";
import { getDefinition } from "../../../index";
import { tamiyoInquisitiveStudent } from "../blue";
import { TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID } from "../../../emblems";
import { lightningBolt } from "../../lea/red";
import { giantGrowth, grizzlyBears } from "../../lea/green";

const TAMIYO = tamiyoInquisitiveStudent.id;

/** Board with Tamiyo (front face) on p1's battlefield, plus `libraryCount`
 *  filler cards in p1's library (grizzlyBears, arbitrary vanilla filler). */
function boardWithTamiyo(libraryCount = 5): {
    state: GameState;
    tamiyo: CardInstanceState;
} {
    const tamiyo = makeInstance(TAMIYO, {
        id: "tamiyo",
        controllerId: "p1",
        ownerId: "p1",
    });
    const library = Array.from({ length: libraryCount }, (_, i) =>
        makeInstance(grizzlyBears.id, {
            id: `tamiyo-lib-${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "library",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [tamiyo], library }),
            makePlayer("p2"),
        ],
    });
    return { state, tamiyo };
}

/** Declares `attackerIds` as attackers through the REAL production entry
 *  point (`emitAttackersDeclaredEvents`, CR 508.1), mirroring the
 *  `blc/white.test.ts` / `clb/red.test.ts` convention — a hand-built stack
 *  item would never exercise the attacker-debuff window this card needs. */
function declareAttackers(
    state: GameState,
    activePlayerId: string,
    attackerIds: string[]
): void {
    state.activePlayerId = activePlayerId;
    state.phase = "DECLARE_ATTACKERS";
    state.combat = {
        attackerIds,
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    emitAttackersDeclaredEvents(state);
}

describe("Tamiyo, Inquisitive Student — front face (CR 702.9, 701.7, 712)", () => {
    it("has flying", () => {
        const def = getDefinition(TAMIYO);
        expect(def.staticAbilities).toContain("flying");
    });

    it("attacking investigates — creates a Clue token", () => {
        const { state } = boardWithTamiyo();
        declareAttackers(state, "p1", ["tamiyo"]);
        // The investigate trigger goes on the stack (CR 603.3); resolve it.
        resolveTopOfStack(state);
        const clue = state.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Clue")
        );
        expect(clue).toBeDefined();
        expect(clue!.types).toEqual(["Artifact"]);

        // Wire format — the token is board-visible.
        const projected = projectPublicState(state, 1, "p1");
        const slimClue = projected.players[0].battlefield.find((c) =>
            c.subtypes?.includes("Clue")
        );
        expect(slimClue).toBeDefined();
    });

    it("drawing a third card in a turn exiles and returns Tamiyo transformed under her owner's control", () => {
        const { state } = boardWithTamiyo(5);
        const p1 = state.players[0];

        // Draw three cards this turn — `emitCardDrawn` stamps
        // `drawIndexThisTurn` on each, so the third fires `nthDrawThisTurn(3)`
        // and places the flip trigger on the stack (CR 603.3); resolve it.
        simulateDraws(state, "p1", 3);
        resolveTopOfStack(state);

        const flipped = p1.battlefield.find((c) => c.id === "tamiyo")!;
        expect(flipped.transformed).toBe(true);
        expect(flipped.types).toEqual(["Planeswalker"]);
        expect(flipped.subtypes).toEqual(["Tamiyo"]);
        // CR 306.5b — Tamiyo, Seasoned Scholar's printed starting loyalty.
        expect(flipped.counters?.loyalty).toBe(2);

        // Wire format — both players see the flipped planeswalker face.
        for (const viewerId of ["p1", "p2"]) {
            const projected = projectPublicState(state, 1, viewerId);
            const slim = projected.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            expect(slim.types).toEqual(["Planeswalker"]);
            expect(slim.counters?.loyalty).toBe(2);
            const backDef = getDefinition(slim.card.id);
            expect(backDef.name).toBe("Tamiyo, Seasoned Scholar");
            expect(backDef.activatedAbilities).toHaveLength(3);
        }
    });
});

/** Simulates a real draw (library -> hand) through the engine's real
 *  CARD_DRAWN choke point (`drawCard` + `emitCardDrawn`), exactly like the
 *  turn-based draw step / effect-driven draws do — so `drawIndexThisTurn` is
 *  stamped for real, never hand-built (mirrors `mom/__tests__/blue.test.ts`'s
 *  Faerie Mastermind convention, the `nthDrawThisTurn` tracer). */
function simulateDraw(state: GameState, drawingPlayerId: string): void {
    const player = state.players.find((p) => p.id === drawingPlayerId)!;
    if (drawCard(player) !== null) {
        emitCardDrawn(state, drawingPlayerId, 1, false);
    }
    processPendingActionTriggers(state);
}

/** Draws `count` cards one at a time through `simulateDraw`. */
function simulateDraws(
    state: GameState,
    drawingPlayerId: string,
    count: number
): void {
    for (let i = 0; i < count; i++) simulateDraw(state, drawingPlayerId);
}

describe("Tamiyo, Seasoned Scholar — the three loyalty abilities (CR 606)", () => {
    /** Board with the BACK face already on the battlefield, reached through
     *  the real third-draw flip (never hand-built) so the abilities under
     *  test are the ones a real game would offer. */
    function flippedBoard(libraryCount = 5): {
        state: GameState;
        tamiyo: CardInstanceState;
    } {
        const { state } = boardWithTamiyo(libraryCount);
        simulateDraws(state, "p1", 3);
        resolveTopOfStack(state);
        const tamiyo = state.players[0].battlefield.find(
            (c) => c.id === "tamiyo"
        )!;
        expect(tamiyo.transformed).toBe(true);
        return { state, tamiyo };
    }

    function backFaceAbility(state: GameState, abilityId: string) {
        const tamiyo = state.players[0].battlefield.find(
            (c) => c.id === "tamiyo"
        )!;
        const def = getDefinition((tamiyo.card as { id: string }).id);
        return def.activatedAbilities!.find((a) => a.id === abilityId)!;
    }

    function activate(
        state: GameState,
        abilityId: string,
        targets: {
            type: "permanent" | "graveyard-card";
            id: string;
            playerId?: string;
        }[] = []
    ): void {
        const tamiyo = state.players[0].battlefield.find(
            (c) => c.id === "tamiyo"
        )!;
        payLoyaltyCost(tamiyo, backFaceAbility(state, abilityId));
        state.stack.push({
            ...tamiyo,
            zone: "stack",
            castById: "p1",
            abilityId,
            targets,
        });
        resolveTopOfStack(state);
    }

    describe("+2 — attacker-debuff window (CR 606 / 603.7a / 508.1b)", () => {
        it("schedules a REAL delayed triggered ability; the next attacking creature gets -1/-0 until end of turn", () => {
            const { state } = flippedBoard();
            activate(state, "tamiyo-seasoned-scholar-plus2");
            const tamiyo = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            expect(tamiyo.counters?.loyalty).toBe(4); // 2 + 2
            // Review round 2 (PR #2487) — a real CR 603.7a delayed trigger,
            // not the old direct-application flag.
            expect(state.delayedTriggers).toHaveLength(1);
            expect(state.delayedTriggers?.[0]).toMatchObject({
                timing: "until-next-turn-creature-attacks-you",
                controller: "p1",
            });

            const bear = makeInstance(grizzlyBears.id, {
                id: "attacker-bear",
                controllerId: "p2",
                ownerId: "p2",
            });
            state.players[1].battlefield.push(bear);

            declareAttackers(state, "p2", ["attacker-bear"]);
            // Firing only QUEUES the triggered ability (CR 603.3) — drain it.
            resolveTopOfStack(state);
            // 2/2 Grizzly Bears -1/-0 reads as 1/2 (layer 7c).
            expect(getEffectivePower(state, bear)).toBe(1);
            expect(getEffectiveToughness(state, bear)).toBe(2);

            // Wire format — the debuffed power is board-visible.
            const projected = projectPublicState(state, 1, "p2");
            const slimBear = projected.players[1].battlefield.find(
                (c) => c.id === "attacker-bear"
            )!;
            expect(getEffectivePower(projected, slimBear)).toBe(1);
        });

        it("does NOT debuff an attacker declared before the window opened", () => {
            const { state } = flippedBoard();
            const bear = makeInstance(grizzlyBears.id, {
                id: "early-bear",
                controllerId: "p2",
                ownerId: "p2",
            });
            state.players[1].battlefield.push(bear);
            // No +2 activated yet.
            declareAttackers(state, "p2", ["early-bear"]);
            expect(state.stack).toHaveLength(0);
            expect(getEffectivePower(state, bear)).toBe(2);
        });

        it('clears at the grantee\'s own next turn ("until your next turn"), NOT the unconditional CLEANUP purge', () => {
            const { state } = flippedBoard();
            activate(state, "tamiyo-seasoned-scholar-plus2");
            expect(
                state.delayedTriggers?.some(
                    (t) => t.timing === "until-next-turn-creature-attacks-you"
                )
            ).toBe(true);

            // p2's whole intervening turn — the window must survive it,
            // including p2's own CLEANUP (the "this-turn-*" repeating
            // timings would be purged there; this one must not be).
            state.activePlayerId = "p1";
            state.phase = "END_STEP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p2");
            expect(
                state.delayedTriggers?.some(
                    (t) => t.timing === "until-next-turn-creature-attacks-you"
                )
            ).toBe(true);

            // p1's OWN next turn begins — the window closes.
            state.activePlayerId = "p2";
            state.phase = "END_STEP";
            advancePhase(state);
            expect(state.activePlayerId).toBe("p1");
            expect(
                state.delayedTriggers?.some(
                    (t) => t.timing === "until-next-turn-creature-attacks-you"
                ) ?? false
            ).toBe(false);
        });
    });

    describe("−3 — return + conditional mana (CR 401, 106.1)", () => {
        it("a GREEN instant/sorcery: returns to hand AND adds one mana of the chosen color", () => {
            const { state } = flippedBoard();
            // Tamiyo's printed starting loyalty is only 2 — she cannot
            // legally pay a -3 cost the turn she flips (CR 606.5/118.5:
            // can't remove more counters than are present). Top loyalty up
            // to a realistic later-turn value first, mirroring the -7
            // test's own convention.
            const tamiyoPreActivate = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            tamiyoPreActivate.counters = {
                ...tamiyoPreActivate.counters,
                loyalty: 4,
            };
            const bolt = makeInstance(giantGrowth.id, {
                id: "gy-giant-growth",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            state.players[0].graveyard.push(bolt);

            activate(state, "tamiyo-seasoned-scholar-minus3", [
                {
                    type: "graveyard-card",
                    id: "gy-giant-growth",
                    playerId: "p1",
                },
            ]);

            const tamiyo = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            expect(tamiyo.counters?.loyalty).toBe(1); // 4 - 3

            // The colour check ran BEFORE the move (still findable in the
            // graveyard) and suspends on a real "choose one of five colours"
            // pick — resolution has not reached `moveZone` yet.
            const choice = state.pendingChoices?.[0];
            expect(choice?.kind).toBe("option-pick");
            expect(state.players[0].hand.map((c) => c.id)).not.toContain(
                "gy-giant-growth"
            );

            applyPendingChoiceSubmit(state, {
                playerId: choice!.playerId,
                stackItemId: choice!.stackItemId,
                step: choice!.step,
                choiceId: choice!.choiceId,
                cardInstanceIds: ["G"],
            });

            expect(state.players[0].manaPool.G).toBe(1);
            expect(state.players[0].hand.map((c) => c.id)).toContain(
                "gy-giant-growth"
            );
            expect(state.players[0].graveyard.map((c) => c.id)).not.toContain(
                "gy-giant-growth"
            );
        });

        it("a NON-green instant/sorcery: returns to hand, NO mana / no color choice", () => {
            const { state } = flippedBoard();
            // See the GREEN test above — top loyalty up to a legally
            // payable amount before activating -3.
            const tamiyoPreActivate = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            tamiyoPreActivate.counters = {
                ...tamiyoPreActivate.counters,
                loyalty: 4,
            };
            const bolt = makeInstance(lightningBolt.id, {
                id: "gy-bolt",
                controllerId: "p1",
                ownerId: "p1",
                zone: "graveyard",
            });
            state.players[0].graveyard.push(bolt);

            activate(state, "tamiyo-seasoned-scholar-minus3", [
                { type: "graveyard-card", id: "gy-bolt", playerId: "p1" },
            ]);

            expect(state.players[0].hand.map((c) => c.id)).toContain("gy-bolt");
            expect(state.players[0].manaPool.G ?? 0).toBe(0);
            expect(state.pendingChoices ?? []).toHaveLength(0);
        });
    });

    describe("−7 — half the library rounded up, plus the no-max-hand-size emblem (CR 121, 114)", () => {
        it("draws ceil(library/2) cards and grants the emblem", () => {
            const { state } = flippedBoard();
            const tamiyo = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            tamiyo.counters = { ...tamiyo.counters, loyalty: 7 };
            // Re-stock the library to an EXACT count right before activating
            // −7, rather than reasoning about how many of `flippedBoard`'s
            // own setup draws (the 3 that triggered the flip) already
            // consumed it — an odd count so rounding direction is provable.
            state.players[0].library = Array.from({ length: 7 }, (_, i) =>
                makeInstance(grizzlyBears.id, {
                    id: `m7lib${i}`,
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "library",
                })
            );
            const before = state.players[0].hand.length;

            activate(state, "tamiyo-seasoned-scholar-minus7");

            const after = state.players[0].battlefield.find(
                (c) => c.id === "tamiyo"
            )!;
            expect(after.counters?.loyalty).toBe(0);
            // ceil(7/2) = 4 cards drawn.
            expect(state.players[0].hand.length - before).toBe(4);
            expect(state.players[0].library).toHaveLength(3);
            expect(
                (state.emblems ?? []).some(
                    (e) =>
                        e.emblemId === TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID &&
                        e.ownerId === "p1"
                )
            ).toBe(true);
        });

        it("the emblem raises the owner's effective max hand size to unlimited", () => {
            const { state } = flippedBoard();
            expect(state.emblems ?? []).toHaveLength(0);
            expect(effectiveMaxHandSize(state.players[0], state)).not.toBe(
                Infinity
            );

            state.emblems = [
                {
                    id: "emblem-1",
                    ownerId: "p1",
                    emblemId: TAMIYO_SEASONED_SCHOLAR_EMBLEM_ID,
                    name: "Tamiyo, Seasoned Scholar emblem",
                    text: "You have no maximum hand size.",
                },
            ];
            expect(effectiveMaxHandSize(state.players[0], state)).toBe(
                Infinity
            );
            // The OTHER player's hand size is unaffected (CR 114.3 "you").
            expect(effectiveMaxHandSize(state.players[1], state)).not.toBe(
                Infinity
            );
        });
    });

    it("only one loyalty ability per turn (CR 606.3)", () => {
        const { state } = flippedBoard();
        const tamiyo = state.players[0].battlefield.find(
            (c) => c.id === "tamiyo"
        )!;
        state.phase = "PRECOMBAT_MAIN";
        state.activePlayerId = "p1";
        state.priorityPlayerId = "p1";
        state.stack = [];

        const plus2 = backFaceAbility(state, "tamiyo-seasoned-scholar-plus2");
        expect(() =>
            assertLoyaltyActivationLegal(state, tamiyo, plus2)
        ).not.toThrow();
        payLoyaltyCost(tamiyo, plus2);
        expect(tamiyo.loyaltyActivatedThisTurn).toBe(true);
        expect(() =>
            assertLoyaltyActivationLegal(state, tamiyo, plus2)
        ).toThrow(/already been activated/);
    });

    it("round-trips the attacker-debuff window's delayed trigger through compactState/expandState", () => {
        const { state } = flippedBoard();
        activate(state, "tamiyo-seasoned-scholar-plus2");
        expect(state.delayedTriggers).toHaveLength(1);
        const restored = expandState(compactState(state));
        expect(restored.delayedTriggers).toEqual(state.delayedTriggers);
    });
});
