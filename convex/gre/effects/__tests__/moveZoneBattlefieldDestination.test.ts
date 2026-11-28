// Issue #10978 — `moveZone`'s announced-target executor takes a battlefield
// permanent only to hand or library (`interpreter.ts`, the `target.type ===
// "permanent"` branch); exile and the graveyard are their own LTB-aware Ops
// (CR 701.13a exile). A `moveZone { target: { target: n }, to: "exile" }` on
// a battlefield slot was a silent no-op: The Wandering Emperor's −2 gained
// its 2 life and exiled nothing. The validator now refuses the shape at
// authoring time, per announced group (CR 601.2c).

import { describe, it, expect } from "vitest";
import type { EffectOp, TargetRequirement } from "../../../cards/types";
import {
    validateAbilityEffectScript,
    validateEffectScript,
    type EffectScriptHost,
} from "../validate";

const host = (overrides: Partial<EffectScriptHost>): EffectScriptHost => ({
    id: "test-host",
    name: "Test Host",
    ...overrides,
});

const creature: TargetRequirement = { type: "Creature", count: 1 };
const graveyardCard: TargetRequirement = {
    type: "card",
    count: 1,
    zone: "graveyard",
    controller: "any",
};
const toExile = (slot: number): EffectOp[] => [
    { op: "moveZone", target: { target: slot }, to: "exile" },
];
const SKIPPED = /skipped by the executor/;

describe("moveZone on a battlefield target — only hand / library (CR 701.13a, issue #10978)", () => {
    it("refuses an ability that exiles a battlefield slot through moveZone", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "minus2",
                targetRequirement: creature,
                effects: [
                    ...toExile(0),
                    { op: "gainLife", player: "controller", amount: 2 },
                ],
            },
            "Test Card"
        );
        expect(errors.some((e) => SKIPPED.test(e))).toBe(true);
    });

    it("refuses the same shape at the spell site, and into the graveyard", () => {
        const errors = validateEffectScript(
            host({
                targetRequirement: creature,
                effects: [
                    { op: "moveZone", target: { target: 0 }, to: "graveyard" },
                ],
            })
        );
        expect(errors.some((e) => SKIPPED.test(e))).toBe(true);
    });

    it("accepts the exile Op on the same slot", () => {
        const errors = validateAbilityEffectScript(
            {
                id: "minus2",
                targetRequirement: creature,
                effects: [{ op: "exile", target: { target: 0 } }],
            },
            "Test Card"
        );
        expect(errors.filter((e) => SKIPPED.test(e))).toEqual([]);
    });

    it("accepts the bounce to hand and a graveyard-card target sent to exile", () => {
        const bounce = validateAbilityEffectScript(
            {
                id: "bounce",
                targetRequirement: creature,
                effects: [
                    { op: "moveZone", target: { target: 0 }, to: "hand" },
                ],
            },
            "Test Card"
        );
        const graveHate = validateAbilityEffectScript(
            {
                id: "grave-hate",
                targetRequirement: graveyardCard,
                effects: toExile(0),
            },
            "Test Card"
        );
        expect(
            [...bounce, ...graveHate].filter((e) => SKIPPED.test(e))
        ).toEqual([]);
    });

    it("maps a slot onto its own announced group (CR 601.2c)", () => {
        // Slot 1 is the graveyard group's pick: legal. Slot 0 is the
        // creature's: refused.
        const groups = {
            targetRequirement: creature,
            additionalTargetRequirements: [graveyardCard],
        };
        const second = validateAbilityEffectScript(
            { id: "second", ...groups, effects: toExile(1) },
            "Test Card"
        );
        const first = validateAbilityEffectScript(
            { id: "first", ...groups, effects: toExile(0) },
            "Test Card"
        );
        expect(second.filter((e) => SKIPPED.test(e))).toEqual([]);
        expect(first.some((e) => SKIPPED.test(e))).toBe(true);
    });
});
