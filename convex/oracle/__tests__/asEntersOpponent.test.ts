// "As this artifact enters, choose an opponent" (CR 614.1c / 614.12a) — the
// entry replacement whose answer the permanent keeps as `chosenPlayerId`.
//
// Every corpus card printing the line (Black Vise, Cursed Rack, The Rack)
// pairs it with a SECOND clause the grammar does not read yet, so none is
// `ready` from this rule alone: the golden is the printed LINE, read through
// the static slot and lowered on a card that carries nothing else. The
// hand-written Cursed Rack / The Rack are the gold reference for the shape.

import { describe, expect, it } from "vitest";
import { cursedRack, theRack } from "../../cards/sets/atq/colorless.cards";
import { compileCard } from "../compile";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE = "As this artifact enters, choose an opponent.";

const ctx = parseContext();

function refusal(line: string): string {
    const parsed = staticSlot.run(line, ctx);
    expect(parsed.ok, `expected "${line}" to be REFUSED`).toBe(false);
    return parsed.ok ? "" : parsed.reason;
}

function trinket(oracleText: string) {
    return oracleCard({
        name: "Test Trinket",
        manaCost: "{1}",
        typeLine: "Artifact",
        oracleText,
    });
}

describe("as-enters opponent choice (CR 614.12a)", () => {
    it("reads the printed line into the as-enters IR", () => {
        const parsed = staticSlot.run(LINE, ctx);
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: { kind: "as-enters-choose-opponent" },
            });
    });

    it("lowers to the opponent as-enters leg — the shape The Rack declares", () => {
        const outcome = compileCard(trinket(LINE));
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.entersWith).toEqual({
            asEnters: [{ kind: "opponent" }],
        });
        expect(outcome.definition.entersWith).toEqual(theRack().entersWith);
        expect(outcome.definition.entersWith).toEqual(cursedRack().entersWith);
    });

    it("REFUSES a different chooser or object", () => {
        expect(
            refusal("As this artifact enters, choose a player.")
        ).toBeTruthy();
        expect(
            refusal("As this artifact enters, choose a color.")
        ).toBeTruthy();
    });

    it("REFUSES the card-name-and-opponent compound — a different form", () => {
        expect(
            refusal(
                "As this artifact enters, choose an opponent and a card name other than a basic land card name."
            )
        ).toBeTruthy();
    });

    it("REFUSES a line about another permanent (CR 109.2)", () => {
        expect(
            refusal("As another artifact enters, choose an opponent.")
        ).toContain("is not this permanent");
    });

    it("REFUSES a card that makes the choice twice", () => {
        expect(compileCard(trinket(`${LINE}\n${LINE}`)).state).toBe("unparsed");
    });

    it("REFUSES a card that also makes another as-enters choice", () => {
        expect(
            compileCard(
                trinket(
                    `${LINE}\nAs this artifact enters, choose a nonland card name.`
                )
            ).state
        ).toBe("unparsed");
    });
});
