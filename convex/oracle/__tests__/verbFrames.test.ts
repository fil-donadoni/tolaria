// The Verb Frame layer (issue #6557, CR 701.23a, CR 701.20a, CR 701.24a,
// CR 608.2c): "Search your library for <quantity> <descriptor>[, reveal
// <pronoun>], put <pronoun> <into|onto|on> <zone>[ tapped], then shuffle" and
// its orderings, read as a chain of Op-shaped frames in place of the four
// retired whole-sentence kinds (`search-library-to-hand`, `-to-battlefield`,
// `-to-top`, `shuffle-searched-library`).
//
//  1. GOLDEN — one real corpus card per ARGUMENT CLASS a frame accepts (not
//     per card): the search's quantity and descriptor classes and its reveal
//     pronouns, the moveZone's pronoun × destination × tapped, the shuffle's
//     three spellings. Compared whole where the card is one line, by effects
//     where the frame sits behind a cost or a trigger head.
//  2. REFUSALS — one per frame for a class it does not declare, and the
//     pronoun rule's two refusals (no referent, wrong number).
//  3. Lowering invariants — the order of the Ops is the printed order; the
//     find is optional exactly when CR 701.23b says so.
//
// The kinds these frames replace had their own fixtures (Lay of the Land,
// Worldly Tutor, Windswept Heath, Skyshroud Poacher …); those cards are
// re-pinned here with the SAME Compiled Definitions, so retirement by
// substitution is `lost = 0` by test, not by assertion.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import { frameOf } from "../grammar/shared/verbFrames";
import { oracleCard } from "./oracle.fixture";

function compiledDefinition(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

const sorcery = (name: string, manaCost: string, oracleText: string) =>
    oracleCard({ name, manaCost, typeLine: "Sorcery", oracleText });

/** The `choice` a search frame lowers to. */
function search(
    phrase: string,
    filter: object | null,
    count: number | { min: number; max: number },
    bind = "$found1"
) {
    return {
        op: "choice",
        kind: "search-library",
        player: "controller",
        zone: "library",
        ...(filter === null ? {} : { filter }),
        count,
        prompt: `Search your library for ${phrase}.`,
        bind,
    };
}
const reveal = (bind = "$found1") => ({
    op: "reveal",
    player: "controller",
    cards: { ref: bind },
});
const move = (to: string, tapped = false, bind = "$found1") => ({
    op: "moveZone",
    cards: { ref: bind },
    player: "controller",
    from: "library",
    to,
    ...(tapped ? { tapped: true } : {}),
});
const SHUFFLE = { op: "libraryLook", action: "shuffle", player: "controller" };

describe("search frame — descriptor classes (CR 701.23a)", () => {
    it("no description, 'a card': Demonic Tutor — no filter, and the find is MANDATORY (CR 701.23b)", () => {
        const text =
            "Search your library for a card, put that card into your hand, then shuffle.";
        expect(
            sortKeys(
                compiledDefinition(sorcery("Demonic Tutor", "{1}{B}", text))
            )
        ).toEqual(
            sortKeys({
                name: "Demonic Tutor",
                types: ["Sorcery"],
                manaCost: { X: 1, B: 1 },
                oracleText: text,
                effects: [search("a card", null, 1), move("hand"), SHUFFLE],
            })
        );
    });

    it("a card type: Expedition Map's land card", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Expedition Map",
                manaCost: "{1}",
                typeLine: "Artifact",
                oracleText:
                    "{2}, {T}, Sacrifice this artifact: Search your library for a land card, reveal it, put it into your hand, then shuffle.",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            search("a land card", { type: "Land" }, { min: 0, max: 1 }),
            reveal(),
            move("hand"),
            SHUFFLE,
        ]);
    });

    it("a card-type disjunction: Mystical Tutor's instant or sorcery card", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Mystical Tutor",
                manaCost: "{U}",
                typeLine: "Instant",
                oracleText:
                    "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.",
            })
        );
        expect(def.effects).toEqual([
            search(
                "an instant or sorcery card",
                { type: ["Instant", "Sorcery"] },
                { min: 0, max: 1 }
            ),
            reveal(),
            SHUFFLE,
            move("library-top"),
        ]);
    });

    it("a supertype on a type: Lay of the Land's basic land card", () => {
        const text =
            "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.";
        expect(
            compiledDefinition(sorcery("Lay of the Land", "{G}", text)).effects
        ).toEqual([
            search(
                "a basic land card",
                { type: "Land", supertype: "Basic" },
                { min: 0, max: 1 }
            ),
            reveal(),
            move("hand"),
            SHUFFLE,
        ]);
    });

    it("a subtype: Goblin Matron's Goblin card, behind a trigger's may-gate", () => {
        const text =
            "When this creature enters, you may search your library for a Goblin card, reveal that card, put it into your hand, then shuffle.";
        const def = compiledDefinition(
            oracleCard({
                name: "Goblin Matron",
                manaCost: "{2}{R}",
                typeLine: "Creature — Goblin",
                oracleText: text,
                power: "1",
                toughness: "1",
            })
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys([
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Search your library for a Goblin card, reveal that card, put it into your hand, then shuffle?",
                    bind: "$may2",
                },
                {
                    op: "if",
                    predicate: { binding: "$may2" },
                    then: [
                        search(
                            "a Goblin card",
                            { subtype: "Goblin" },
                            { min: 0, max: 1 }
                        ),
                        reveal(),
                        move("hand"),
                        SHUFFLE,
                    ],
                },
            ])
        );
    });

    it("a subtype disjunction sharing one 'card': Windswept Heath", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Windswept Heath",
                manaCost: "",
                typeLine: "Land",
                oracleText:
                    "{T}, Pay 1 life, Sacrifice this land: Search your library for a Forest or Plains card, put it onto the battlefield, then shuffle.",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            search(
                "a Forest or Plains card",
                { subtype: ["Forest", "Plains"] },
                { min: 0, max: 1 }
            ),
            move("battlefield"),
            SHUFFLE,
        ]);
    });

    it("a subtyped permanent card (CR 110.4): Skyshroud Poacher's Elf permanent card", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Skyshroud Poacher",
                manaCost: "{2}{G}{G}",
                typeLine: "Creature — Human Rebel",
                oracleText:
                    "{3}, {T}: Search your library for an Elf permanent card, put it onto the battlefield, then shuffle.",
                power: "2",
                toughness: "2",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            search(
                "an Elf permanent card",
                {
                    type: [
                        "Artifact",
                        "Battle",
                        "Creature",
                        "Enchantment",
                        "Land",
                        "Planeswalker",
                    ],
                    subtype: "Elf",
                },
                { min: 0, max: 1 }
            ),
            move("battlefield"),
            SHUFFLE,
        ]);
    });

    it("a colour: Merchant Scroll's blue instant card", () => {
        const text =
            "Search your library for a blue instant card, reveal that card, put it into your hand, then shuffle.";
        expect(
            compiledDefinition(sorcery("Merchant Scroll", "{1}{U}", text))
                .effects
        ).toEqual([
            search(
                "a blue instant card",
                { type: "Instant", color: "U" },
                { min: 0, max: 1 }
            ),
            reveal(),
            move("hand"),
            SHUFFLE,
        ]);
    });

    it("a mana-value ceiling: Rathi Assassin's Mercenary permanent card with mana value 3 or less", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Rathi Assassin",
                manaCost: "{2}{B}{B}",
                typeLine: "Creature — Phyrexian Zombie Mercenary Assassin",
                oracleText:
                    "{1}{B}{B}, {T}: Destroy target tapped nonblack creature.\n{3}, {T}: Search your library for a Mercenary permanent card with mana value 3 or less, put it onto the battlefield, then shuffle.",
                power: "2",
                toughness: "2",
            })
        );
        expect(def.activatedAbilities?.[1]?.effects).toEqual([
            search(
                "a Mercenary permanent card with mana value 3 or less",
                {
                    type: [
                        "Artifact",
                        "Battle",
                        "Creature",
                        "Enchantment",
                        "Land",
                        "Planeswalker",
                    ],
                    subtype: "Mercenary",
                    manaValueAtMost: 3,
                },
                { min: 0, max: 1 }
            ),
            move("battlefield"),
            SHUFFLE,
        ]);
    });
});

describe("search frame — quantity classes and the reveal argument", () => {
    it("'up to N' with a plural noun and 'them': Skyshroud Claim", () => {
        const text =
            "Search your library for up to two Forest cards, put them onto the battlefield, then shuffle.";
        expect(
            sortKeys(
                compiledDefinition(sorcery("Skyshroud Claim", "{3}{G}", text))
            )
        ).toEqual(
            sortKeys({
                name: "Skyshroud Claim",
                types: ["Sorcery"],
                manaCost: { X: 3, G: 1 },
                oracleText: text,
                effects: [
                    search(
                        "up to two Forest cards",
                        { subtype: "Forest" },
                        { min: 0, max: 2 }
                    ),
                    move("battlefield"),
                    SHUFFLE,
                ],
            })
        );
    });

    it("'reveal that card' is the same argument as 'reveal it': Survival of the Fittest", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Survival of the Fittest",
                manaCost: "{1}{G}",
                typeLine: "Enchantment",
                oracleText:
                    "{G}, Discard a creature card: Search your library for a creature card, reveal that card, put it into your hand, then shuffle.",
            })
        );
        expect(def.activatedAbilities?.[0]?.effects).toEqual([
            search("a creature card", { type: "Creature" }, { min: 0, max: 1 }),
            reveal(),
            move("hand"),
            SHUFFLE,
        ]);
    });

    it("'reveal them' agrees with an 'up to N' find (CR 701.20a)", () => {
        const def = compiledDefinition(
            sorcery(
                "Probe",
                "{G}",
                "Search your library for up to two creature cards, reveal them, put them into your hand, then shuffle."
            )
        );
        expect(def.effects?.map((e) => e.op)).toEqual([
            "choice",
            "reveal",
            "moveZone",
            "libraryLook",
        ]);
    });

    it("refuses an undeclared quantity class: 'any number of' (Mana Severance), 'X cards' (Insidious Dreams), a bare count (Intuition), 'up to one'", () => {
        for (const text of [
            "Search your library for any number of land cards, exile them, then shuffle.",
            "Search your library for X cards, then shuffle and put those cards on top in any order.",
            "Search your library for three cards and reveal them.",
            "Search your library for up to one land card, put it into your hand, then shuffle.",
        ]) {
            const outcome = compileCard(sorcery("Probe", "{U}", text));
            expect(outcome.state).toBe("unparsed");
            if (outcome.state === "unparsed")
                expect(outcome.gaps[0]?.attribution?.span).toMatch(
                    /^Search your library for/
                );
        }
    });

    it("refuses an undeclared descriptor class: a card named (Avarax), a chosen type, a controller", () => {
        for (const text of [
            "Search your library for a card named Avarax, reveal it, put it into your hand, then shuffle.",
            "Search your library for a creature card you control, reveal it, put it into your hand, then shuffle.",
        ])
            expect(compileCard(sorcery("Probe", "{R}", text)).state).toBe(
                "unparsed"
            );
    });

    it("a quantity and a noun that disagree in number are refused", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Search your library for a Forest cards, put it onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Search your library for up to two Forest card, put them onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("moveZone frame — pronoun × destination × tapped (CR 400.7, CR 110.5b)", () => {
    it("'that card' onto the battlefield tapped: Rampant Growth, byte-identical to its kind-era definition", () => {
        const text =
            "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.";
        expect(
            JSON.stringify(
                compiledDefinition(sorcery("Rampant Growth", "{1}{G}", text))
            )
        ).toBe(
            JSON.stringify({
                name: "Rampant Growth",
                types: ["Sorcery"],
                manaCost: { X: 1, G: 1 },
                oracleText: text,
                effects: [
                    search(
                        "a basic land card",
                        { type: "Land", supertype: "Basic" },
                        { min: 0, max: 1 }
                    ),
                    move("battlefield", true),
                    SHUFFLE,
                ],
            })
        );
    });

    it("'that card' into your graveyard: Entomb", () => {
        const text =
            "Search your library for a card, put that card into your graveyard, then shuffle.";
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Entomb",
                    manaCost: "{B}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).effects
        ).toEqual([search("a card", null, 1), move("graveyard"), SHUFFLE]);
    });

    it("'them' into your graveyard: Buried Alive", () => {
        const text =
            "Search your library for up to three creature cards, put them into your graveyard, then shuffle.";
        expect(
            compiledDefinition(sorcery("Buried Alive", "{2}{B}", text)).effects
        ).toEqual([
            search(
                "up to three creature cards",
                { type: "Creature" },
                { min: 0, max: 3 }
            ),
            move("graveyard"),
            SHUFFLE,
        ]);
    });

    it("'the card' on top, after the shuffle: Worldly Tutor", () => {
        const text =
            "Search your library for a creature card, reveal it, then shuffle and put the card on top.";
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Worldly Tutor",
                    manaCost: "{G}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).effects
        ).toEqual([
            search("a creature card", { type: "Creature" }, { min: 0, max: 1 }),
            reveal(),
            SHUFFLE,
            move("library-top"),
        ]);
    });

    it("'that card' on top with no reveal, then a second sentence: Vampiric Tutor", () => {
        const text =
            "Search your library for a card, then shuffle and put that card on top. You lose 2 life.";
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Vampiric Tutor",
                    manaCost: "{B}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).effects
        ).toEqual([
            search("a card", null, 1),
            SHUFFLE,
            move("library-top"),
            { op: "loseLife", player: "controller", amount: 2 },
        ]);
    });

    it("refuses a destination outside the declared classes: another player's hand, exile, 'into the battlefield', the bottom", () => {
        for (const text of [
            "Search your library for a card, put that card into its owner's hand, then shuffle.",
            "Search your library for a card, put that card into exile, then shuffle.",
            "Search your library for a card, put that card into the battlefield, then shuffle.",
            "Search your library for a card, put that card on the bottom of your library, then shuffle.",
        ])
            expect(compileCard(sorcery("Probe", "{B}", text)).state).toBe(
                "unparsed"
            );
    });

    it("refuses 'tapped' anywhere but the battlefield (CR 110.5b)", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{B}",
                    "Search your library for a card, put that card into your hand tapped, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("the object pronoun rule (CR 608.2h) — bound to the last find, refused otherwise", () => {
    it("a pronoun with no referent: 'Put it into your hand' opens no search", () => {
        const outcome = compileCard(
            sorcery("Probe", "{U}", "Put it into your hand, then shuffle.")
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.attribution?.span).toBe(
                "Put it into your hand"
            );
    });

    it("a pronoun whose number disagrees with the find: 'a card … them', 'up to two … it'", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{B}",
                    "Search your library for a card, put them into your hand, then shuffle."
                )
            ).state
        ).toBe("unparsed");
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Search your library for up to two Forest cards, put it onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });

    it("a second reveal of the same find is refused", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Search your library for a creature card, reveal it, reveal it, put it into your hand, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("the find is put somewhere, once", () => {
    it("a search whose find no later frame moves is refused: 'Search your library for a card, then shuffle.'", () => {
        for (const text of [
            "Search your library for a card, then shuffle.",
            "Search your library for a basic land card, reveal it, then shuffle.",
        ]) {
            const outcome = compileCard(sorcery("Probe", "{G}", text));
            expect(outcome.state, text).toBe("unparsed");
            if (outcome.state === "unparsed")
                expect(outcome.gaps[0]?.attribution?.span, text).toBe(
                    "shuffle"
                );
        }
    });

    it("a second move of the same find is refused", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{B}",
                    "Search your library for a card, put that card into your graveyard, put it into your hand, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("descriptor classes the shared sub-grammar must not widen for the frame", () => {
    it("a type/subtype or-list sharing one 'card' has no OR filter shape and is refused", () => {
        for (const text of [
            "Search your library for an Elf or land card, put that card into your hand, then shuffle.",
            "Return target Elf or land card from your graveyard to your hand.",
        ])
            expect(compileCard(sorcery("Probe", "{G}", text)).state, text).toBe(
                "unparsed"
            );
    });

    it("a card-type adjective before 'permanent card' is refused", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Search your library for an artifact permanent card, put it onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });
});

describe("shuffle frame (CR 701.24a)", () => {
    it("a member that is not a frame refuses the chain whole: a sentence is read by frames or by the table, never half each", () => {
        const outcome = compileCard(
            sorcery(
                "Probe",
                "{G}",
                "Search your library for a creature card, reveal it, put it into your hand, then shuffle and draw a card."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("'shuffle your library' and 'shuffle them' are not forms of the frame", () => {
        for (const text of [
            "Search your library for a card, put that card into your hand, then shuffle your library.",
            "Search your library for a card, put that card into your hand, then shuffle them.",
        ])
            expect(compileCard(sorcery("Probe", "{B}", text)).state).toBe(
                "unparsed"
            );
    });

    it("a bare 'Shuffle.' sentence is a shuffle of your library", () => {
        const def = compiledDefinition(
            sorcery("Probe", "{U}", "Draw a card. Shuffle.")
        );
        expect(def.effects?.map((e) => e.op)).toEqual(["draw", "libraryLook"]);
    });
});

describe("lowering invariants", () => {
    it("the find is optional exactly when a quality is stated or the quantity is a range (CR 701.23b)", () => {
        const stated = compiledDefinition(
            sorcery(
                "Probe",
                "{G}",
                "Search your library for a land card, put that card into your hand, then shuffle."
            )
        ).effects?.[0] as { count: unknown };
        const plain = compiledDefinition(
            sorcery(
                "Probe",
                "{B}",
                "Search your library for a card, put that card into your hand, then shuffle."
            )
        ).effects?.[0] as { count: unknown };
        expect(stated.count).toEqual({ min: 0, max: 1 });
        expect(plain.count).toBe(1);
    });

    it("every frame reads the binding the search wrote, in printed order", () => {
        const effects = compiledDefinition(
            oracleCard({
                name: "Mystical Tutor",
                manaCost: "{U}",
                typeLine: "Instant",
                oracleText:
                    "Search your library for an instant or sorcery card, reveal it, then shuffle and put that card on top.",
            })
        ).effects as { op: string; bind?: string; cards?: { ref: string } }[];
        expect(effects.map((e) => e.op)).toEqual([
            "choice",
            "reveal",
            "libraryLook",
            "moveZone",
        ]);
        const bind = effects[0]!.bind;
        expect(effects[1]!.cards?.ref).toBe(bind);
        expect(effects[3]!.cards?.ref).toBe(bind);
    });

    it("the quarantined forms carry a golden fixture and reach ready: the acceptance cards graduate", () => {
        for (const name of [
            "Mystical Tutor",
            "Demonic Tutor",
            "Diabolic Intent",
            "Vampiric Tutor",
            "Lay of the Land",
            "Rampant Growth",
        ]) {
            const fixture = GOLDEN_FIXTURES.find(
                (row) => row.card.name === name
            );
            const card =
                fixture?.card ??
                {
                    "Demonic Tutor": sorcery(
                        "Demonic Tutor",
                        "{1}{B}",
                        "Search your library for a card, put that card into your hand, then shuffle."
                    ),
                    "Diabolic Intent": sorcery(
                        "Diabolic Intent",
                        "{1}{B}",
                        "As an additional cost to cast this spell, sacrifice a creature.\nSearch your library for a card, put that card into your hand, then shuffle."
                    ),
                    "Vampiric Tutor": oracleCard({
                        name: "Vampiric Tutor",
                        manaCost: "{B}",
                        typeLine: "Instant",
                        oracleText:
                            "Search your library for a card, then shuffle and put that card on top. You lose 2 life.",
                    }),
                    "Rampant Growth": sorcery(
                        "Rampant Growth",
                        "{1}{G}",
                        "Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle."
                    ),
                }[name as "Demonic Tutor"];
            expect(compileCard(card!).state, name).toBe("ready");
        }
    });
});

describe("frameOf — the Clause Family head a span opens", () => {
    it("names the frame of a member or of a gap's unconsumed span, and nothing for the rest", () => {
        expect(frameOf("Search your library for a card named Avarax")).toBe(
            "search"
        );
        expect(
            frameOf("search your library for any number of land cards")
        ).toBe("search");
        expect(frameOf("put that card into its owner's hand")).toBe("moveZone");
        expect(frameOf("Then that player shuffles")).toBe("shuffle");
        expect(frameOf("shuffle and put those cards on top in any order")).toBe(
            "shuffle"
        );
        expect(frameOf("Shuffle your graveyard into your library")).toBeNull();
        expect(frameOf("Whenever a Goblin you control attacks")).toBeNull();
    });
});
