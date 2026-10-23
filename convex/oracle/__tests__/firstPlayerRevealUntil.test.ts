// The head player's choice of an opposing player + optional reveal-until
// (CR 603.3d, CR 701.20a, CR 400.7, issue #5692).
//
//  1. GOLDEN — Oath of Druids compiled whole.
//  2. REFUSALS — each half without the others, and neighbouring wordings.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const HEAD = "At the beginning of each player's upkeep, ";
const CHOOSE =
    "that player chooses target player who controls more creatures than they do and is their opponent.";
const WINDOW =
    "The first player may reveal cards from the top of their library until they reveal a creature card.";
const ROUTE =
    "If the first player does, that player puts that card onto the battlefield and all other cards revealed this way into their graveyard.";

function probe(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Oath of Druids",
            manaCost: "{1}{G}",
            oracleText,
            typeLine: "Enchantment",
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("First player's optional reveal-until — golden (CR 603.3d, CR 701.20a)", () => {
    it("Oath of Druids", () => {
        const text = `${HEAD}${CHOOSE} ${WINDOW} ${ROUTE}`;
        const outcome = probe(text);
        if (outcome.state === "unparsed")
            throw new Error(JSON.stringify(outcome.gaps));
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Oath of Druids",
                types: ["Enchantment"],
                manaCost: { X: 1, G: 1 },
                oracleText: text,
                compiledTriggeredAbilities: [
                    {
                        id: "oath-of-druids-trigger",
                        oracleText: text,
                        head: { kind: "phase", phase: "UPKEEP", scope: "each" },
                        targetRequirement: {
                            type: "player",
                            count: 1,
                            playerControlsMoreThan: {
                                type: "Creature",
                                than: "active",
                            },
                        },
                        effects: [
                            {
                                op: "mayPay",
                                player: { ref: "$event.activePlayerId" },
                                prompt: "Reveal cards from the top of your library until you reveal a creature card?",
                                bind: "$revealed",
                            },
                            {
                                op: "if",
                                predicate: { binding: "$revealed" },
                                then: [
                                    {
                                        op: "revealUntilMatch",
                                        player: {
                                            ref: "$event.activePlayerId",
                                        },
                                        filter: { type: "Creature" },
                                        match: "battlefield",
                                        rest: "graveyard",
                                    },
                                ],
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("First player's optional reveal-until — refusals (fail-closed)", () => {
    it("the choice alone is refused", () => {
        expect(probe(`${HEAD}${CHOOSE}`).state).toBe("unparsed");
    });
    it("the window without the choice is refused", () => {
        expect(probe(`${HEAD}${WINDOW} ${ROUTE}`).state).toBe("unparsed");
    });
    it("the routing without the window is refused", () => {
        expect(probe(`${HEAD}${CHOOSE} ${ROUTE}`).state).toBe("unparsed");
    });
    it("the window without its routing is refused", () => {
        expect(probe(`${HEAD}${CHOOSE} ${WINDOW}`).state).toBe("unparsed");
    });
    it("a head naming no player is refused", () => {
        expect(
            probe(
                `At the beginning of your upkeep, ${CHOOSE} ${WINDOW} ${ROUTE}`
            ).state
        ).toBe("unparsed");
    });
    it("a neighbouring comparison (lands) is refused", () => {
        expect(
            probe(
                `${HEAD}${CHOOSE.replace("creatures", "lands")} ${WINDOW} ${ROUTE}`
            ).state
        ).toBe("unparsed");
    });
    it("a head whose player is not the active player is refused", () => {
        expect(
            probe(
                `Whenever a player casts a spell, ${CHOOSE} ${WINDOW} ${ROUTE}`
            ).state
        ).toBe("unparsed");
    });
});
