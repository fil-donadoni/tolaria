// Cascade keyword line (CR 702.85) — the grammar reads "Cascade" and the
// repeated "Cascade, cascade" (CR 702.85c), and the census sees the `cascade`
// Op that `expandCascade` injects for the keyword.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

function creature(name: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost: "{4}{R}",
        oracleText,
        typeLine: "Creature",
        power: "2",
        toughness: "2",
    });
}

const REMINDER =
    "(When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order.)";

describe("cascade keyword (CR 702.85a)", () => {
    it("compiles a single Cascade line and censuses the cascade Op", () => {
        const out = compileCard(
            creature("Maelstrom Colossus", `Cascade ${REMINDER}`)
        );
        if (out.state === "unparsed") throw new Error("unparsed");
        expect(out.state).toBe("ready");
        expect(out.definition.staticAbilities).toEqual(["cascade"]);
        expect(out.opsUsed).toContain("cascade");
    });
});

describe("repeated cascade (CR 702.85c)", () => {
    it("compiles 'Cascade, cascade' to two instances", () => {
        const out = compileCard(
            creature("Call Forth the Tempest", "Cascade, cascade")
        );
        if (out.state === "unparsed") throw new Error("unparsed");
        expect(out.definition.staticAbilities).toEqual(["cascade", "cascade"]);
        expect(out.opsUsed).toContain("cascade");
    });

    it("still refuses any other keyword named twice", () => {
        const out = compileCard(creature("Doubled", "Flying, flying"));
        expect(out.state).toBe("unparsed");
    });
});
