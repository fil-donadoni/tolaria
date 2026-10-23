// Activation lock (issue #5309) — "Activated abilities of creatures can't be
// activated.", CR 602.5 / 605.1a. The golden compiles the real Oracle line
// (Cursed Totem); refusals pin the neighbours; the behaviour block runs the
// rebuilt effect through the engine's own scan (`activationRestrictionViolation`).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";

const LINE = "Activated abilities of creatures can't be activated.";

const TOTEM: OracleCard = {
    oracleId: "cc99ee76-45b6-4f1d-b0b0-7da8775ca90c",
    name: "Cursed Totem",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText: LINE,
};

const line = (oracleText: string): OracleCard => ({
    ...TOTEM,
    oracleId: "neighbour",
    name: "Neighbour",
    oracleText,
});

describe("activation lock — golden", () => {
    it("creatures' activated abilities can't be activated (CR 602.5)", () => {
        const outcome = compileCard(TOTEM);
        expect(outcome.state, JSON.stringify(outcome)).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Cursed Totem",
                types: ["Artifact"],
                manaCost: { X: 2 },
                oracleText: LINE,
                compiledStaticEffects: [
                    {
                        kind: "activation-restriction",
                        id: "cursed-totem-creature-activation-lock",
                        filter: { types: "Creature" },
                        oracleText: LINE,
                    },
                ],
            })
        );
    });
});

describe("activation lock — refused neighbours", () => {
    it.each([
        "Activated abilities of artifacts can't be activated.",
        "Activated abilities of creatures can't be activated unless they're mana abilities.",
        "Activated abilities of creatures your opponents control can't be activated.",
        "Activated abilities of creatures can't be activated during combat.",
        "Activated abilities can't be activated.",
    ])("REFUSES %s", (text) => {
        expect(compileCard(line(text)).state).toBe("unparsed");
    });
});
