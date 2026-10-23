// "you may have it deal X damage to <target>, where X is …" — the optional
// spelling of the source's own damage (CR 608.2h, CR 120.1), counted over the
// whole battlefield (CR 109.2). The golden for Gempalm Incinerator is the
// `GOLDEN_FIXTURES` row (`goldenFixtures.test.ts` compiles it whole); this
// file pins the neighbours the rule must refuse.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { oracleCard } from "./oracle.fixture";

function creatureWith(line: string) {
    return compileCard(
        oracleCard({
            name: "Test Goblin",
            manaCost: "{2}{R}",
            typeLine: "Creature — Goblin",
            oracleText: line,
            power: "2",
            toughness: "1",
        })
    );
}

describe("have it deal damage (CR 608.2h)", () => {
    it("lowers to a whole-board count behind an optional gate", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Gempalm Incinerator"
        )!;
        const outcome = compileCard(fixture.card);
        expect(outcome.state).not.toBe("unparsed");
        const ability = JSON.stringify(
            "definition" in outcome ? outcome.definition : {}
        );
        expect(ability).toContain('"acrossAllPlayers":true');
        expect(ability).not.toContain('"controller":"controller","filter"');
    });

    it("refuses a head whose 'it' is not the source", () => {
        const outcome = creatureWith(
            "Whenever another creature enters, you may have it deal 1 damage to target creature."
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses 'on the battlefield' beside a controller clause", () => {
        const outcome = creatureWith(
            "When you cycle this card, you may have it deal X damage to target creature, where X is the number of Goblins you control on the battlefield."
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses 'have it' with another verb", () => {
        const outcome = creatureWith(
            "When you cycle this card, you may have it gain 2 life."
        );
        expect(outcome.state).toBe("unparsed");
    });
});
