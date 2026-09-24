// Keyword line: "Protection from [quality]" (CR 702.16a/g, issue #4312).
//
//  1. GOLDEN — a real Oracle line compiled whole produces exactly the
//     engine's own `staticAbilities[]` strings, one per quality family the
//     engine parser names (colour, artifacts, everything, two-quality
//     shorthand, comma list, keyword run).
//  2. AGREEMENT — every accepted quality is one `parseProtectionQuality`
//     names; the grammar has no vocabulary of its own.
//  3. REFUSALS — qualities the engine cannot name stay `unparsed`.

import { describe, expect, it } from "vitest";
import { parseProtectionQuality } from "../../gre/protection";
import { compileCard } from "../compile";
import { oracleCard } from "./fixtures";

function creature(name: string, manaCost: string, oracleText: string) {
    return oracleCard({ name, manaCost, oracleText, typeLine: "Creature" });
}

function staticAbilitiesOf(oracleText: string): readonly string[] {
    const outcome = compileCard(creature("Fixture", "{1}{W}", oracleText));
    if (outcome.state === "unparsed")
        throw new Error(
            `${oracleText} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition.staticAbilities ?? [];
}

describe("Protection line — golden fixtures (CR 702.16a)", () => {
    it.each([
        // Spectral Lynx / Vodalian Zombie
        ["Protection from green", ["protection from green"]],
        // Nacatl Savage — a card type
        ["Protection from artifacts", ["protection from artifacts"]],
        // Progenitus (CR 702.16j)
        ["Protection from everything", ["protection from everything"]],
        // Auriok Champion (CR 702.16g)
        [
            "Protection from black and from red",
            ["protection from black", "protection from red"],
        ],
        // Oversoul of Dusk (CR 702.16g, comma list)
        [
            "Protection from blue, from black, and from red",
            [
                "protection from blue",
                "protection from black",
                "protection from red",
            ],
        ],
        // Knights of Thorn — a run with another keyword
        ["Protection from red; banding", ["protection from red", "banding"]],
        ["Protection from instants", ["protection from instants"]],
    ])("%s", (line, expected) => {
        expect(staticAbilitiesOf(line)).toEqual(expected);
    });
});

describe("Protection line — agrees with the engine parser", () => {
    it.each(["white", "blue", "black", "red", "green", "colorless"])(
        "colour %s",
        (colour) => {
            const [ability] = staticAbilitiesOf(`Protection from ${colour}`);
            expect(parseProtectionQuality(ability!)).not.toBeNull();
        }
    );
});

describe("Protection line — refusals (fail-closed)", () => {
    it.each([
        "Protection from Goblins", // subtype: the engine cannot name it
        "Protection from monocolored",
        "Protection from non-Spirit creatures",
        "Protection from Vampires, from Werewolves, and from Zombies",
        "Protection from",
        "Protection from red and from",
        "Protection from red, from blue", // bare comma list is not printed
        "Protection from red and from blue, from green", // mixed separators
        "Protection from red and from blue and from green",
        "Protection from red, from blue, and from red", // duplicate
        "Protection from red and from red",
    ])("%s", (line) => {
        const outcome = compileCard(creature("Fixture", "{1}{W}", line));
        expect(outcome.state).toBe("unparsed");
    });
});
