// "Each player <verb>" / "each opponent <verb>" for the four player verbs a
// fan-out reads — draw, mill, discard, life (CR 101.4, CR 102.2). "each
// player" is a `forEach` over the players naming `$each` (a discard is
// `simultaneous`, CR 101.4a); "each opponent" is the one opponent of the
// two-player engine. Golden fixtures (`GOLDEN_FIXTURES`, the `$each` smoke
// forms): Maggot Carrier (life), Vision Skeins (draw), Sibsig Icebreakers
// (discard), Sibsig Host (mill).
//
//  1. GOLDENS — "each opponent" for a drain and for a discard.
//  2. REFUSALS — the player verbs outside the four, which keep refusing the
//     phrase: a random discard, a poison counter, a hand-to-library put.
import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";

describe("player fan-out — goldens (CR 101.4, CR 102.2)", () => {
    it("Brotherhood Patriarch — each opponent's drain", () => {
        const outcome = compileCard({
            oracleId: "0c766a86-9c70-465e-874b-9d9f3b4eb090",
            name: "Brotherhood Patriarch",
            manaCost: "{3}{B}",
            typeLine: "Creature — Human Assassin",
            oracleText:
                "When this creature dies, each opponent loses 2 life and you gain 2 life.",
            power: "4",
            toughness: "1",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Brotherhood Patriarch",
                types: ["Creature"],
                subtypes: ["Human", "Assassin"],
                manaCost: { X: 3, B: 1 },
                power: 4,
                toughness: 1,
                oracleText:
                    "When this creature dies, each opponent loses 2 life and you gain 2 life.",
                compiledTriggeredAbilities: [
                    {
                        id: "brotherhood-patriarch-trigger",
                        oracleText:
                            "When this creature dies, each opponent loses 2 life and you gain 2 life.",
                        head: { kind: "died", scope: "self" },
                        effects: [
                            { op: "loseLife", player: "opponent", amount: 2 },
                            { op: "gainLife", player: "controller", amount: 2 },
                        ],
                    },
                ],
            })
        );
    });
    it("Burglar Rat — each opponent's discard", () => {
        const outcome = compileCard({
            oracleId: "2f807301-37df-4724-871a-08e3512b07b3",
            name: "Burglar Rat",
            manaCost: "{1}{B}",
            typeLine: "Creature — Rat",
            oracleText:
                "When this creature enters, each opponent discards a card.",
            power: "1",
            toughness: "1",
            layout: "normal",
        });
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys({
                name: "Burglar Rat",
                types: ["Creature"],
                subtypes: ["Rat"],
                manaCost: { X: 1, B: 1 },
                power: 1,
                toughness: 1,
                oracleText:
                    "When this creature enters, each opponent discards a card.",
                compiledTriggeredAbilities: [
                    {
                        id: "burglar-rat-trigger",
                        oracleText:
                            "When this creature enters, each opponent discards a card.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "choice",
                                kind: "discard-hand",
                                player: "opponent",
                                zone: "hand",
                                count: 1,
                                prompt: "Discard a card.",
                                bind: "$discard1",
                            },
                            {
                                op: "discard",
                                player: "opponent",
                                cards: { ref: "$discard1" },
                            },
                        ],
                    },
                ],
            })
        );
    });
});

describe("player fan-out — refused neighbours", () => {
    it("a random discard by each player is not fanned out", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText: "Each player discards a card at random.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/"each player" is not in grammar v0/)
        );
    });
    it("a poison counter for each opponent is not fanned out", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText: "Each opponent gets a poison counter.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/"each player" is not in grammar v0/)
        );
    });
    it("a put from each player's hand is not fanned out", () => {
        const outcome = compileCard({
            oracleId: "00000000-0000-0000-0000-000000000000",
            name: "Test Spell",
            manaCost: "{1}{G}",
            typeLine: "Sorcery",
            oracleText:
                "Each player puts a card from their hand on top of their library.",
            layout: "normal",
        });
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps.map((g) => g.reason)).toContainEqual(
            expect.stringMatching(/"each player" is not in grammar v0/)
        );
    });
});
