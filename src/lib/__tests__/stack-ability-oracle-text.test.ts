// Every surface that prints an on-stack ability's text goes through ONE
// resolver (`getStackAbilityOracleText`).
//
// The APNAP trigger-ORDER prompt used to roll its own and only handled a
// card-def `triggeredAbilityId`, so a REFLEXIVE ability waiting in the same
// batch — Inti, Seneschal of the Sun's "When you do, put a +1/+1 counter on
// target attacking creature", whose stack item is an INLINE delayed trigger
// carrying its text on the item itself (CR 603.3c / ADR 0048) — rendered as a
// blank tile the player was asked to order.
import { describe, it, expect } from "vitest";
import {
    getStackAbilityOracleText,
    stackAbilityKindOf,
} from "~/lib/card-utils";

const INTI_ID = "fa7a55aa-ae61-4933-b7a4-dcc55dac6fcd";

describe("getStackAbilityOracleText", () => {
    it("resolves a card-def triggered ability", () => {
        const text = getStackAbilityOracleText({
            card: { id: INTI_ID },
            triggeredAbilityId: "inti-discard-impulse",
        });
        expect(text).toContain("Whenever you discard one or more cards");
    });

    it("resolves a REFLEXIVE ability from its inline text", () => {
        const item = {
            card: { id: INTI_ID },
            delayedTriggerId: "inline",
            delayedOracleText:
                "When you do, put a +1/+1 counter on target attacking creature. It gains trample until end of turn.",
        };
        expect(stackAbilityKindOf(item)).toBe("delayed");
        expect(getStackAbilityOracleText(item)).toBe(item.delayedOracleText);
    });

    it("resolves an activated ability", () => {
        // Lavaspur Boots' Equip.
        const text = getStackAbilityOracleText({
            card: { id: "e50709de-e6ef-4dbc-af1e-290fed279f34" },
            abilityId: "lavaspur-boots-equip",
        });
        expect(text).toBe("Equip {1}");
    });

    it("returns null for a spell (no ability id)", () => {
        expect(getStackAbilityOracleText({ card: { id: INTI_ID } })).toBeNull();
    });
});
