// CR 202.2e / 204.2 — a front face's colour indicator is corpus data no rules
// text states; the lowering copies it onto `CardDefinition.colorIndicator`, and
// the round-trip feeds a hand-written card's claim back as the corpus would.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { goldOracleCard } from "../gold";
import { livingEnd } from "../../cards/sets/tsp/black.cards";
import { oracleCard } from "./oracle.fixture";

const SUSPEND_SORCERY = {
    name: "Ancestral Vision",
    manaCost: "",
    typeLine: "Sorcery",
    power: undefined,
    toughness: undefined,
    oracleText:
        "Suspend 4—{U} (Rather than cast this card from your hand, pay {U} and exile it with four time counters on it. At the beginning of your upkeep, remove a time counter. When the last is removed, you may cast it without paying its mana cost.)\nTarget player draws three cards.",
};

describe("front-face colour indicator lowering (CR 202.2e)", () => {
    it("a compiled no-mana-cost card carries its indicator's colours", () => {
        const outcome = compileCard(
            oracleCard({ ...SUSPEND_SORCERY, colorIndicator: ["U"] })
        );
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(outcome.definition.manaCost).toBeUndefined();
        expect(outcome.definition.colorIndicator).toEqual(["U"]);
    });

    it("a row with no indicator emits none", () => {
        const outcome = compileCard(oracleCard(SUSPEND_SORCERY));
        if (outcome.state === "unparsed") throw new Error("unparsed");
        expect(outcome.definition).not.toHaveProperty("colorIndicator");
    });

    it("a hand-written card's indicator is the round-trip's corpus input", () => {
        expect(goldOracleCard(livingEnd()).colorIndicator).toEqual(["B"]);
    });
});
