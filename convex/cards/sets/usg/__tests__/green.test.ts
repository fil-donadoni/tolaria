// usg green cards (Urza's Saga, split by colour per ADR 0043). Each
// non-trivial card gets a describe block referencing the CR it validates.

import { describe, it, expect } from "vitest";
import { argothianEnchantress } from "../green";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type { CardType } from "../../../types";

describe("Argothian Enchantress (draw on enchantment cast, CR 603.2 / 601.2i / 121.1)", () => {
    const trig = argothianEnchantress.triggeredAbilities?.[0];

    it("ships the shroud keyword (CR 702.18) on the printed definition", () => {
        expect(argothianEnchantress.staticAbilities).toContain("shroud");
    });

    it("trigger is a DSL Effect Script (mandatory draw), not a resolve closure", () => {
        expect(trig).toBeDefined();
        expect(trig!.effects).toEqual([
            { op: "draw", player: "controller", count: 1 },
        ]);
        expect(trig!.resolve).toBeUndefined();
    });

    it("matches enchantment spells you cast, not creatures or opponents' spells", () => {
        const self = {
            id: "aEn",
            controllerId: "p1",
            ownerId: "p1",
            types: ["Creature"] as CardType[],
            subtypes: [],
            isTapped: false,
            card: {},
        };
        const enchantmentEvent = {
            type: "SPELL_CAST" as const,
            casterId: "p1",
            spellInstanceId: "x",
            spellCardId: "y",
            spellTypes: ["Enchantment"] as CardType[],
            spellSubtypes: [],
            spellColors: [],
        };
        expect(trig!.matches(enchantmentEvent, self)).toBe(true);
        // Opponent cast → no fire (scope "you", CR 109.4).
        expect(
            trig!.matches({ ...enchantmentEvent, casterId: "p2" }, self)
        ).toBe(false);
        // Non-enchantment spell → no fire (SpellFilter).
        expect(
            trig!.matches(
                { ...enchantmentEvent, spellTypes: ["Creature"] as CardType[] },
                self
            )
        ).toBe(false);
    });

    it("resolves to a mandatory draw for the controller (end-to-end)", () => {
        const enchantress = makeInstance(argothianEnchantress.id, {
            id: "aEn",
            controllerId: "p1",
            ownerId: "p1",
        });
        const topCard = makeInstance(argothianEnchantress.id, {
            id: "lib1",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [enchantress],
                    library: [topCard],
                }),
                makePlayer("p2"),
            ],
        });
        state.stack.push({
            ...enchantress,
            zone: "stack",
            castById: "p1",
            triggeredAbilityId: "argothian-enchantress-draw",
            triggerSourceId: "aEn",
            triggerEvent: {
                type: "SPELL_CAST",
                casterId: "p1",
                spellInstanceId: "s",
                spellCardId: "c",
                spellTypes: ["Enchantment"] as CardType[],
                spellSubtypes: [],
                spellColors: [],
            },
            targets: [],
        });
        resolveTopOfStack(state);
        expect(state.players[0].hand.map((c) => c.id)).toEqual(["lib1"]);
        expect(state.players[0].library).toHaveLength(0);
    });
});
