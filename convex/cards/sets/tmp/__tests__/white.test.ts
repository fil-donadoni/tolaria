// Per-card behavior tests for white cards in `convex/cards/sets/tmp/white.ts`
// (Tempest, split by colour per ADR 0043).
//
// Humility is the first card to declare the `pt-set` static-effect kind
// (issue #3161) — a CR 613.4b sublayer-7b base-P/T SET, the sibling neither
// `pt-buff` (7c, adds) nor `pt-cda` (7a, characteristic-defining) could stand
// in for. Its other half is the layer-6 `ability-loss` Titania's Song already
// exercises, so what is new here is the P/T half and the sublayer ORDER
// around it.

import { describe, it, expect } from "vitest";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { projectPublicState } from "../../../../gameProjections";
import {
    type CardInstanceState,
    type GameState,
    beginApplyingStaticEffects,
} from "../../../../gre/state";
import {
    type LayerStateView,
    getEffectivePower,
    getEffectiveToughness,
} from "../../../../gre/layers";
import { humility } from "../white";
import { airElemental } from "../../lea/blue";
import { grizzlyBears } from "../../lea/green";
import { crusade } from "../../lea/white";

/** Humility on the battlefield beside `others`, its statics applied. */
function withHumility(others: CardInstanceState[]): {
    state: GameState;
    humilityInstance: CardInstanceState;
} {
    const humilityInstance = makeInstance(humility.id, {
        id: "humility-1",
        controllerId: "p1",
        zone: "battlefield",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [humilityInstance] }),
            makePlayer("p2", { battlefield: others }),
        ],
    });
    beginApplyingStaticEffects(state, humilityInstance);
    return { state, humilityInstance };
}

function bearsOnBoard(overrides: Partial<CardInstanceState> = {}) {
    return makeInstance(grizzlyBears.id, {
        id: "bears-1",
        controllerId: "p2",
        zone: "battlefield",
        ...overrides,
    });
}

describe("Humility ({2}{W}{W} Enchantment — CR 613.1f ability-loss + CR 613.4b base-P/T set)", () => {
    it("sets a creature's base P/T to 1/1, whatever it printed", () => {
        const elemental = makeInstance(airElemental.id, {
            id: "elemental-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const { state } = withHumility([elemental]);

        // Air Elemental prints 4/4.
        expect(getEffectivePower(state, elemental)).toBe(1);
        expect(getEffectiveToughness(state, elemental)).toBe(1);
    });

    it("strips every creature's abilities (CR 613.1f layer 6)", () => {
        const elemental = makeInstance(airElemental.id, {
            id: "elemental-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const { state } = withHumility([elemental]);

        expect(elemental.staticAbilities).not.toContain("flying");
        expect(elemental.abilitiesSuppressedBy).toEqual([
            { sourceId: "humility-1", seq: expect.any(Number) },
        ]);
        // The P/T half is a SEPARATE effect on the same source, so the strip
        // does not take it with it.
        expect(getEffectivePower(state, elemental)).toBe(1);
    });

    it("leaves a +1/+1 counter applying ON TOP of the set (CR 613.4c after 613.4b)", () => {
        // The whole reason the clause needs sublayer 7b: a 7a `pt-cda` or a 7c
        // `pt-buff` standing in for it would compose with the counter in the
        // wrong order or the wrong direction.
        const bears = bearsOnBoard({ counters: { "+1/+1": 1 } });
        const { state } = withHumility([bears]);

        expect(getEffectivePower(state, bears)).toBe(2);
        expect(getEffectiveToughness(state, bears)).toBe(2);
    });

    it("leaves an anthem applying on top of the set too (CR 613.4c)", () => {
        // Crusade is a `pt-buff` — sublayer 7c, so it lands after 7b however
        // the two sources' timestamps compare. A white bear under Humility is
        // 1/1 + 1/+1 = 2/2, never 3/3 (base 2/2 + anthem) and never 1/1.
        const whiteBear = bearsOnBoard();
        whiteBear.card = { ...whiteBear.card, manaCost: { W: 1 } };
        const anthem = makeInstance(crusade.id, {
            id: "crusade-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const { state } = withHumility([whiteBear, anthem]);

        expect(getEffectivePower(state, whiteBear)).toBe(2);
        expect(getEffectiveToughness(state, whiteBear)).toBe(2);
    });

    it("does not resize itself — it is an Enchantment, not a creature (CR 208.2)", () => {
        const { state, humilityInstance } = withHumility([]);

        expect(humilityInstance.types).not.toContain("Creature");
        expect(humilityInstance.abilitiesSuppressedBy).toBeUndefined();
        // A noncreature's read short-circuits to its printed (absent) P/T.
        expect(getEffectivePower(state, humilityInstance)).toBe(0);
    });

    it("resizes a creature that ENTERS after it (applyExistingGrantsTo, and the walk needs no apply at all)", () => {
        const { state } = withHumility([]);
        const latecomer = makeInstance(airElemental.id, {
            id: "elemental-2",
            controllerId: "p2",
            zone: "battlefield",
        });
        state.players[1].battlefield.push(latecomer);

        // No second `beginApplyingStaticEffects` call: layer 7 is DERIVED at
        // every read from the live board, so the set applies the instant the
        // creature is there.
        expect(getEffectivePower(state, latecomer)).toBe(1);
        expect(getEffectiveToughness(state, latecomer)).toBe(1);
    });

    it("stops applying when Humility leaves the battlefield (CR 611.2)", () => {
        const elemental = makeInstance(airElemental.id, {
            id: "elemental-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const { state } = withHumility([elemental]);
        expect(getEffectivePower(state, elemental)).toBe(1);

        state.players[0].battlefield = [];

        expect(getEffectivePower(state, elemental)).toBe(4);
        expect(getEffectiveToughness(state, elemental)).toBe(4);
    });

    // Wire format (MANDATORY for staticEffects, per gre-development.md § Card
    // testing convention): the client never receives a card DEFINITION's
    // closures — it re-derives layer 7 from the projected board through the
    // same walk (`src/lib/effective-stats.ts` → `getEffectivePower`). A
    // GRE-only assertion passes while the board renders 4/4.
    it("wire format: the 1/1 survives projectPublicState", () => {
        const elemental = makeInstance(airElemental.id, {
            id: "elemental-1",
            controllerId: "p2",
            zone: "battlefield",
        });
        const { state } = withHumility([elemental]);

        const projected = projectPublicState(state, 1, "p2");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "elemental-1"
        )!;
        const wireState = projected as unknown as LayerStateView;

        expect(getEffectivePower(wireState, slim as CardInstanceState)).toBe(1);
        expect(
            getEffectiveToughness(wireState, slim as CardInstanceState)
        ).toBe(1);
        expect(slim.staticAbilities).not.toContain("flying");
    });
});
