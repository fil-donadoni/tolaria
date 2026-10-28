// "From among them": a pick scoped to the cards the sentence before put in
// view (CR 608.2c, issue #5499) — the shared `fromAmong.ts` sub-grammar and
// the two rules that fold it onto an antecedent.
//
// Three layers:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition, one per accepted form: a looked-at window
//     whose pick reveals the card taken, with each of the three rests (bottom
//     in any order, bottom in a random order, graveyard); a revealed window
//     whose pick is a plain "put"; and a mill whose pick reaches only the
//     milled cards (`mill.bindAll` + `choice.candidates`, issue #2600). Each
//     card-phrase branch (type, type or-list, "non-" list, subtype, colour,
//     "permanent card") is pinned by one of them.
//  2. REFUSALS — the neighbours the corpus prints that this rule does not
//     read, and each half without its antecedent or its rest.
//  3. The lowering invariant only the whole card decides: a mill's pick names
//     the mill's own binding, never the whole graveyard.

import { describe, expect, it } from "vitest";
import type { CardDefinition, CardType } from "../../cards/types";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function spell(
    name: string,
    manaCost: string,
    oracleText: string,
    typeLine = "Sorcery"
) {
    return oracleCard({
        name,
        manaCost,
        oracleText,
        typeLine,
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

const PERMANENT_CARD: CardType[] = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

describe("From among them — golden fixtures (CR 608.2c, CR 701.20a)", () => {
    it("look + reveal a creature card + the rest on the bottom in any order: Commune with Nature", () => {
        const text =
            "Look at the top five cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.";
        expectDefinition(spell("Commune with Nature", "{G}", text), {
            name: "Commune with Nature",
            types: ["Sorcery"],
            manaCost: { G: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 5,
                    take: 1,
                    filter: { type: "Creature" },
                    optional: true,
                    reveal: "kept",
                },
            ],
        });
    });

    it("a colour + the rest in a random order, after another effect: Ajani's Influence", () => {
        const text =
            "Put two +1/+1 counters on target creature.\nLook at the top five cards of your library. You may reveal a white card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";
        expectDefinition(spell("Ajani's Influence", "{2}{W}{W}", text), {
            name: "Ajani's Influence",
            types: ["Sorcery"],
            manaCost: { X: 2, W: 2 },
            oracleText: text,
            effects: [
                {
                    op: "counters",
                    action: "add",
                    counter: "+1/+1",
                    target: { target: 0 },
                    count: 2,
                },
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 5,
                    take: 1,
                    filter: { color: "W" },
                    optional: true,
                    reveal: "kept",
                    randomBottom: true,
                },
            ],
            targetRequirement: { type: "Creature", count: 1 },
        });
    });

    it('a "non-" list, on a trigger: Wandering Mind', () => {
        const trigger =
            "When this creature enters, look at the top six cards of your library. You may reveal a noncreature, nonland card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";
        expectDefinition(
            oracleCard({
                name: "Wandering Mind",
                manaCost: "{1}{U}{R}",
                typeLine: "Creature — Horror",
                oracleText: `Flying\n${trigger}`,
                power: "2",
                toughness: "1",
            }),
            {
                name: "Wandering Mind",
                types: ["Creature"],
                subtypes: ["Horror"],
                manaCost: { X: 1, U: 1, R: 1 },
                power: 2,
                toughness: 1,
                oracleText: `Flying\n${trigger}`,
                staticAbilities: ["flying"],
                compiledTriggeredAbilities: [
                    {
                        id: "wandering-mind-trigger",
                        oracleText: trigger,
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            {
                                op: "lookDistribute",
                                keepTo: "hand",
                                player: "controller",
                                look: 6,
                                take: 1,
                                filter: { excludeType: ["Creature", "Land"] },
                                optional: true,
                                reveal: "kept",
                                randomBottom: true,
                            },
                        ],
                    },
                ],
            }
        );
    });

    it("a subtype: Kolaghan Warmonger", () => {
        const trigger =
            "Whenever this creature attacks, look at the top six cards of your library. You may reveal a Dragon card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.";
        expectDefinition(
            oracleCard({
                name: "Kolaghan Warmonger",
                manaCost: "{2}{R}",
                typeLine: "Creature — Ogre Warrior",
                oracleText: `Haste\n${trigger}`,
                power: "3",
                toughness: "2",
            }),
            {
                name: "Kolaghan Warmonger",
                types: ["Creature"],
                subtypes: ["Ogre", "Warrior"],
                manaCost: { X: 2, R: 1 },
                power: 3,
                toughness: 2,
                oracleText: `Haste\n${trigger}`,
                staticAbilities: ["haste"],
                compiledTriggeredAbilities: [
                    {
                        id: "kolaghan-warmonger-trigger",
                        oracleText: trigger,
                        head: { kind: "attacks" },
                        effects: [
                            {
                                op: "lookDistribute",
                                keepTo: "hand",
                                player: "controller",
                                look: 6,
                                take: 1,
                                filter: { subtype: "Dragon" },
                                optional: true,
                                reveal: "kept",
                                randomBottom: true,
                            },
                        ],
                    },
                ],
            }
        );
    });

    it("look + reveal + the rest into your graveyard: Tapping at the Window", () => {
        const text =
            "Look at the top three cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest into your graveyard.\nFlashback {2}{G} (You may cast this card from your graveyard for its flashback cost. Then exile it.)";
        expectDefinition(spell("Tapping at the Window", "{1}{G}", text), {
            name: "Tapping at the Window",
            types: ["Sorcery"],
            manaCost: { X: 1, G: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 3,
                    take: 1,
                    filter: { type: "Creature" },
                    optional: true,
                    reveal: "kept",
                    destination: "graveyard",
                },
            ],
            flashback: { X: 2, G: 1 },
        });
    });

    it("a revealed window + put a type or-list + graveyard: Grisly Salvage", () => {
        const text =
            "Reveal the top five cards of your library. You may put a creature or land card from among them into your hand. Put the rest into your graveyard.";
        expectDefinition(spell("Grisly Salvage", "{B}{G}", text, "Instant"), {
            name: "Grisly Salvage",
            types: ["Instant"],
            manaCost: { B: 1, G: 1 },
            oracleText: text,
            effects: [
                {
                    op: "lookDistribute",
                    keepTo: "hand",
                    player: "controller",
                    look: 5,
                    take: 1,
                    filter: { type: ["Creature", "Land"] },
                    optional: true,
                    reveal: "window",
                    destination: "graveyard",
                },
            ],
        });
    });

    it('"a permanent card" (CR 110.4a), on an activated ability: Beastrider Vanguard', () => {
        const ability =
            "{4}{G}: Look at the top three cards of your library. You may reveal a permanent card from among them and put it into your hand. Put the rest on the bottom of your library in any order.";
        expectDefinition(
            oracleCard({
                name: "Beastrider Vanguard",
                manaCost: "{1}{G}",
                typeLine: "Creature — Human Knight",
                oracleText: ability,
                power: "2",
                toughness: "2",
            }),
            {
                name: "Beastrider Vanguard",
                types: ["Creature"],
                subtypes: ["Human", "Knight"],
                manaCost: { X: 1, G: 1 },
                power: 2,
                toughness: 2,
                oracleText: ability,
                activatedAbilities: [
                    {
                        id: "beastrider-vanguard-ability",
                        oracleText: ability,
                        cost: { mana: { X: 4, G: 1 } },
                        useStack: true,
                        effects: [
                            {
                                op: "lookDistribute",
                                keepTo: "hand",
                                player: "controller",
                                look: 3,
                                take: 1,
                                filter: { type: PERMANENT_CARD },
                                optional: true,
                                reveal: "kept",
                            },
                        ],
                    },
                ],
            }
        );
    });

    it("mill + put a card from among the milled cards: Eerie Gravestone", () => {
        const ability =
            "{1}{B}, Sacrifice this artifact: Mill four cards. You may put a creature card from among them into your hand.";
        const text = `When this artifact enters, draw a card.\n${ability} (To mill four cards, put the top four cards of your library into your graveyard.)`;
        expectDefinition(
            oracleCard({
                name: "Eerie Gravestone",
                manaCost: "{2}",
                typeLine: "Artifact",
                oracleText: text,
                power: undefined,
                toughness: undefined,
            }),
            {
                name: "Eerie Gravestone",
                types: ["Artifact"],
                manaCost: { X: 2 },
                oracleText: text,
                activatedAbilities: [
                    {
                        id: "eerie-gravestone-ability",
                        oracleText: ability,
                        cost: { mana: { X: 1, B: 1 }, sacrifice: true },
                        useStack: true,
                        effects: [
                            {
                                op: "mill",
                                player: "controller",
                                count: 4,
                                bindAll: "$milled1",
                            },
                            {
                                op: "choice",
                                kind: "choose-graveyard-card",
                                player: "controller",
                                zone: "graveyard",
                                candidates: [{ ref: "$milled1" }],
                                filter: { type: "Creature" },
                                count: { min: 0, max: 1 },
                                prompt: "You may put a creature card from among the milled cards into your hand.",
                                bind: "$pick2",
                            },
                            {
                                op: "moveZone",
                                cards: { ref: "$pick2" },
                                player: "controller",
                                from: "graveyard",
                                to: "hand",
                            },
                        ],
                    },
                ],
                compiledTriggeredAbilities: [
                    {
                        id: "eerie-gravestone-trigger",
                        oracleText: "When this artifact enters, draw a card.",
                        head: { kind: "entered", scope: "self" },
                        effects: [
                            { op: "draw", player: "controller", count: 1 },
                        ],
                    },
                ],
            }
        );
    });

    it("mill + a permanent card, then another effect: Something Worth Saving", () => {
        const text =
            "Mill four cards. You may put a permanent card from among them into your hand. You gain 1 life. (To mill four cards, put the top four cards of your library into your graveyard.)";
        expectDefinition(
            spell("Something Worth Saving", "{1}{G}", text, "Instant"),
            {
                name: "Something Worth Saving",
                types: ["Instant"],
                manaCost: { X: 1, G: 1 },
                oracleText: text,
                effects: [
                    {
                        op: "mill",
                        player: "controller",
                        count: 4,
                        bindAll: "$milled1",
                    },
                    {
                        op: "choice",
                        kind: "choose-graveyard-card",
                        player: "controller",
                        zone: "graveyard",
                        candidates: [{ ref: "$milled1" }],
                        filter: { type: PERMANENT_CARD },
                        count: { min: 0, max: 1 },
                        prompt: "You may put a permanent card from among the milled cards into your hand.",
                        bind: "$pick2",
                    },
                    {
                        op: "moveZone",
                        cards: { ref: "$pick2" },
                        player: "controller",
                        from: "graveyard",
                        to: "hand",
                    },
                    { op: "gainLife", player: "controller", amount: 1 },
                ],
            }
        );
    });
});

describe("From among them — refusals (fail-closed, ADR 0105 § 2)", () => {
    const LOOK = "Look at the top four cards of your library.";
    const REVEAL = "Reveal the top four cards of your library.";
    const REST =
        "Put the rest on the bottom of your library in a random order.";
    const refused: readonly (readonly [string, string])[] = [
        [
            "a mandatory pick (no fixture card reads it)",
            `${LOOK} Reveal an artifact card from among them and put it into your hand. ${REST}`,
        ],
        [
            '"put THAT CARD into your hand"',
            `${LOOK} You may reveal a creature card from among them and put that card into your hand. ${REST}`,
        ],
        [
            '"from among the revealed cards"',
            `${REVEAL} You may put a creature card from among the revealed cards into your hand. Put the rest into your graveyard.`,
        ],
        [
            '"from among those cards"',
            `${LOOK} You may reveal a creature card from among those cards and put it into your hand. ${REST}`,
        ],
        [
            "a private pick from a looked-at window",
            `${LOOK} You may put a creature card from among them into your hand. ${REST}`,
        ],
        [
            '"reveal it" from a window already revealed',
            `${REVEAL} You may reveal a creature card from among them and put it into your hand. Put the rest into your graveyard.`,
        ],
        [
            "a power clause the card filter cannot read",
            `${LOOK} You may reveal a creature card with power 2 or less from among them and put it into your hand. ${REST}`,
        ],
        [
            "a mana-value clause no fixture pins",
            `${LOOK} You may reveal a creature card with mana value 3 or less from among them and put it into your hand. ${REST}`,
        ],
        [
            "a plural pick",
            `${LOOK} You may reveal any number of artifact cards from among them and put them into your hand. ${REST}`,
        ],
        [
            "a pick with no rest behind it",
            `${LOOK} You may reveal a creature card from among them and put it into your hand.`,
        ],
        [
            "a pick followed by something other than the rest",
            `${LOOK} You may reveal a creature card from among them and put it into your hand. You gain 3 life.`,
        ],
        [
            "a pick with no antecedent",
            "You may put a creature card from among them into your hand.",
        ],
        [
            "a pick behind an effect that put no cards in view",
            "Draw two cards. You may put a creature card from among them into your hand.",
        ],
        [
            '"Put the rest" with no pick in front of it',
            `Draw two cards. ${REST}`,
        ],
        [
            "a pick from another player's mill",
            "Target player mills four cards. You may put a creature card from among them into your hand.",
        ],
        [
            "a pick behind a mill of a single card",
            "Mill a card. You may put a land card from among them into your hand.",
        ],
        [
            '"reveal it" behind a mill (the cards are already public)',
            "Mill four cards. You may reveal a creature card from among them and put it into your hand.",
        ],
    ];

    for (const [why, text] of refused) {
        it(`refuses ${why}`, () => {
            expect(
                compileCard(spell("Refusal Probe", "{1}{G}", text)).state
            ).toBe("unparsed");
        });
    }
});

describe("From among them — the mill's pick names the mill's own set (CR 400.2)", () => {
    it("the choice's only candidates are the cards this mill bound", () => {
        const definition = compiled(
            spell(
                "Mill Pick Probe",
                "{1}{G}",
                "Mill three cards. You may put a land card from among them into your hand."
            )
        );
        const [mill, choice] = definition.effects ?? [];
        if (mill?.op !== "mill" || choice?.op !== "choice")
            throw new Error("expected a mill and its choice");
        expect(mill.bindAll).toBeDefined();
        // A choice over the whole graveyard would reach a land milled turns
        // ago: the candidates are the mill's binding, and nothing else.
        expect(choice.candidates).toEqual([{ ref: mill.bindAll }]);
    });
});

// CR 608.2c + CR 701.17a — the MANDATORY pick onto the battlefield: "Mill N
// cards. Then put a creature card from among them onto the battlefield."
const VASTLANDS_SCAVENGER: OracleCard = {
    oracleId: "3a97bc8d-bd81-468e-9277-eba4fac11ee0",
    name: "Vastlands Scavenger // Bind to Life",
    manaCost: "{1}{G}{G} // {4}{G}",
    typeLine: "Creature — Bear Druid // Instant",
    oracleText: "",
    power: "4",
    toughness: "4",
    layout: "prepare",
    faces: [
        {
            name: "Vastlands Scavenger",
            manaCost: "{1}{G}{G}",
            typeLine: "Creature — Bear Druid",
            oracleText:
                "Deathtouch\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
            power: "4",
            toughness: "4",
        },
        {
            name: "Bind to Life",
            manaCost: "{4}{G}",
            typeLine: "Instant",
            oracleText:
                "Mill seven cards. Then put a creature card from among them onto the battlefield.",
        },
    ],
};

describe("From among them — a mandatory pick onto the battlefield (CR 608.2c)", () => {
    it("Vastlands Scavenger // Bind to Life: mill, then the creature pick enters", () => {
        const outcome = compileCard(VASTLANDS_SCAVENGER);
        expect(outcome.state).toBe("ready");
        if (outcome.state === "unparsed") return;
        expect(sortKeys(outcome.definition.insetSpell?.effects)).toEqual(
            sortKeys([
                {
                    op: "mill",
                    player: "controller",
                    count: 7,
                    bindAll: "$milled1",
                },
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: "controller",
                    zone: "graveyard",
                    candidates: [{ ref: "$milled1" }],
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Put a creature card from among the milled cards onto the battlefield.",
                    bind: "$pick2",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$pick2" },
                    player: "controller",
                    from: "graveyard",
                    to: "battlefield",
                },
            ])
        );
    });

    const refused: [string, string][] = [
        [
            "an instruction-less 'You may' version (a different, optional form)",
            "Mill seven cards. You may put a creature card from among them onto the battlefield.",
        ],
        [
            "a pick behind an effect that put no cards in view",
            "Draw two cards. Then put a creature card from among them onto the battlefield.",
        ],
        [
            "a pick from another player's mill",
            "Target player mills seven cards. Then put a creature card from among them onto the battlefield.",
        ],
        [
            "a pick behind a mill of a single card",
            "Mill a card. Then put a creature card from among them onto the battlefield.",
        ],
        [
            "an instant card (cannot be put onto the battlefield)",
            "Mill seven cards. Then put an instant card from among them onto the battlefield.",
        ],
    ];
    for (const [why, text] of refused) {
        it(`refuses ${why}`, () => {
            expect(
                compileCard(spell("Refusal Probe", "{4}{G}", text, "Instant"))
                    .state
            ).toBe("unparsed");
        });
    }
});
