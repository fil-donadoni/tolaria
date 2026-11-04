// The exile-and-return-transformed Verb Frame (CR 712.14a, issue #7374).
//
//  1. GOLDEN — Conqueror's Galleon, the delayed "under your control" form,
//     compiled whole from its `GOLDEN_FIXTURES` row (the smoke generator cannot
//     stage a back face or a captured source, so the row is what clears it).
//  2. FORMS — one real printed line per accepted argument class, read at the
//     activated and triggered sites.
//  3. REFUSALS — the neighbours stay `unparsed`, and a plain flicker stays the
//     `exile` + `moveZone` pair.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompileOutcome } from "../types";
import { oracleCard } from "./oracle.fixture";

const GALLEON = GOLDEN_FIXTURES.find(
    (f) => f.rule === "exile-return-transformed"
)!;

function compile(
    name: string,
    oracleText: string,
    typeLine = "Creature — Elf"
) {
    return compileCard(oracleCard({ name, oracleText, typeLine }));
}

function activatedEffects(outcome: CompileOutcome) {
    if (outcome.state === "unparsed") throw new Error("does not parse");
    return outcome.definition.activatedAbilities?.[0]?.effects;
}

function triggeredEffects(outcome: CompileOutcome) {
    if (outcome.state === "unparsed") throw new Error("does not parse");
    return outcome.definition.compiledTriggeredAbilities?.[0]?.effects;
}

/** CR 201.5c — only a legendary card's short name reads as itself. */
const LEGENDARY = "Legendary Creature — Human";

const ON_SOURCE = {
    op: "exileAndReturnTransformed",
    target: { ref: "$source" },
};

describe("exile-return-transformed frame — golden (CR 712.14a)", () => {
    it('Conqueror\'s Galleon: the delayed form sets `controller` from "under your control" (CR 603.7a)', () => {
        const outcome = compileCard(GALLEON.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(GALLEON.expected)
        );
        expect(triggeredEffects(outcome)).toEqual([
            {
                op: "delayedTrigger",
                timing: "next-end-of-combat",
                oracleText:
                    "Exile it at end of combat, then return it to the battlefield transformed under your control.",
                capture: { $self: { ref: "$source" } },
                effects: [
                    {
                        op: "exileAndReturnTransformed",
                        target: { ref: "$self" },
                        controller: "controller",
                    },
                ],
            },
        ]);
        expect(outcome.opsUsed).toContain("exileAndReturnTransformed");
    });
});

describe("exile-return-transformed frame — forms (CR 712.14a)", () => {
    it('Nicol Bolas: an activated {self}, "him" and "his owner\'s" omit `controller`', () => {
        const outcome = compile(
            "Nicol Bolas, the Ravager",
            "{4}{U}{B}{R}: Exile Nicol Bolas, then return him to the battlefield transformed under his owner's control. Activate only as a sorcery.",
            LEGENDARY
        );
        expect(activatedEffects(outcome)).toEqual([ON_SOURCE]);
    });

    it('Huatli: "her" and "her owner\'s"', () => {
        const outcome = compile(
            "Huatli, Poet of Unity",
            "{3}{R/W}{R/W}: Exile Huatli, then return her to the battlefield transformed under her owner's control. Activate only as a sorcery.",
            LEGENDARY
        );
        expect(activatedEffects(outcome)).toEqual([ON_SOURCE]);
    });

    it('Crystal Fragments: the this-noun subject, "it" and "its owner\'s"', () => {
        const outcome = compile(
            "Crystal Fragments",
            "{5}{W}{W}: Exile this Equipment, then return it to the battlefield transformed under its owner's control. Activate only as a sorcery.",
            "Artifact — Equipment"
        );
        expect(activatedEffects(outcome)).toEqual([ON_SOURCE]);
    });

    it('Jecht: a trigger\'s "it" is the source its head names (CR 608.2c)', () => {
        const outcome = compile(
            "Jecht, Reluctant Guardian",
            "Whenever Jecht deals combat damage to a player, you may exile it, then return it to the battlefield transformed under its owner's control.",
            LEGENDARY
        );
        expect(JSON.stringify(triggeredEffects(outcome))).toContain(
            JSON.stringify(ON_SOURCE)
        );
    });

    it('reads "When <self> attacks" as the same head as "Whenever" (CR 603.1)', () => {
        const when = compile("Foo", "When this creature attacks, draw a card.");
        const whenever = compile(
            "Foo",
            "Whenever this creature attacks, draw a card."
        );
        if (when.state === "unparsed" || whenever.state === "unparsed")
            throw new Error("does not parse");
        expect(when.definition.compiledTriggeredAbilities?.[0]?.head).toEqual(
            whenever.definition.compiledTriggeredAbilities?.[0]?.head
        );
    });
});

describe("exile-return-transformed frame — refusals", () => {
    it.each([
        [
            "a non-self target",
            "{4}: Exile target creature, then return it to the battlefield transformed under its owner's control.",
        ],
        [
            "a pronoun naming the head's other creature",
            "Whenever a creature you control attacks, exile it, then return it to the battlefield transformed under its owner's control.",
        ],
        [
            "a pronoun at a site that names no object",
            "{4}: Exile it, then return it to the battlefield transformed under its owner's control.",
        ],
        [
            "a control wording the frame has no reading of",
            "{4}: Exile {self}, then return it to the battlefield transformed under target opponent's control.",
        ],
        [
            "a possessive disagreeing with the returned pronoun",
            "{4}: Exile {self}, then return it to the battlefield transformed under his owner's control.",
        ],
        [
            "no control wording at all",
            "{4}: Exile {self}, then return it to the battlefield transformed.",
        ],
        [
            'the two-sentence "If you do" form',
            "{4}: You may exile {self}. If you do, return it to the battlefield transformed under its owner's control.",
        ],
    ])("%s stays unparsed", (_form, text) => {
        expect(compile("Foo", text).state).toBe("unparsed");
    });

    it("a spell's own text has no permanent to return transformed", () => {
        expect(
            compile(
                "Foo",
                "Exile this card, then return it to the battlefield transformed under its owner's control.",
                "Instant"
            ).state
        ).toBe("unparsed");
    });

    it("a plain flicker stays the `exile` + `moveZone` pair", () => {
        const outcome = compile(
            "Flicker of Fate",
            "Exile target creature or enchantment, then return it to the battlefield under its owner's control.",
            "Instant"
        );
        if (outcome.state === "unparsed") throw new Error("does not parse");
        expect(outcome.opsUsed).not.toContain("exileAndReturnTransformed");
        expect(outcome.definition.effects).toEqual([
            { op: "exile", target: { target: 0 }, bind: "$that1" },
            {
                op: "moveZone",
                target: { ref: "$that1" },
                from: "exile",
                to: "battlefield",
            },
        ]);
    });
});
