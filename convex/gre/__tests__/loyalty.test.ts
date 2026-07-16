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
    it("+N adds loyalty counters and sets the once-per-turn lock", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: { loyalty: 1 } });
        expect(pw.counters?.loyalty).toBe(4);
        expect(pw.loyaltyActivatedThisTurn).toBe(true);
    });

    it("−N removes loyalty counters (floored at 0)", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: { loyalty: -2 } });
        expect(pw.counters?.loyalty).toBe(1);
        expect(pw.loyaltyActivatedThisTurn).toBe(true);
    });

    it("is a no-op for a non-loyalty ability", () => {
        const pw = makeInstance(LILIANA, { counters: { loyalty: 3 } });
        payLoyaltyCost(pw, { cost: {} });
        expect(pw.counters?.loyalty).toBe(3);
        expect(pw.loyaltyActivatedThisTurn).toBeUndefined();
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
        const { state, pw } = stateWithPw({ loyaltyActivatedThisTurn: true });
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
        const { state, pw } = stateWithPw({ loyaltyActivatedThisTurn: true });
        expect(() =>
            assertLoyaltyActivationLegal(state, pw, { cost: {} })
        ).not.toThrow();
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
