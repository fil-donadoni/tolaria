// Planeswalker / loyalty FRAMEWORK tests (issue #700, ADR 0058).
//
// Covers the engine capabilities the two tracer planeswalkers (Liliana of the
// Veil, Garruk Wildspeaker) exercise but which are NOT card-specific:
//   - starting loyalty placed on ETB (CR 306.5b)
//   - damage removes loyalty; burn kills a planeswalker (CR 120.3 / 704.5i),
//     asserted on fat state AND through the wire projection
//   - 0-loyalty → owner's graveyard SBA (CR 704.5i)
//   - `cost.loyalty` activation gates + payment (CR 606.2/606.3/606.5)
//
// The tracer cards' effect scripts themselves reuse only already-exercised Ops,
// so they need no per-card test (per-Op regime, ADR 0045/0046).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { resolveTopOfStack, type GameState } from "../state";
import { checkStateBasedActions, checkZeroLoyaltySBA } from "../sba";
import { assertLoyaltyActivationLegal, payLoyaltyCost } from "../../game";
import {
    DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE,
    loyaltyActivationAllowance,
} from "../loyalty";
import { withTemporaryDefinition } from "../../cards/registry";
import { projectPublicState } from "../../gameProjections";
import { lightningBolt } from "../../cards/sets/lea/red";
import { lilianaOfTheVeil } from "../../cards/sets/isd/black";
import { garrukWildspeaker } from "../../cards/sets/lrw/green";

const LILIANA = lilianaOfTheVeil.id;

describe("starting loyalty on ETB (CR 306.5b)", () => {
    it("places loyalty counters equal to CardDefinition.loyalty as the planeswalker enters", () => {
        const state = makeState();
        pushSpell(state, LILIANA, "p1");
        resolveTopOfStack(state);
        const pw = state.players[0].battlefield.find(
            (c) => (c.card as { id: string }).id === LILIANA
        );
        expect(pw).toBeDefined();
        expect(pw!.counters?.loyalty).toBe(3);
    });
});

describe("damage → loyalty (CR 120.3 / 704.5i)", () => {
    function withPlaneswalker(loyalty: number): {
        state: GameState;
        pwId: string;
    } {
        const pw = makeInstance(LILIANA, {
            id: "pw",
            controllerId: "p2",
            ownerId: "p2",
            counters: { loyalty },
        });
        const state = makeState({
            players: [
                makePlayer("p1"),
                makePlayer("p2", { battlefield: [pw] }),
            ],
        });
        return { state, pwId: "pw" };
    }

    it("removes loyalty counters instead of marking damage (5 loyalty − 3 = 2)", () => {
        const { state } = withPlaneswalker(5);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "pw" },
        ]);
        resolveTopOfStack(state);
        const pw = state.players[1].battlefield.find((c) => c.id === "pw");
        expect(pw).toBeDefined();
        expect(pw!.counters?.loyalty).toBe(2);
        // Damage is not "marked" on a planeswalker.
        expect(pw!.damageMarked ?? 0).toBe(0);
    });

    it("burn to lethal loyalty kills the planeswalker (3 loyalty − 3 → 0 → graveyard SBA)", () => {
        const { state } = withPlaneswalker(3);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "pw" },
        ]);
        resolveTopOfStack(state);
        checkStateBasedActions(state);
        expect(
            state.players[1].battlefield.find((c) => c.id === "pw")
        ).toBeUndefined();
        expect(state.players[1].graveyard.some((c) => c.id === "pw")).toBe(
            true
        );
    });

    it("survives the wire projection: loyalty value is correct client-side after damage", () => {
        const { state } = withPlaneswalker(5);
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "permanent", id: "pw" },
        ]);
        resolveTopOfStack(state);
        // Fat-state assertion.
        const fat = state.players[1].battlefield.find((c) => c.id === "pw")!;
        expect(fat.counters?.loyalty).toBe(2);
        // Same assertion survives projectPublicState (loyalty rides `counters`).
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "pw"
        )!;
        expect(
            (slim as { counters?: Record<string, number> }).counters?.loyalty
        ).toBe(2);
    });
});

describe("0-loyalty SBA (CR 704.5i)", () => {
    it("puts a planeswalker with 0 loyalty into its owner's graveyard", () => {
        const pw = makeInstance(LILIANA, {
            id: "pw",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 0 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pw] }),
                makePlayer("p2"),
            ],
        });
        expect(checkZeroLoyaltySBA(state)).toBe(true);
        expect(state.players[0].battlefield).toHaveLength(0);
        expect(state.players[0].graveyard.some((c) => c.id === "pw")).toBe(
            true
        );
    });

    it("leaves a planeswalker with positive loyalty on the battlefield", () => {
        const pw = makeInstance(LILIANA, {
            id: "pw",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 1 },
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pw] }),
                makePlayer("p2"),
            ],
        });
        expect(checkZeroLoyaltySBA(state)).toBe(false);
        expect(state.players[0].battlefield).toHaveLength(1);
    });
});

describe("loyalty-ability cost payment (CR 606.2/606.5)", () => {
    it("+N adds loyalty counters and spends one of the turn's activations", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: { loyalty: 1 } });
        expect(pw.counters?.loyalty).toBe(4);
        expect(pw.loyaltyActivationsThisTurn).toBe(1);
    });

    it("−N removes loyalty counters (floored at 0)", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: { loyalty: -2 } });
        expect(pw.counters?.loyalty).toBe(1);
        expect(pw.loyaltyActivationsThisTurn).toBe(1);
    });

    it("is a no-op for a non-loyalty ability", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: {} });
        expect(pw.counters?.loyalty).toBe(3);
        expect(pw.loyaltyActivationsThisTurn).toBeUndefined();
    });
});

describe("loyalty-ability activation gates (CR 606.3/606.5)", () => {
    function stateWithPw(
        overrides: Partial<import("../state").CardInstanceState> = {}
    ): { state: GameState; pw: import("../state").CardInstanceState } {
        const pw = makeInstance(LILIANA, {
            id: "pw",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 3 },
            ...overrides,
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pw] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            stack: [],
        });
        return { state, pw };
    }

    it("allows a loyalty ability at sorcery timing on the controller's turn", () => {
        const { state, pw } = stateWithPw();
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: 1 } })
        ).not.toThrow();
    });

    it("blocks a second loyalty ability of the same permanent this turn (CR 606.3)", () => {
        const { state, pw } = stateWithPw({ loyaltyActivationsThisTurn: 1 });
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: 1 } })
        ).toThrow(/already been activated/);
    });

    it("blocks a −N cost that would take loyalty below 0 (CR 606.5)", () => {
        const { state, pw } = stateWithPw({ counters: { loyalty: 1 } });
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: -2 } })
        ).toThrow(/Not enough loyalty/);
    });

    it("blocks activation off the controller's turn (sorcery-speed, CR 606.3)", () => {
        const { state, pw } = stateWithPw();
        state.activePlayerId = "p2";
        state.priorityPlayerId = "p2";
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: 1 } })
        ).toThrow(/sorcery speed/);
    });

    it("blocks activation with a non-empty stack (not sorcery timing)", () => {
        const { state, pw } = stateWithPw();
        pushSpell(state, lightningBolt.id, "p1", [
            { type: "player", id: "p2" },
        ]);
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: 1 } })
        ).toThrow(/sorcery speed/);
    });

    it("is a no-op for a non-loyalty ability (undefined cost.loyalty)", () => {
        const { state, pw } = stateWithPw({ loyaltyActivationsThisTurn: 1 });
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: {} })
        ).not.toThrow();
    });
});

// CR 606.3 is an ALLOWANCE, not a lock (issue #3339). The rule reads "only if
// no player has previously activated a loyalty ability of that permanent that
// turn" — a count of ONE, which a permanent's own static text may raise ("You
// may activate the loyalty abilities of Urza twice each turn rather than only
// once"). The grant is a `loyalty-activation-allowance` static effect read off
// the permanent's own effective static effects, never a per-card branch, so the
// variant below is exactly what a future card carrying the clause declares.
//
// No shipped card declares one yet (Urza, Planeswalker is meld — PRD #3227
// slice 3), so the variant is built with `withTemporaryDefinition`: the
// catalogue is frozen and a test may not mutate a definition in place.
describe("loyalty-activation allowance (CR 606.3, issue #3339)", () => {
    /** Liliana with `extra` additional loyalty activations per turn. Shallow
     *  spread of the frozen original, per `withTemporaryDefinition`'s contract. */
    function lilianaWithExtraActivations(extra: number) {
        return {
            ...lilianaOfTheVeil,
            staticEffects: [
                ...(lilianaOfTheVeil.staticEffects ?? []),
                { kind: "loyalty-activation-allowance" as const, extra },
            ],
        };
    }

    function stateWithPw(used: number): {
        state: GameState;
        pw: import("../state").CardInstanceState;
    } {
        const pw = makeInstance(LILIANA, {
            id: "pw",
            controllerId: "p1",
            ownerId: "p1",
            counters: { loyalty: 3 },
            ...(used > 0 ? { loyaltyActivationsThisTurn: used } : {}),
        });
        const state = makeState({
            players: [
                makePlayer("p1", { battlefield: [pw] }),
                makePlayer("p2"),
            ],
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            stack: [],
        });
        return { state, pw };
    }

    it("defaults to exactly one activation for a permanent declaring nothing", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        expect(loyaltyActivationAllowance(pw)).toBe(
            DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE
        );
        expect(DEFAULT_LOYALTY_ACTIVATION_ALLOWANCE).toBe(1);
    });

    it("adds every declared `extra` on top of the default", () => {
        withTemporaryDefinition(lilianaWithExtraActivations(1), () => {
            const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
            expect(loyaltyActivationAllowance(pw)).toBe(2);
        });
    });

    it("permits a SECOND activation the turn a permanent's allowance is two", () => {
        withTemporaryDefinition(lilianaWithExtraActivations(1), () => {
            const { state, pw } = stateWithPw(1);
            expect(() =>
                assertLoyaltyActivationLegal(state, pw, {
                    cost: { loyalty: 1 },
                })
            ).not.toThrow();
        });
    });

    it("refuses the THIRD activation on the same permanent (the allowance is a number, not a waiver)", () => {
        withTemporaryDefinition(lilianaWithExtraActivations(1), () => {
            const { state, pw } = stateWithPw(2);
            expect(() =>
                assertLoyaltyActivationLegal(state, pw, {
                    cost: { loyalty: 1 },
                })
            ).toThrow(/already been activated/);
        });
    });

    it("REGRESSION — every shipped planeswalker still gets exactly one activation", () => {
        // The default half of the pair above: the same position, the same
        // predicate, the PRINTED definition. A grant that leaked into the
        // default (e.g. an allowance computed as `1 + effects.length`) passes
        // the two tests above and fails this one.
        const { state, pw } = stateWithPw(1);
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: { loyalty: 1 } })
        ).toThrow(/already been activated/);
        expect(loyaltyActivationAllowance(pw)).toBe(1);
    });

    it("counts activations ACROSS the permanent's different loyalty abilities (CR 606.3)", () => {
        withTemporaryDefinition(lilianaWithExtraActivations(1), () => {
            const { state, pw } = stateWithPw(0);
            payLoyaltyCost(pw, { cost: { loyalty: 1 } });
            expect(pw.loyaltyActivationsThisTurn).toBe(1);
            // A DIFFERENT ability of the same permanent — CR 606.3 counts per
            // permanent, so the second activation spends the last of the two.
            expect(() =>
                assertLoyaltyActivationLegal(state, pw, {
                    cost: { loyalty: -2 },
                })
            ).not.toThrow();
            payLoyaltyCost(pw, { cost: { loyalty: -2 } });
            expect(pw.loyaltyActivationsThisTurn).toBe(2);
            expect(() =>
                assertLoyaltyActivationLegal(state, pw, {
                    cost: { loyalty: 1 },
                })
            ).toThrow(/already been activated/);
        });
    });

    it("clamps a negative `extra` at the printed allowance (CR 606.3 never grants fewer than one)", () => {
        withTemporaryDefinition(lilianaWithExtraActivations(-5), () => {
            const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
            expect(loyaltyActivationAllowance(pw)).toBe(1);
        });
    });
});

describe("tracer definitions carry loyalty framework fields", () => {
    it("Liliana of the Veil declares starting loyalty and three loyalty abilities", () => {
        expect(lilianaOfTheVeil.loyalty).toBe(3);
        expect(lilianaOfTheVeil.types).toContain("Planeswalker");
        const costs = (lilianaOfTheVeil.activatedAbilities ?? []).map(
            (a) => a.cost.loyalty
        );
        expect(costs).toEqual([1, -2, -6]);
    });

    it("Garruk Wildspeaker declares starting loyalty and three loyalty abilities", () => {
        expect(garrukWildspeaker.loyalty).toBe(3);
        expect(garrukWildspeaker.types).toContain("Planeswalker");
        const costs = (garrukWildspeaker.activatedAbilities ?? []).map(
            (a) => a.cost.loyalty
        );
        expect(costs).toEqual([1, -1, -4]);
    });
});
