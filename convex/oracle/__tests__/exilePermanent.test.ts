// "Exile target attacking creature" — exiling an announced PERMANENT from the
// battlefield (CR 701.13a), lowered to the `exile` Op (issue #4311).
//
// Two layers:
//
//  1. GOLDENS — the three shapes the corpus prints: the bare spell (Not on My
//     Watch), the spell with a second sentence after it (Second Thoughts), and
//     one mode of a modal spell (Treva's Charm). Whole cards, whole Compiled
//     Definitions.
//  2. REFUSALS — the neighbours the rule must NOT read: a sweep ("Exile all
//     attacking creatures", CR 701.13a has no announced target), and the two
//     real cards whose OTHER lines are separate Grammar Gaps (Resounding
//     Silence's cycling, Nemesis Trap's copy token) — each stays unparsed
//     under its own span, never the exile sentence.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./fixtures";

const NOT_ON_MY_WATCH: OracleCard = {
    oracleId: "2d400c01-d2d0-442a-bc3d-cf106a754dab",
    name: "Not on My Watch",
    manaCost: "{1}{W}",
    typeLine: "Instant",
    oracleText: "Exile target attacking creature.",
    layout: "normal",
};

const SECOND_THOUGHTS: OracleCard = {
    oracleId: "41bfef9f-6eb7-49c7-9b90-ff9f385ba670",
    name: "Second Thoughts",
    manaCost: "{4}{W}",
    typeLine: "Instant",
    oracleText: "Exile target attacking creature.\nDraw a card.",
    layout: "normal",
};

const TREVAS_CHARM: OracleCard = {
    oracleId: "e9795590-0918-49f9-b37c-1278c8616ab1",
    name: "Treva's Charm",
    manaCost: "{G}{W}{U}",
    typeLine: "Instant",
    oracleText:
        "Choose one —\n• Destroy target enchantment.\n• Exile target attacking creature.\n• Draw a card, then discard a card.",
    layout: "normal",
};

const RESOUNDING_SILENCE: OracleCard = {
    oracleId: "6eefa487-1542-4d24-80bd-4893d9d908c8",
    name: "Resounding Silence",
    manaCost: "{3}{W}",
    typeLine: "Instant",
    oracleText:
        "Exile target attacking creature.\nCycling {5}{G}{W}{U} ({5}{G}{W}{U}, Discard this card: Draw a card.)\nWhen you cycle this card, exile up to two target attacking creatures.",
    layout: "normal",
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const ATTACKING_CREATURE = {
    type: "Creature",
    count: 1,
    combatRoleFilter: ["attacking"],
};

describe("exile a permanent (CR 701.13a, issue #4311)", () => {
    it("Not on My Watch: the bare spell lowers to one exile Op", () => {
        expect(sortKeys(compiled(NOT_ON_MY_WATCH))).toEqual(
            sortKeys({
                name: "Not on My Watch",
                types: ["Instant"],
                manaCost: { X: 1, W: 1 },
                oracleText: "Exile target attacking creature.",
                effects: [{ op: "exile", target: { target: 0 } }],
                targetRequirement: ATTACKING_CREATURE,
            })
        );
    });

    it("Second Thoughts: a sentence after the exile is read on its own", () => {
        expect(sortKeys(compiled(SECOND_THOUGHTS))).toEqual(
            sortKeys({
                name: "Second Thoughts",
                types: ["Instant"],
                manaCost: { X: 4, W: 1 },
                oracleText: "Exile target attacking creature.\nDraw a card.",
                effects: [
                    { op: "exile", target: { target: 0 } },
                    { op: "draw", player: "controller", count: 1 },
                ],
                targetRequirement: ATTACKING_CREATURE,
            })
        );
    });

    it("Treva's Charm: the exile is one mode's own announced target", () => {
        const definition = compiled(TREVAS_CHARM);
        expect(definition.modes?.[1]).toEqual({
            id: "treva-s-charm-mode-2",
            label: "Exile target attacking creature",
            oracleText: "Exile target attacking creature.",
            effects: [{ op: "exile", target: { target: 0 } }],
            targetRequirement: ATTACKING_CREATURE,
        });
    });

    it("refuses a sweep: 'Exile all attacking creatures' announces no target", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Sweep Probe",
                manaCost: "{W}",
                typeLine: "Instant",
                oracleText: "Exile all attacking creatures.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("Resounding Silence stays unparsed on its cycling lines, not the exile", () => {
        const outcome = compileCard(RESOUNDING_SILENCE);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.line)).toEqual([
            "Cycling {5}{G}{W}{U}",
            "When you cycle this card, exile up to two target attacking creatures.",
        ]);
    });
});
