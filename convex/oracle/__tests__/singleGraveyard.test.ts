import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

describe("probe", () => {
    it("prints", () => {
        const r = compileCard(
            oracleCard({
                name: "Decompose",
                manaCost: "{1}{B}",
                typeLine: "Sorcery",
                oracleText:
                    "Exile up to three target cards from a single graveyard.",
            })
        );
        console.log(JSON.stringify(r, null, 1));
        expect(1).toBe(1);
    });
});
