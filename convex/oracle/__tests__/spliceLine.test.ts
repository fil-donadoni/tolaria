// Splice: the "Splice onto Arcane <cost>" line (CR 702.47).
//
// Three layers:
//
//  1. GOLDEN fixture — a real corpus card compiled whole produces exactly
//     this Compiled Definition: its spell text as one Effect Script and the
//     `splice` ability the engine (`gre/splice.ts`) synthesizes a reveal from.
//  2. GOLD over the hand-written catalogue — every hand-written splice line
//     reads back to the `splice` its author declared.
//  3. REFUSALS — a non-mana splice cost (no printed shape this rule reads),
//     and a splice card whose text a reveal cannot add (CR 702.47b: a
//     targeting splice card is not offerable by the engine), which must stay
//     `unparsed` rather than compile into a keyword that offers nothing.

import { describe, expect, it } from "vitest";
import { getAllRawCards } from "../../cards/catalogue";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { keywordLineSlot, spliceRule } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

const SPLICE_REMINDER =
    " (As you cast an Arcane spell, you may reveal this card from your hand and pay its splice cost. If you do, add this card's effects to that spell.)";

function arcaneInstant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant — Arcane",
        power: undefined,
        toughness: undefined,
    });
}

describe("Splice line — golden fixture (CR 702.47a)", () => {
    it("Desperate Ritual: the spell's Effect Script plus its splice ability", () => {
        const outcome = compileCard(
            arcaneInstant(
                "Desperate Ritual",
                "{1}{R}",
                `Add {R}{R}{R}.\nSplice onto Arcane {1}{R}${SPLICE_REMINDER}`
            )
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Desperate Ritual",
                types: ["Instant"],
                subtypes: ["Arcane"],
                manaCost: { X: 1, R: 1 },
                oracleText: `Add {R}{R}{R}.\nSplice onto Arcane {1}{R}${SPLICE_REMINDER}`,
                effects: [{ op: "addMana", mana: { R: 3 } }],
                splice: {
                    subtype: "Arcane",
                    cost: { mana: { X: 1, R: 1 } },
                    description: "Splice onto Arcane {1}{R}",
                },
            })
        );
    });
});

describe("Splice line — gold over the hand-written catalogue (CR 702.47a)", () => {
    const spliceCards = getAllRawCards().filter((c) => c.splice !== undefined);

    it("the catalogue has a splice card, so the sweep is not vacuous", () => {
        expect(spliceCards.length).toBeGreaterThan(0);
    });

    it("every hand-written splice line reads back to its declared splice ability", () => {
        for (const card of spliceCards) {
            const line = card
                .oracleText!.split("\n")
                .find((l) => l.startsWith("Splice onto "))!
                .replace(SPLICE_REMINDER, "");
            const parsed = keywordLineSlot.run(line, parseContext());
            expect(parsed.ok, `${card.name}: ${line}`).toBe(true);
            if (!parsed.ok || parsed.value.kind !== "splice") continue;
            expect({
                subtype: parsed.value.subtype,
                cost: { mana: parsed.value.cost },
                description: parsed.value.description,
            }).toEqual(card.splice);
        }
    });
});

describe("Splice line — refusals (fail-closed)", () => {
    it("a non-mana splice cost is not read by this rule", () => {
        const parsed = spliceRule.run(
            "Splice onto Arcane—Sacrifice two Mountains",
            parseContext()
        );
        expect(parsed.ok).toBe(false);
    });

    it("Evermind: an instant with no mana cost stays unparsed (CR 118.6)", () => {
        // Its only line the grammar could not read was the splice line; with
        // it read, the card would compile — and the engine casts an absent
        // mana cost for {0}, turning an uncastable card into a free draw.
        const outcome = compileCard(
            arcaneInstant(
                "Evermind",
                "",
                `(Nonexistent mana costs can't be paid.)\nDraw a card.\nSplice onto Arcane {1}{U}${SPLICE_REMINDER}`
            )
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(JSON.stringify(outcome.gaps)).toContain(
            "an instant or sorcery with no mana cost (CR 118.6)"
        );
    });

    it("Glacial Ray: a targeting splice card stays unparsed (CR 702.47b/d)", () => {
        // The engine announces ONE target requirement, the main spell's, so a
        // reveal of a targeting card is never offered (`gre/splice.ts`
        // exclusion 2). Compiled, it would ship a splice keyword that does
        // nothing.
        const outcome = compileCard(
            arcaneInstant(
                "Glacial Ray",
                "{1}{R}",
                `Glacial Ray deals 2 damage to any target.\nSplice onto Arcane {1}{R}${SPLICE_REMINDER}`
            )
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(JSON.stringify(outcome.gaps)).toContain(
            "a splice card whose text is not one untargeted Effect Script (CR 702.47b)"
        );
    });
});
