// Linked exile, the whole pile back to the battlefield — the Parallax family
// (CR 607.2a, CR 110.2a). "Exile target creature." on an activated ability
// and "each player returns to the battlefield all cards they own exiled with
// it." on the leaves trigger are two linked abilities with NO duration: the
// card pass stamps the `exile` (`linkToSource`) the pile return names.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const FADING =
    "Fading 5 (This enchantment enters with five fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)";
const EXILE =
    "Remove a fade counter from this enchantment: Exile target creature.";
const RETURN =
    "When this enchantment leaves the battlefield, each player returns to the battlefield all cards they own exiled with it.";

function wave(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Parallax Wave",
            manaCost: "{2}{W}{W}",
            typeLine: "Enchantment",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

const PILE_RETURN = {
    op: "forEach",
    select: { set: "exiledWithSource" },
    simultaneous: true,
    effects: [
        {
            op: "moveZone",
            target: { ref: "$each" },
            from: "exile",
            to: "battlefield",
        },
    ],
};

describe("linked exile pile returned to the battlefield (CR 607.2a)", () => {
    it("golden: Parallax Wave links its exile and returns the pile to its owners", () => {
        const oracleText = `${FADING}\n${EXILE}\n${RETURN}`;
        const outcome = wave(oracleText);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Parallax Wave",
                types: ["Enchantment"],
                manaCost: { X: 2, W: 2 },
                oracleText,
                staticAbilities: ["fading 5"],
                activatedAbilities: [
                    {
                        id: "parallax-wave-ability",
                        oracleText: EXILE,
                        cost: { removeCounter: { type: "fade", count: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "exile",
                                target: { target: 0 },
                                linkToSource: true,
                            },
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "parallax-wave-trigger",
                        oracleText: RETURN,
                        head: { kind: "left", scope: "self" },
                        effects: [PILE_RETURN],
                    },
                ],
            })
        );
    });

    it("refuses the hand twin (Parallax Nexus)", () => {
        const hand = RETURN.replace(
            "to the battlefield all cards",
            "to their hand all cards"
        );
        expect(wave(`${FADING}\n${EXILE}\n${hand}`).state).toBe("unparsed");
    });

    it("refuses a pile return whose card prints no exile instruction", () => {
        expect(wave(`${FADING}\n${RETURN}`).state).toBe("unparsed");
    });

    it("refuses a pile return when a second exile instruction leaves the link unread", () => {
        const second = "{1}{W}: Exile target artifact.";
        expect(wave(`${FADING}\n${EXILE}\n${second}\n${RETURN}`).state).toBe(
            "unparsed"
        );
    });

    it("refuses a pile return beside an until-exile (CR 610.3 is another rule)", () => {
        const until =
            "When this enchantment enters, exile target creature an opponent controls until this enchantment leaves the battlefield.";
        // The Wave's own exile is still the ONE `exile` instruction, so only
        // the bundle beside it can refuse the card.
        expect(wave(`${until}\n${EXILE}\n${RETURN}`).state).toBe("unparsed");
    });

    it('refuses "exiled with it" behind a head other than the departure', () => {
        const upkeep = RETURN.replace(
            "When this enchantment leaves the battlefield",
            "At the beginning of your upkeep"
        );
        expect(wave(`${FADING}\n${EXILE}\n${upkeep}`).state).toBe("unparsed");
    });
});
