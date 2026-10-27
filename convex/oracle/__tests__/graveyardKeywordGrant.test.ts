// Keyword grant from the graveyard (CR 113.6b + CR 611.3a, issue #7167):
//
//   "As long as this card is in your graveyard and you control a Mountain,
//    creatures you control have haste."
//
//  1. GOLDEN — Anger compiled whole.
//  2. REFUSALS — neighbours stay unparsed (fail-closed).
//  3. BEHAVIOUR — the rebuilt effect carries the graveyard zone scope.

import { describe, expect, it } from "vitest";
import { resolveCompiledStatic } from "../../cards/compiledStatics";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const LINE =
    "As long as this card is in your graveyard and you control a Mountain, creatures you control have haste.";

const ANGER = oracleCard({
    oracleId: "8c0fc2d4-a2cf-4a3c-8b3c-0d6b0e0f3a11",
    name: "Anger",
    manaCost: "{3}{R}",
    typeLine: "Creature — Incarnation",
    oracleText: `Haste\n${LINE}`,
    power: "2",
    toughness: "2",
});

describe("graveyard keyword grant — golden (CR 113.6b)", () => {
    it("Anger: a conditional keyword grant functioning from the graveyard", () => {
        const outcome = compileCard(ANGER);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        expect(outcome.definition.staticAbilities).toEqual(["haste"]);
        expect(outcome.definition.compiledStaticEffects).toEqual([
            {
                kind: "keyword-grant",
                filter: { types: ["Creature"], controllerRelation: "you" },
                keyword: "haste",
                zone: "graveyard",
                condition: {
                    kind: "controls",
                    filter: { subtypes: ["Mountain"] },
                    atLeast: 1,
                },
            },
        ]);
    });

    it("rebuilds into a graveyard-scoped keyword-grant", () => {
        const outcome = compileCard(ANGER);
        if (outcome.state !== "ready") throw new Error("not ready");
        const effect = resolveCompiledStatic(
            outcome.definition.compiledStaticEffects![0]!
        );
        expect(effect.kind).toBe("keyword-grant");
        expect((effect as { zone?: string }).zone).toBe("graveyard");
        expect(typeof (effect as { condition?: unknown }).condition).toBe(
            "function"
        );
    });
});

describe("graveyard keyword grant — refusals", () => {
    const unparsed = (text: string) =>
        compileCard(oracleCard({ ...ANGER, oracleText: text })).state;

    it.each([
        ["another zone", LINE.replace("graveyard", "hand")],
        [
            "a condition other than controls",
            LINE.replace("you control a Mountain", "you have 20 life"),
        ],
        [
            "a non-keyword grant",
            LINE.replace("have haste", "have hexproof ward"),
        ],
        ["a different source", LINE.replace("this card", "target creature")],
        ["trailing text", `${LINE.slice(0, -1)} and draw a card.`],
    ])("%s → unparsed", (_label, text) => {
        expect(unparsed(`Haste\n${text}`)).toBe("unparsed");
    });
});
