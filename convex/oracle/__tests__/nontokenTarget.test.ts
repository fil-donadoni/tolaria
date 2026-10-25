// "target nontoken creature" — the `nontoken` adjective at a target site
// (CR 111.1, issue #5284): the requirement carries `isToken: false` instead of
// widening to every creature or refusing the clause.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const SPELL = oracleCard({
    name: "Nontoken Doom",
    manaCost: "{1}{B}",
    typeLine: "Instant",
    power: undefined,
    toughness: undefined,
    oracleText: "Destroy target nontoken creature.",
});

describe('"target nontoken creature" compiles (CR 111.1)', () => {
    it("announces a nontoken-only target requirement", () => {
        const out = compileCard(SPELL);
        expect(out.state).toBe("ready");
        expect(
            out.state === "ready" && out.definition.targetRequirement
        ).toMatchObject({
            type: "Creature",
            isToken: false,
        });
    });
});
