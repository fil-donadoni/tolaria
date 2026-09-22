// "Choose a color." + "<mass subject> gain protection from the chosen
// color until <duration>." — the activated-ability effect clause pairing
// (CR 105.1/613.1f, issue #4307). Grammar Gap `activated › effect clause
// › Choose a color`.
//
// Two layers:
//  1. GOLDEN — the whole activated-ability line, real corpus wording
//     (Glory), compiled through the activated slot and lowered, must produce
//     exactly one `optionChoice` Op with five colour modes, each a `forEach`
//     sweep granting `protection from <colour>` (CR 702.16a).
//  2. REFUSALS — the neighbours this rule does not read: "that color" (no
//     fixture), a single-object subject, and "Choose a color." with no
//     antecedent-reading sentence after it (fail-closed, ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import type { EffectOp } from "../../cards/types";
import { activatedSlot } from "../grammar/slots/activated";
import { lowerActivatedAbility } from "../lowerActivated";
import { parseContext } from "./fixtures";

/** The activated slot alone, through lowering — mirrors `kickersOf` in
 *  `kickerLine.test.ts`, one layer below a whole-card compile so the test
 *  is not gated on Glory's OTHER (unrelated) ability parsing too. */
function activatedEffects(line: string): EffectOp[] {
    const parsed = activatedSlot.run(line, parseContext());
    if (!parsed.ok) throw new Error(`${line}: ${parsed.reason}`);
    if (parsed.value.kind !== "activated")
        throw new Error(`${line}: not an activated ability`);
    const lowered = lowerActivatedAbility({
        id: "test",
        oracleText: line,
        cardName: "Test Card",
        cost: parsed.value.cost,
        effects: parsed.value.effects,
        restrictions: parsed.value.restrictions,
    });
    if (!lowered.ok) throw new Error(`${line}: ${lowered.reason}`);
    return lowered.ability.effects;
}

const GLORY_ABILITY =
    "{2}{W}: Choose a color. Creatures you control gain protection from the chosen color until end of turn. Activate only if this card is in your graveyard.";

describe("Choose a color. → protection grant (CR 105.1, 613.1f)", () => {
    it("Glory: one optionChoice, five colour modes, each a forEach protection grant", () => {
        const effects = activatedEffects(GLORY_ABILITY);
        expect(effects).toEqual([
            {
                op: "optionChoice",
                prompt: "Choose a color (Test Card).",
                modes: ["W", "U", "B", "R", "G"].map((color, i) => ({
                    id: color,
                    label: ["White", "Blue", "Black", "Red", "Green"][i],
                    color,
                    effects: [
                        {
                            op: "forEach",
                            select: {
                                set: "permanents",
                                zone: "battlefield",
                                controller: "controller",
                                filter: { type: "Creature" },
                            },
                            effects: [
                                {
                                    op: "grantAbility",
                                    target: { ref: "$each" },
                                    ability: `protection from ${
                                        [
                                            "white",
                                            "blue",
                                            "black",
                                            "red",
                                            "green",
                                        ][i]
                                    }`,
                                    duration: { phase: "end-of-turn" },
                                },
                            ],
                        },
                    ],
                })),
            },
        ] satisfies EffectOp[]);
    });

    it("Activate only if this card is in your graveyard (CR 113.6/602.5b)", () => {
        const parsed = activatedSlot.run(GLORY_ABILITY, parseContext());
        if (!parsed.ok) throw new Error(parsed.reason);
        if (parsed.value.kind !== "activated") throw new Error("not activated");
        const lowered = lowerActivatedAbility({
            id: "test",
            oracleText: GLORY_ABILITY,
            cardName: "Test Card",
            cost: parsed.value.cost,
            effects: parsed.value.effects,
            restrictions: parsed.value.restrictions,
        });
        if (!lowered.ok) throw new Error(lowered.reason);
        expect(lowered.ability.activateFromGraveyard).toBe(true);
    });
});

describe("refused neighbours (ADR 0105 § 2, fail-closed)", () => {
    it('"that color" has no fixture — only "the chosen color" is read', () => {
        const line =
            "{1}{B}: Choose a color. Creatures you control gain protection from that color until end of turn.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });

    it("a single-object subject is not evidenced (no corpus card grants to one object)", () => {
        const line =
            "{1}{W}: Choose a color. Target creature gains protection from the chosen color until end of turn.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });

    it('"Choose a color." with no reader after it has no antecedent to feed', () => {
        const line = "{1}{W}: Choose a color. Draw a card.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });

    it('"Choose a color." as the last sentence reads no effect', () => {
        const line = "{1}{W}: Draw a card. Choose a color.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });

    // CR 608.2c — the ", then" chain (`thenChain.ts`) reads its tail with the
    // SAME sentence grammar, so without an explicit refusal there it becomes a
    // second, unguarded way into the grant: `assembleSentences` folds the
    // "Choose a color." marker onto the sentence that FOLLOWS it and never
    // looks inside a flattened chain, so this line would be accepted with no
    // marker on it at all.
    it("a chain's tail cannot read the chosen color — there is no marker to fold", () => {
        const line =
            "{1}{W}: Create a 1/1 white Soldier creature token, then creatures you control gain protection from the chosen color until end of turn.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });

    it("the same chain is still refused when the marker IS printed first", () => {
        const line =
            "{1}{W}: Choose a color. Create a 1/1 white Soldier creature token, then creatures you control gain protection from the chosen color until end of turn.";
        const parsed = activatedSlot.run(line, parseContext());
        expect(parsed.ok).toBe(false);
    });
});
