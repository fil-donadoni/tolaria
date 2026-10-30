// CR 606.4 — the loyalty ability line (`+N: …`, `-N: …`, `0: …`) in the
// activated slot lowers to `cost.loyalty`, the signed number of loyalty
// counters put on / removed from the source. Read one layer below a whole-card
// compile (as `chooseColorProtection.test.ts` does): the corpus planeswalkers
// printing these lines have other, unrelated lines the compiler cannot yet
// read, so a whole-card compile would test those instead.

import { describe, expect, it } from "vitest";
import { activatedSlot } from "../grammar/slots/activated";
import { lowerActivatedAbility } from "../lowerActivated";
import { oracleCard, parseContext } from "./oracle.fixture";

const PLANESWALKER = oracleCard({
    typeLine: "Legendary Planeswalker — Test",
    loyalty: "3",
});

function lowered(line: string, card = PLANESWALKER) {
    const parsed = activatedSlot.run(line, parseContext(card));
    if (!parsed.ok) throw new Error(`${line}: ${parsed.reason}`);
    if (parsed.value.kind !== "activated")
        throw new Error(`${line}: not an activated ability`);
    const out = lowerActivatedAbility({
        id: "test",
        oracleText: line,
        cardName: "Test Card",
        cost: parsed.value.cost,
        effects: parsed.value.effects,
        restrictions: parsed.value.restrictions,
    });
    if (!out.ok) throw new Error(`${line}: ${out.reason}`);
    return out.ability;
}

describe("loyalty ability line (CR 606.4)", () => {
    it("+N adds N loyalty counters — Ajani Goldmane", () => {
        expect(lowered("+1: You gain 2 life.")).toEqual({
            id: "test",
            oracleText: "+1: You gain 2 life.",
            cost: { loyalty: 1 },
            useStack: true,
            effects: [{ op: "gainLife", player: "controller", amount: 2 }],
        });
    });

    it("-N removes N loyalty counters — B.O.B. (Bevy of Beebles)", () => {
        expect(lowered("-1: Draw a card.")).toEqual({
            id: "test",
            oracleText: "-1: Draw a card.",
            cost: { loyalty: -1 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        });
    });

    it("0 is a neutral loyalty cost — Kaito, Dancing Shadow", () => {
        expect(lowered("0: Draw a card.")).toEqual({
            id: "test",
            oracleText: "0: Draw a card.",
            cost: { loyalty: 0 },
            useStack: true,
            effects: [{ op: "draw", player: "controller", count: 1 }],
        });
    });

    describe("refused neighbours", () => {
        const refused = (line: string, card = PLANESWALKER) =>
            activatedSlot.run(line, parseContext(card)).ok;

        it("-X (variable loyalty cost) — Gideon-style 'deals X damage'", () => {
            expect(
                refused("-X: This planeswalker deals X damage to any target.")
            ).toBe(false);
        });

        it("a loyalty cost beside another cost atom", () => {
            expect(refused("{T}, -1: Draw a card.")).toBe(false);
            expect(refused("-1, {1}: Draw a card.")).toBe(false);
        });

        it("a loyalty cost on a non-planeswalker (CR 606.2)", () => {
            expect(refused("+1: You gain 2 life.", oracleCard())).toBe(false);
        });
    });
});
