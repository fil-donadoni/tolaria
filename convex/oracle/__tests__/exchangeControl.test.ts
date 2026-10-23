// Exchange of control with a sacrifice fallback (CR 701.12a, CR 701.21a,
// CR 608.2b): the three sentences of an "up to one target" exchange, read as
// one ability.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const EXCHANGE =
    "exchange control of this creature and up to one target creature an opponent controls.";
const FALLBACK =
    " If you don't or can't make an exchange, sacrifice this creature.";
const RESOLVES = " This ability still resolves if its target becomes illegal.";

function drake(oracleText: string) {
    return oracleCard({
        name: "Gilded Drake",
        manaCost: "{1}{U}",
        typeLine: "Creature — Drake",
        power: "3",
        toughness: "3",
        oracleText,
    });
}

describe("exchange control (CR 701.12a)", () => {
    it("probe", () => {
        const out = compileCard(
            drake(
                `Flying\nWhen this creature enters, ${EXCHANGE}${FALLBACK}${RESOLVES}`
            )
        );
        console.log(JSON.stringify(out, null, 1));
        expect(out.state).toBe("compiled");
    });
});
