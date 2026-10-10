// Shuffle clauses: "You may have that player shuffle" after a looked-at
// library (CR 701.24a, CR 401.4) and "Target player shuffles up to N target
// cards from their graveyard into their library" (CR 404.1, CR 701.24a).
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function instant(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Instant",
        power: undefined,
        toughness: undefined,
    });
}

function sorcery(name: string, manaCost: string, oracleText: string) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine: "Sorcery",
        power: undefined,
        toughness: undefined,
    });
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

describe("Library shuffle — golden fixtures", () => {
    it("up to two cards from their graveyard into their library: Krosan Reclamation", () => {
        const text =
            "Target player shuffles up to two target cards from their graveyard into their library.";
        expect(
            sortKeys(compiled(instant("Krosan Reclamation", "{1}{G}", text)))
        ).toEqual(
            sortKeys({
                name: "Krosan Reclamation",
                types: ["Instant"],
                manaCost: { G: 1, X: 1 },
                oracleText: text,
                targetRequirement: { type: "player", count: 1 },
                effects: [
                    {
                        op: "choice",
                        kind: "choose-graveyard-card",
                        player: "controller",
                        zoneOwnerId: { target: 0 },
                        zone: "graveyard",
                        count: { min: 0, max: 2 },
                        prompt: "Shuffle up to two target cards from that player's graveyard into their library.",
                        bind: "$reclaimed1",
                    },
                    {
                        op: "moveZone",
                        cards: { ref: "$reclaimed1" },
                        player: { target: 0 },
                        from: "graveyard",
                        to: "library",
                    },
                    {
                        op: "libraryLook",
                        action: "shuffle",
                        player: { target: 0 },
                    },
                ],
            })
        );
    });

    it("the count word is read, not assumed: up to three (Gaea's Blessing's line)", () => {
        const definition = compiled(
            sorcery(
                "Gaea's Blessing",
                "{1}{G}",
                "Target player shuffles up to three target cards from their graveyard into their library."
            )
        );
        expect(definition.effects?.[0]).toMatchObject({
            op: "choice",
            count: { min: 0, max: 3 },
        });
    });

    it("look at target player's library, reorder, you may have that player shuffle: Portent's first line", () => {
        const text =
            "Look at the top three cards of target player's library, then put them back in any order. You may have that player shuffle.";
        const definition = compiled(
            sorcery("Natural Selection", "{2}{G}", text)
        );
        expect(definition.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        expect(definition.effects).toEqual([
            {
                op: "scryReorder",
                player: { target: 0 },
                chooser: "controller",
                count: 3,
                destination: "none",
            },
            {
                op: "mayPay",
                player: "controller",
                prompt: "Have that player shuffle?",
                bind: "$may1",
            },
            {
                op: "if",
                predicate: { binding: "$may1" },
                then: [
                    {
                        op: "libraryLook",
                        action: "shuffle",
                        player: { target: 0 },
                    },
                ],
            },
        ]);
    });
});

describe("Library shuffle — refusals (fail-closed, ADR 0105 § 2)", () => {
    const refused: [string, string][] = [
        [
            "that player with no library looked at before it",
            "You may have that player shuffle.",
        ],
        [
            "a graveyard shuffle of an unprinted count",
            "Target player shuffles up to some target cards from their graveyard into their library.",
        ],
        [
            "a graveyard shuffle on another subject",
            "Target opponent shuffles up to two target cards from their graveyard into their library.",
        ],
        [
            "the shuffle without its 'You may'",
            "Look at the top three cards of target player's library, then put them back in any order. Have that player shuffle.",
        ],
    ];
    for (const [why, text] of refused)
        it(`refuses ${why}`, () => {
            expect(compileCard(sorcery("Probe", "{1}", text)).state).toBe(
                "unparsed"
            );
        });
});
