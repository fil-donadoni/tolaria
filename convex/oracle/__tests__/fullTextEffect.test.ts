// Full-text effect (CR 612.6, layer 3 per CR 613.1c):
//
//   "As long as the top card of your graveyard is a creature card, this
//    creature has the full text of that card and has the text "{2}: Discard
//    a card.""
//
//  1. GOLDEN — Volrath's Shapeshifter compiled whole.
//  2. REFUSALS — neighbours stay unparsed (fail-closed).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { oracleCard } from "./oracle.fixture";

const LINE =
    'As long as the top card of your graveyard is a creature card, this creature has the full text of that card and has the text "{2}: Discard a card."';
const ACTIVATED = "{2}: Discard a card.";

const SHAPESHIFTER = oracleCard({
    oracleId: "ec89ee13-34ef-41c8-8fe4-0a6b21df2032",
    name: "Volrath's Shapeshifter",
    manaCost: "{1}{U}{U}",
    typeLine: "Creature — Phyrexian Shapeshifter",
    oracleText: `${LINE}\n${ACTIVATED}`,
    power: "0",
    toughness: "1",
});

describe("full text effect — golden (CR 612.6)", () => {
    it("Volrath's Shapeshifter: full text of the graveyard top, own ability kept", () => {
        const outcome = compileCard(SHAPESHIFTER);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "ready") return;
        const { definition } = outcome;
        expect(definition.activatedAbilities).toHaveLength(1);
        expect(definition.fullText).toEqual({
            from: "controller-graveyard-top",
            requiresType: "Creature",
            retainedActivatedAbilityIds: [
                definition.activatedAbilities![0]!.id,
            ],
        });
    });
});

describe("full text effect — refusals", () => {
    const state = (text: string) =>
        compileCard(oracleCard({ ...SHAPESHIFTER, oracleText: text })).state;

    it.each([
        [
            "another zone",
            `${LINE.replace("graveyard", "library")}\n${ACTIVATED}`,
        ],
        [
            "another card type",
            `${LINE.replace("creature card", "artifact card")}\n${ACTIVATED}`,
        ],
        [
            "no retained text",
            `${LINE.replace(' and has the text "{2}: Discard a card."', "")}\n${ACTIVATED}`,
        ],
        [
            "not the card itself",
            `${LINE.replace("this creature", "target creature")}\n${ACTIVATED}`,
        ],
    ])("%s stays unparsed", (_label, text) => {
        expect(state(text)).toBe("unparsed");
    });

    it("a retained ability the card does not print is not ready", () => {
        expect(state(LINE)).not.toBe("ready");
    });
});
