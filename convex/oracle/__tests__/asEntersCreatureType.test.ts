// "As this creature enters, choose a creature type" (CR 614.1c / 614.12a,
// CR 205.3m, issue #4308) — the entry replacement whose answer the permanent's
// other abilities read back as "the chosen type" (CR 607.2d).
//
// Every corpus card printing the line (Brass Herald, Metallic Mimic, Plague
// Engineer, …) pairs it with a SECOND clause the grammar does not read yet, so
// none is `ready` from this rule alone and no whole-card golden over a real
// card exists: the golden is the printed LINE, read through the static slot
// and lowered on a card that carries nothing else. The hand-written Brass
// Herald is the gold reference for what the line must lower to.

import { describe, expect, it } from "vitest";
import { brassHerald } from "../../cards/sets/apc/colorless";
import { compileCard } from "../compile";
import { CREATURE_SUBTYPES } from "../grammar/shared/subtypes";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./fixtures";

const LINE = "As this creature enters, choose a creature type.";

const ctx = parseContext();

function refusal(line: string): string {
    const parsed = staticSlot.run(line, ctx);
    expect(parsed.ok, `expected "${line}" to be REFUSED`).toBe(false);
    return parsed.ok ? "" : parsed.reason;
}

function golem(oracleText: string) {
    return oracleCard({
        name: "Test Golem",
        manaCost: "{6}",
        typeLine: "Artifact Creature — Golem",
        oracleText,
    });
}

describe("as-enters creature-type choice (CR 614.12a)", () => {
    it("reads the printed line into the as-enters IR", () => {
        const parsed = staticSlot.run(LINE, ctx);
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: { kind: "as-enters-choose-creature-type" },
            });
    });

    it("lowers to the whole CR 205.3m list — the shape Brass Herald declares", () => {
        const outcome = compileCard(golem(LINE));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.entersWith).toEqual({
            asEnters: [
                { kind: "subtypes", from: [...CREATURE_SUBTYPES], count: 1 },
            ],
        });
        expect(outcome.definition.entersWith).toEqual(brassHerald.entersWith);
    });

    it("keeps the entry counters when the card also enters with them", () => {
        const outcome = compileCard(
            golem(
                `This creature enters tapped with two depletion counters on it.\n${LINE}`
            )
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.entersWith?.counters).toEqual([
            { type: "depletion", count: 2 },
        ]);
        expect(outcome.definition.entersWith?.asEnters).toHaveLength(1);
    });

    it("REFUSES a different choice (a colour, a basic land type)", () => {
        expect(
            refusal("As this creature enters, choose a color.")
        ).toBeTruthy();
        expect(
            refusal("As this creature enters, choose a basic land type.")
        ).toBeTruthy();
    });

    it("REFUSES a restricted creature-type choice — a different form", () => {
        expect(
            refusal(
                "As this creature enters, choose a creature type other than Wall."
            )
        ).toBeTruthy();
    });

    it("REFUSES a line about another permanent (CR 109.2)", () => {
        expect(
            refusal("As another creature enters, choose a creature type.")
        ).toContain("is not this permanent");
    });

    it("REFUSES a card that makes the choice twice", () => {
        expect(compileCard(golem(`${LINE}\n${LINE}`)).state).toBe("unparsed");
    });
});
