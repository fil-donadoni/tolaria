// Library top: "look at / reveal the top N cards of <player>'s library" and
// the routing that follows it (CR 401.4, CR 701.20a, issue #4123).
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: reveal + "all <Subtype>
//     cards revealed this way" (`lookDistribute`, subtype filter, the whole
//     window kept), look + "<N> of them" with each of the three rests (bottom
//     in any order, bottom in a random order, graveyard), a pick after an
//     earlier sentence (Prophetic Bolt), and the one-sentence "then put them
//     back in any order" (`scryReorder`, `destination: "none"`) on your own
//     library and on a target opponent's, with its "That player looks at …"
//     reply.
//  2. REFUSALS — each half without the other, the crossed pairs, the
//     neighbours the corpus prints that this rule does not read.
//  3. The lowering invariant only the whole card decides: "That player" binds
//     to the player whose library the sentence before looked at, and to
//     nothing else.

import { describe, expect, it } from "vitest";
import type { CardDefinition } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

function spell(name: string, manaCost: string, oracleText: string) {
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

/** Compile a card and return its definition, failing the test if refused. */
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

describe("Library top — golden fixtures (CR 401.4, CR 701.20a)", () => {
    it("reveal + all <Subtype> cards revealed this way: Goblin Ringleader", () => {
        const trigger =
            "When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.";
        expectDefinition(
            oracleCard({
                name: "Goblin Ringleader",
                manaCost: "{3}{R}",
                typeLine: "Creature — Goblin",
                oracleText: `Haste (This creature can attack and {T} as soon as it comes under your control.)\n${trigger}`,
            }),
            {
                name: "Goblin Ringleader",
                types: ["Creature"],
                subtypes: ["Goblin"],
                manaCost: { X: 3, R: 1 },
                power: 2,
                toughness: 2,
                oracleText: `Haste (This creature can attack and {T} as soon as it comes under your control.)\n${trigger}`,
                staticAbilities: ["haste"],
                compiledTriggeredAbilities: [
                    {
                        id: "goblin-ringleader-trigger",
                        oracleText: trigger,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "lookDistribute",
                                player: "controller",
                                look: 4,
                                take: 4,
                                keepTo: "hand",
                                filter: { subtype: "Goblin" },
                                optional: false,
                                reveal: "window",
                            },
                        ],
                    },
                ],
            }
        );
    });

    it("look + one of them, rest on the bottom in any order: Impulse", () => {
        const text =
            "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.";
        expectDefinition(spell("Impulse", "{1}{U}", text), {
            name: "Impulse",
            types: ["Instant"],
            manaCost: { X: 1, U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 4,
                    take: 1,
                },
            ],
        });
    });

    it("a pick after another effect, 'one of those cards': Prophetic Bolt", () => {
        const text =
            "Prophetic Bolt deals 4 damage to any target. Look at the top four cards of your library. Put one of those cards into your hand and the rest on the bottom of your library in any order.";
        expectDefinition(spell("Prophetic Bolt", "{3}{U}{R}", text), {
            name: "Prophetic Bolt",
            types: ["Instant"],
            manaCost: { X: 3, U: 1, R: 1 },
            oracleText: text,
            targetRequirement: { type: "any", count: 1 },
            effects: [
                { op: "dealDamage", amount: 4, to: { target: 0 } },
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 4,
                    take: 1,
                },
            ],
        });
    });

    it("look + one of them, rest into your graveyard: Forbidden Alchemy", () => {
        // Forbidden Alchemy's spell line (its flashback line is another
        // slot's, and not this rule's to pin).
        const text =
            "Look at the top four cards of your library. Put one of them into your hand and the rest into your graveyard.";
        expectDefinition(spell("Forbidden Alchemy", "{2}{U}", text), {
            name: "Forbidden Alchemy",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 4,
                    take: 1,
                    destination: "graveyard",
                },
            ],
        });
    });

    it("look + one of them, rest on the bottom in a random order: Shimmer of Possibility", () => {
        const text =
            "Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.";
        expectDefinition(sorcery("Shimmer of Possibility", "{1}{U}", text), {
            name: "Shimmer of Possibility",
            types: ["Sorcery"],
            manaCost: { X: 1, U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 4,
                    take: 1,
                    randomBottom: true,
                },
            ],
        });
    });

    it("look at your library, then put them back in any order: Index", () => {
        const text =
            "Look at the top five cards of your library, then put them back in any order.";
        expectDefinition(sorcery("Index", "{U}", text), {
            name: "Index",
            types: ["Sorcery"],
            manaCost: { U: 1 },
            oracleText: text,
            effects: [
                {
                    op: "scryReorder",
                    player: "controller",
                    count: 5,
                    destination: "none",
                },
            ],
        });
    });

    it("a target opponent's library, then 'That player looks at …': Tahngarth's Glare", () => {
        const text =
            "Look at the top three cards of target opponent's library, then put them back in any order. That player looks at the top three cards of your library, then puts them back in any order.";
        expectDefinition(sorcery("Tahngarth's Glare", "{R}", text), {
            name: "Tahngarth's Glare",
            types: ["Sorcery"],
            manaCost: { R: 1 },
            oracleText: text,
            targetRequirement: {
                type: "player",
                count: 1,
                controller: "opponent",
            },
            effects: [
                // You order the opponent's top three …
                {
                    op: "scryReorder",
                    player: { target: 0 },
                    chooser: "controller",
                    count: 3,
                    destination: "none",
                },
                // … then THAT player orders yours.
                {
                    op: "scryReorder",
                    player: "controller",
                    chooser: { target: 0 },
                    count: 3,
                    destination: "none",
                },
            ],
        });
    });
});

describe("Library top — target player's library", () => {
    it("an activated reorder of target player's library: Elemental Augury", () => {
        const line =
            "{3}: Look at the top three cards of target player's library, then put them back in any order.";
        const definition = compiled(
            oracleCard({
                name: "Elemental Augury",
                manaCost: "{U}{B}{R}",
                typeLine: "Enchantment",
                oracleText: line,
                power: undefined,
                toughness: undefined,
            })
        );
        const ability = definition.activatedAbilities?.[0];
        expect(ability?.targetRequirement).toEqual({
            type: "player",
            count: 1,
        });
        expect(ability?.effects).toEqual([
            {
                op: "scryReorder",
                player: { target: 0 },
                chooser: "controller",
                count: 3,
                destination: "none",
            },
        ]);
    });

    it('"That player" does not bind to a library looked at behind "you may"', () => {
        const outcome = compileCard(
            oracleCard({
                oracleText:
                    "When this creature enters, you may look at the top three cards of target opponent's library, then put them back in any order. That player looks at the top three cards of your library, then puts them back in any order.",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Library top — refusals (fail-closed, ADR 0105 § 2)", () => {
    const refused: [string, string][] = [
        [
            "a window with nothing routing it",
            "Look at the top four cards of your library.",
        ],
        [
            "a routing with no window in front of it",
            "Put one of them into your hand and the rest into your graveyard.",
        ],
        [
            "a window left open at the end of the line",
            "Draw a card. Look at the top four cards of your library.",
        ],
        [
            "a routing after an effect that is not a window",
            "Draw a card. Put one of them into your hand and the rest into your graveyard.",
        ],
        [
            "a routing separated from its window by another sentence",
            "Look at the top four cards of your library. Draw a card. Put one of them into your hand and the rest into your graveyard.",
        ],
        [
            '"revealed this way" after a private look (CR 701.20a)',
            "Look at the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.",
        ],
        [
            "a pick from a revealed window",
            "Reveal the top four cards of your library. Put one of them into your hand and the rest into your graveyard.",
        ],
        [
            "a card TYPE where the creature type goes",
            "Reveal the top four cards of your library. Put all land cards revealed this way into your hand and the rest on the bottom of your library in any order.",
        ],
        [
            "a type chosen elsewhere (Brass Herald)",
            "Reveal the top four cards of your library. Put all creature cards of the chosen type revealed this way into your hand and the rest on the bottom of your library in any order.",
        ],
        [
            "an optional filtered pick (Satyr Wayfinder's routing)",
            "Reveal the top four cards of your library. You may put a land card from among them into your hand. Put the rest into your graveyard.",
        ],
        [
            "another player's library routed into your hand",
            "Look at the top four cards of target opponent's library. Put one of them into your hand and the rest into your graveyard.",
        ],
        [
            "a single top card (a different template)",
            "Look at the top card of your library, then put it back.",
        ],
        [
            '"That player" with no library looked at before it',
            "That player looks at the top three cards of your library, then puts them back in any order.",
        ],
        [
            '"That player" after a sentence that looked at your OWN library',
            "Look at the top three cards of your library, then put them back in any order. That player looks at the top three cards of your library, then puts them back in any order.",
        ],
    ];

    for (const [why, text] of refused) {
        it(`refuses ${why}`, () => {
            expect(compileCard(sorcery("Test Card", "{U}", text)).state).toBe(
                "unparsed"
            );
        });
    }
});
