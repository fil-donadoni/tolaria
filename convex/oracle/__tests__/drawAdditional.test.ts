// "At the beginning of your draw step, draw two additional cards." — the
// Grammar Rule that reads "Draw N additional cards" as a plain `draw` (CR 504.1,
// CR 121.1), issue #5698.
//
// The positive form is Well of Ideas' own draw-step line (its other line,
// "each other player's draw step", is a separate gap, so the golden compiles
// the line alone). "Additional" counts from the draw step's turn-based draw,
// so every refusal below is the same sentence at a site where that draw is
// not the one just made (ADR 0105 § 2 — fail-closed).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const LINE = "At the beginning of your draw step, draw two additional cards.";

function enchantment(oracleText: string, name = "Test Well") {
    return oracleCard({
        name,
        manaCost: "{5}{U}",
        typeLine: "Enchantment",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("draw additional cards grammar (CR 504.1, CR 121.1)", () => {
    it("Well of Ideas' draw-step line compiles to a controller draw of two", () => {
        const outcome = compileCard(enchantment(LINE, "Well of Ideas"));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Well of Ideas",
                types: ["Enchantment"],
                manaCost: { X: 5, U: 1 },
                oracleText: LINE,
                compiledTriggeredAbilities: [
                    {
                        id: "well-of-ideas-trigger",
                        oracleText: LINE,
                        head: { kind: "phase", phase: "DRAW", scope: "your" },
                        effects: [
                            { op: "draw", player: "controller", count: 2 },
                        ],
                    },
                ],
            })
        );
    });

    it.each([
        [
            "an upkeep trigger (no draw step draw to add to)",
            "At the beginning of your upkeep, draw two additional cards.",
        ],
        [
            "another player's draw step",
            "At the beginning of each player's draw step, draw two additional cards.",
        ],
        [
            "an enters trigger",
            "When this enchantment enters, draw two additional cards.",
        ],
        ["a spell", "Draw two additional cards."],
        [
            "a singular count",
            "At the beginning of your draw step, draw an additional card.",
        ],
    ])("refuses %s", (_label, text) => {
        const isSpell = !text.startsWith("At") && !text.startsWith("When");
        const card = isSpell
            ? oracleCard({
                  name: "Test Insight",
                  manaCost: "{U}",
                  typeLine: "Sorcery",
                  oracleText: text,
                  power: undefined,
                  toughness: undefined,
              })
            : enchantment(text);
        expect(compileCard(card).state).toBe("unparsed");
    });
});
