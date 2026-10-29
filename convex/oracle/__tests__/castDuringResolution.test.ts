// "Exile the top card of your library. You may cast that card." — the
// no-duration cast offered inside the resolution (CR 608.2g) and the
// "If you don't" decline behind it.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function probe(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Probe",
            manaCost: "{R}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("probe", () => {
    it.each([
        "Exile the top card of your library. You may cast that card.",
        "Exile the top card of your library. You may cast that card. If you don't, draw a card.",
        "Exile the top card of your library. You may cast it. If you don't, Probe deals 2 damage to target creature.",
    ])("%s", (t) => {
        const o = probe(t);
        expect(
            JSON.stringify(
                o.state === "unparsed" ? o.gaps : o.definition.effects
            )
        ).toBe("x");
    });
});
