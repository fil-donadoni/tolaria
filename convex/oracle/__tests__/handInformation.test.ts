// Hand information and card naming: "Look at target player's hand", "Look at a
// card at random in target player's hand" (CR 400.2), "You draw a card at the
// beginning of the next turn's upkeep" (CR 603.7a) and "Choose a [nonland]
// card name" read back as "that name" (CR 201.3, CR 201.4a, issue #4528).
//
// Layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form.
//  2. REFUSALS — the neighbours the corpus prints that these rules do not
//     read, so fail-closed is pinned rather than assumed.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function expectDefinition(
    card: ReturnType<typeof oracleCard>,
    expected: Partial<CardDefinition> & Record<string, unknown>
) {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

function permanent(
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string
) {
    return oracleCard({
        name,
        manaCost,
        typeLine,
        oracleText,
        power: undefined,
        toughness: undefined,
    });
}

describe("Look at a hand — golden fixtures (CR 400.2)", () => {
    it("spell, target player: Clairvoyance", () => {
        const text = "Look at target player's hand.";
        expectDefinition(permanent("Clairvoyance", "{U}", "Instant", text), {
            name: "Clairvoyance",
            types: ["Instant"],
            manaCost: { U: 1 },
            oracleText: text,
            effects: [{ op: "lookHand", player: { target: 0 } }],
            targetRequirement: { type: "player", count: 1 },
        });
    });

    it("activated ability, target player: Glasses of Urza", () => {
        const text = "{T}: Look at target player's hand.";
        expectDefinition(
            permanent("Glasses of Urza", "{1}", "Artifact", text),
            {
                name: "Glasses of Urza",
                types: ["Artifact"],
                manaCost: { X: 1 },
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "glasses-of-urza-ability",
                        oracleText: text,
                        cost: { tap: true },
                        useStack: true,
                        effects: [{ op: "lookHand", player: { target: 0 } }],
                        targetRequirement: { type: "player", count: 1 },
                    },
                ],
            }
        );
    });

    it("a random card, then the next-upkeep draw: Urza's Bauble", () => {
        const text =
            "{T}, Sacrifice this artifact: Look at a card at random in target player's hand. You draw a card at the beginning of the next turn's upkeep.";
        const outcome = compiled(
            permanent("Urza's Bauble", "{0}", "Artifact", text)
        );
        const ability = outcome.activatedAbilities?.[0];
        expect(sortKeys(ability?.effects)).toEqual(
            sortKeys([
                { op: "lookRandomHand", player: { target: 0 } },
                {
                    op: "delayedTrigger",
                    timing: "next-upkeep",
                    oracleText:
                        "At the beginning of the next turn's upkeep, draw a card.",
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ])
        );
    });
});

describe("Choose a card name — golden fixtures (CR 201.3, CR 201.4a)", () => {
    it("nonland name, reveal and discard all with it: Cabal Therapy", () => {
        const outcome = compiled(
            permanent(
                "Cabal Therapy",
                "{B}",
                "Sorcery",
                "Choose a nonland card name. Target player reveals their hand and discards all cards with that name.\nFlashback—Sacrifice a creature."
            )
        );
        expect(sortKeys(outcome.effects)).toEqual(
            sortKeys([
                {
                    op: "nameCard",
                    player: "controller",
                    prompt: "Choose a nonland card name.",
                    bind: "$named",
                    nameRestriction: "no-land",
                },
                { op: "reveal", player: { target: 0 }, zone: "hand" },
                {
                    op: "discard",
                    player: { target: 0 },
                    filter: { name: { ref: "$named" } },
                },
            ])
        );
    });

    it("name other than a basic land, dig and exile the rest: Desperate Research", () => {
        const outcome = compiled(
            permanent(
                "Desperate Research",
                "{1}{B}",
                "Sorcery",
                "Choose a card name other than a basic land card name. Reveal the top seven cards of your library and put all of them with that name into your hand. Exile the rest."
            )
        );
        expect(sortKeys(outcome.effects)).toEqual(
            sortKeys([
                {
                    op: "nameCard",
                    player: "controller",
                    prompt: "Choose a card name other than a basic land card name.",
                    bind: "$named",
                    nameRestriction: "no-basic-land",
                },
                {
                    op: "digMatchingToHand",
                    player: "controller",
                    look: 7,
                    filter: { name: { ref: "$named" } },
                    destination: "exile",
                },
            ])
        );
    });
});

describe("Hand information and naming — refusals (fail-closed)", () => {
    const refused = (text: string, typeLine = "Sorcery") =>
        compileCard(permanent("Probe", "{U}", typeLine, text)).state ===
        "unparsed";

    it('a hand with no named owner: "look at that player\'s hand" at a spell', () => {
        expect(refused("Look at that player's hand.")).toBe(true);
    });

    it('an unnamed-player owner is not a player: "an opponent\'s hand"', () => {
        expect(refused("Look at a hand.")).toBe(true);
    });

    it("a chosen name nothing reads back", () => {
        expect(refused("Choose a card name.")).toBe(true);
    });

    it('"with that name" without a preceding choice', () => {
        expect(
            refused(
                "Target player reveals their hand and discards all cards with that name."
            )
        ).toBe(true);
    });

    it('a named reveal not followed by "Exile the rest."', () => {
        expect(
            refused(
                "Choose a card name. Reveal the top seven cards of your library and put all of them with that name into your hand."
            )
        ).toBe(true);
    });

    it('"Exile the rest." after no named reveal', () => {
        expect(refused("Draw a card. Exile the rest.")).toBe(true);
    });

    it("a second pick before the first is read", () => {
        expect(
            refused(
                "Choose a card name. Choose a nonland card name. Target player reveals their hand and discards all cards with that name."
            )
        ).toBe(true);
    });

    it("the public reveal is another game action: Duress-style text is not a look", () => {
        expect(refused("Target opponent reveals their hand.")).toBe(true);
    });

    it("a delayed draw of a variable count is refused", () => {
        expect(
            refused(
                "{T}: Look at a card at random in target player's hand. You draw X cards at the beginning of the next turn's upkeep.",
                "Artifact"
            )
        ).toBe(true);
    });

    it("an as-enters name (a standing choice) is not read", () => {
        expect(
            refused(
                "As this enchantment enters, choose a card name.",
                "Enchantment"
            )
        ).toBe(true);
    });
});
