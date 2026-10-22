// Linked exile, return to hand — the hand-disruption family (CR 607.2a,
// CR 400.7). "Exile that card." on an enters trigger and "return the exiled
// card to its owner's hand." on the leaves trigger are two linked abilities;
// the card pass stamps the exile (`linkToSource`) the return names.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const ENTERS =
    "When this creature enters, target opponent reveals their hand and you choose a nonland card from it. Exile that card.";
const RETURN =
    "When this creature leaves the battlefield, return the exiled card to its owner's hand.";

function mesmeric(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Mesmeric Fiend",
            manaCost: "{1}{B}",
            typeLine: "Creature — Nightmare Horror",
            oracleText,
            power: "1",
            toughness: "1",
        })
    );
}

describe("linked exile returned to hand (CR 607.2a)", () => {
    it("golden: Mesmeric Fiend links its exile and returns it to the owner's hand", () => {
        const outcome = mesmeric(`${ENTERS}\n${RETURN}`);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        const triggers = sortKeys(
            outcome.definition.compiledTriggeredAbilities
        );
        expect(triggers).toEqual(
            sortKeys([
                {
                    id: "mesmeric-fiend-trigger",
                    oracleText: ENTERS,
                    head: { kind: "entered", scope: "self" },
                    targetRequirement: {
                        type: "player",
                        count: 1,
                        controller: "opponent",
                    },
                    effects: [
                        { op: "reveal", player: { target: 0 }, zone: "hand" },
                        {
                            op: "choice",
                            kind: "choose-hand-card",
                            player: "controller",
                            zoneOwnerId: { target: 0 },
                            zone: "hand",
                            filter: { excludeType: "Land" },
                            count: 1,
                            prompt: "Choose a nonland card from that player's hand.",
                            bind: "$picked1",
                        },
                        {
                            op: "moveZone",
                            cards: { ref: "$picked1" },
                            player: { target: 0 },
                            from: "hand",
                            to: "exile",
                            linkToSource: true,
                        },
                    ],
                },
                {
                    id: "mesmeric-fiend-trigger-2",
                    oracleText: RETURN,
                    head: { kind: "left", scope: "self" },
                    effects: [
                        {
                            op: "moveZone",
                            target: { exiledWithSource: true },
                            to: "hand",
                        },
                    ],
                },
            ])
        );
    });

    it("refuses a return whose card prints no exile instruction", () => {
        expect(mesmeric(RETURN).state).toBe("unparsed");
    });

    it("refuses a return when a second exile instruction leaves the link unread", () => {
        const graveyard = "{2}{B}: Exile target card from a graveyard.";
        expect(mesmeric(`${ENTERS}\n${RETURN}\n${graveyard}`).state).toBe(
            "unparsed"
        );
    });

    it("refuses a return beside an exile Op on another ability", () => {
        const creature = "{2}, {T}: Exile target creature.";
        expect(mesmeric(`${ENTERS}\n${RETURN}\n${creature}`).state).toBe(
            "unparsed"
        );
    });

    it("refuses the plural return", () => {
        const plural = RETURN.replace(
            "the exiled card to its",
            "the exiled cards to their"
        ).replace("owner's", "owners'");
        expect(mesmeric(`${ENTERS}\n${plural}`).state).toBe("unparsed");
    });

    it("refuses a return to the library", () => {
        const other = RETURN.replace("owner's hand", "owner's library");
        expect(mesmeric(`${ENTERS}\n${other}`).state).toBe("unparsed");
    });
});
