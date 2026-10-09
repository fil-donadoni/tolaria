// "Discard X cards" as a spell's additional cost (CR 601.2b, CR 107.3a,
// CR 701.9a; issue #4563). The caster announces X; the cost is
// `additionalCosts.discard.count: "X"` (issue #2714's encoding).
//
//  1. GOLDEN — a real corpus card (Sickening Dreams) compiles to its whole
//     definition.
//  2. REFUSALS — the neighbours the engine has no encoding for stay unparsed:
//     an activated ability's "Discard X cards" (no announced X on an
//     activation cost) and a flashback cost with it (`FlashbackCost` has no
//     discard leg).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const SICKENING_DREAMS =
    "As an additional cost to cast this spell, discard X cards.\nSickening Dreams deals X damage to each creature and each player.";

function spell(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

describe("Discard X cards — additional cost (CR 601.2b, CR 107.3a)", () => {
    it("Sickening Dreams: the additional cost is a caster-announced discard", () => {
        const outcome = compileCard(
            spell("Sickening Dreams", "{X}{B}", SICKENING_DREAMS)
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition.additionalCosts)).toEqual(
            sortKeys({ discard: { filter: {}, count: "X" } })
        );
    });
});

describe("Discard X cards — refused neighbours (fail-closed)", () => {
    it("an activated ability cannot pay a discard-X cost", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Artifact",
                manaCost: "{1}",
                typeLine: "Artifact",
                power: undefined,
                toughness: undefined,
                oracleText: "Discard X cards: Draw a card.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a flashback cost has no discard leg", () => {
        const outcome = compileCard(
            spell(
                "Test Flash",
                "{R}",
                "Test Flash deals 1 damage to any target.\nFlashback—{R}{R}, Discard X cards."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("a typed or lowercase variant is not read", () => {
        const outcome = compileCard(
            spell(
                "Test Dreams",
                "{X}{B}",
                "As an additional cost to cast this spell, discard X creature cards.\nTest Dreams deals X damage to each player."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });
});
