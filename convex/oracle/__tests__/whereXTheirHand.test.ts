// CR 107.1b + CR 402.3 — "…, where X is the number of cards in their hand
// minus N": the golden is Black Vise's GOLDEN_FIXTURES row
// (`goldenFixtures.test.ts`); this file pins the neighbours the rule refuses
// and the state the fixture buys.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const HEAD =
    "At the beginning of the chosen player's upkeep, this artifact deals X damage to that player, where X is the number of cards in";

function vise(tail: string) {
    return compileCard(
        oracleCard({
            name: "Test Vise",
            manaCost: "{1}",
            typeLine: "Artifact",
            oracleText: `As this artifact enters, choose an opponent.\n${HEAD} ${tail}`,
        })
    );
}

describe("where X is the number of cards in their hand minus N (CR 402.3)", () => {
    it("reads 'their hand' as the head's player", () => {
        const out = vise("their hand minus 4.");
        expect(out.state).not.toBe("unparsed");
        expect(JSON.stringify(out.definition)).toContain('"minus":4');
    });
    it("refuses a hand that is not 'your' or 'their'", () => {
        expect(vise("his hand minus 4.").state).toBe("unparsed");
        expect(vise("their graveyard minus 4.").state).toBe("unparsed");
    });
});
