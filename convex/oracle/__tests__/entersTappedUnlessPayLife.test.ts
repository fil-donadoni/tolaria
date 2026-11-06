// "As this land enters, you may pay N life. If you don't, it enters tapped"
// (CR 614.12 / 614.12a, ADR 0051, issue #8519) — the shockland entry choice,
// lowered to the data field `entersTappedUnlessPay` that `gre/playLand.ts`
// already runs for the hand-written shock lands (Steam Vents is the gold
// reference: `makeDualLand({ shockLand: true })`).

import { describe, expect, it } from "vitest";
import { steamVents } from "../../cards/sets/gpt/colorless.cards";
import { compileCard } from "../compile";
import { staticSlot } from "../grammar/slots/staticSlot";
import { oracleCard, parseContext } from "./oracle.fixture";

const LINE =
    "As this land enters, you may pay 2 life. If you don't, it enters tapped.";

const ctx = parseContext();

function refusal(line: string): string {
    const parsed = staticSlot.run(line, ctx);
    expect(parsed.ok, `expected "${line}" to be REFUSED`).toBe(false);
    return parsed.ok ? "" : parsed.reason;
}

function steamVentsOracle(oracleText = `({T}: Add {U} or {R}.)\n${LINE}`) {
    return oracleCard({
        name: "Steam Vents",
        manaCost: "",
        typeLine: "Land — Island Mountain",
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("enters tapped unless you pay life (CR 614.12)", () => {
    it("reads the printed line into the pay-life IR", () => {
        const parsed = staticSlot.run(LINE, ctx);
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({
                kind: "static",
                clause: { kind: "enters-tapped-unless-pay-life", life: 2 },
            });
    });

    it("golden — Steam Vents compiles to the hand-written pay-choice", () => {
        const outcome = compileCard(steamVentsOracle());
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.entersTappedUnlessPay).toEqual({ life: 2 });
        expect(outcome.definition.entersTappedUnlessPay).toEqual(
            steamVents().entersTappedUnlessPay
        );
        expect(outcome.definition.entersTapped).toBeUndefined();
    });

    it("reads a different life amount (3 — the modal land backs)", () => {
        const outcome = compileCard(
            steamVentsOracle(LINE.replace("2 life", "3 life"))
        );
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(outcome.definition.entersTappedUnlessPay).toEqual({ life: 3 });
    });

    it("REFUSES a different payment (mana, a trailing rider)", () => {
        expect(
            refusal(
                "As this land enters, you may pay {2}. If you don't, it enters tapped."
            )
        ).toBeTruthy();
        expect(
            refusal(
                "As this land enters, you may pay 2 life. If you don't, it enters tapped and you lose 1 life."
            )
        ).toBeTruthy();
    });

    it("REFUSES a subject that is not this permanent", () => {
        expect(
            refusal(
                "As a creature enters, you may pay 2 life. If you don't, it enters tapped."
            )
        ).toBeTruthy();
    });

    it("REFUSES the colour-choice neighbour (Multiversal Passage) — own key", () => {
        expect(
            refusal(
                "As this land enters, choose a basic land type. Then you may pay 2 life. If you don't, it enters tapped."
            )
        ).toBeTruthy();
    });
});
