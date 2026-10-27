// The Verb Frame layer (issue #6557, CR 701.23a, CR 701.20a, CR 701.24a,
// CR 608.2c): "Search your library for <quantity> <descriptor>[, reveal
// <pronoun>], put <pronoun> <into|onto|on> <zone>[ tapped], then shuffle" and
// its orderings, read as a chain of Op-shaped frames in place of the four
// retired whole-sentence kinds (`search-library-to-hand`, `-to-battlefield`,
// `-to-top`, `shuffle-searched-library`).
//
//  1. GOLDEN — one real corpus card per ARGUMENT CLASS a frame accepts (not
//     per card): the search's quantity and descriptor classes and its reveal
//     pronouns, the moveZone's pronoun × destination × tapped and — issue
//     #6631 — its other object classes (the site's anaphora, the source, an
//     announced target, a sweep, a graveyard's end card, a chosen card from
//     your hand or graveyard, an own permanent), the shuffle's three
//     spellings. Compared whole where the card is one line, by effects
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
import {
    ANY_NUMBER,
    frameOf,
    readFrameChain,
} from "../grammar/shared/verbFrames";
import { oracleCard, parseContext } from "./oracle.fixture";

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

    it("refuses the quantity classes still undeclared: 'exactly two' (Burning-Rune Demon), 'up to X' (Boundless Realms), 'up to one'", () => {
        for (const text of [
            "Search your library for exactly two cards not named Probe that have different names, put them into your hand, then shuffle.",
            "Search your library for up to X basic land cards, put them onto the battlefield tapped, then shuffle.",
            "Search your library for up to one land card, put it into your hand, then shuffle.",
        ]) {
            const outcome = compileCard(sorcery("Probe", "{X}{U}", text));
            expect(outcome.state, text).toBe("unparsed");
            if (outcome.state === "unparsed")
                expect(outcome.gaps[0]?.attribution?.span).toMatch(
                    /^Search your library for/
                );
        }
    });

    it("refuses an undeclared descriptor class: a chosen type, a controller", () => {
        for (const text of [
            "Search your library for a creature card you control, reveal it, put it into your hand, then shuffle.",
            "Search your library for a creature card of the chosen type, reveal it, put it into your hand, then shuffle.",
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

describe("search frame — the argument classes of issue #6622 (CR 701.23a)", () => {
    const creature = (
        name: string,
        manaCost: string,
        typeLine: string,
        oracleText: string
    ) =>
        oracleCard({
            name,
            manaCost,
            typeLine,
            oracleText,
            power: "3",
            toughness: "3",
        });
    /** A "you may" trigger: the may-gate around the frames. */
    const mayGate = (prompt: string, then: object[]) => [
        {
            op: "mayPay",
            player: "controller",
            prompt: `${prompt}?`,
            bind: "$may2",
        },
        { op: "if", predicate: { binding: "$may2" }, then },
    ];

    it("'a card named <self>' (CR 201.2): Avarax — the name is a stated quality, so the find is optional (CR 701.23b)", () => {
        const def = compiledDefinition(
            creature(
                "Avarax",
                "{3}{R}{R}",
                "Creature — Beast",
                "Haste\nWhen this creature enters, you may search your library for a card named Avarax, reveal it, put it into your hand, then shuffle.\n{1}{R}: This creature gets +1/+0 until end of turn."
            )
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys(
                mayGate(
                    "Search your library for a card named Avarax, reveal it, put it into your hand, then shuffle",
                    [
                        search(
                            "a card named Avarax",
                            { name: "Avarax" },
                            { min: 0, max: 1 }
                        ),
                        reveal(),
                        move("hand"),
                        SHUFFLE,
                    ]
                )
            )
        );
    });

    it("'up to three cards named <self>': Howling Wolf", () => {
        const def = compiledDefinition(
            creature(
                "Howling Wolf",
                "{2}{G}{G}",
                "Creature — Wolf",
                "When this creature enters, you may search your library for up to three cards named Howling Wolf, reveal them, put them into your hand, then shuffle."
            )
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys(
                mayGate(
                    "Search your library for up to three cards named Howling Wolf, reveal them, put them into your hand, then shuffle",
                    [
                        search(
                            "up to three cards named Howling Wolf",
                            { name: "Howling Wolf" },
                            { min: 0, max: 3 }
                        ),
                        reveal(),
                        move("hand"),
                        SHUFFLE,
                    ]
                )
            )
        );
    });

    it("'any number of cards named <self>': Battalion Foot Soldier — an open count, clamped to the library", () => {
        const def = compiledDefinition(
            creature(
                "Battalion Foot Soldier",
                "{2}{W}",
                "Creature — Human Soldier",
                "When this creature enters, you may search your library for any number of cards named Battalion Foot Soldier, reveal them, put them into your hand, then shuffle."
            )
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys(
                mayGate(
                    "Search your library for any number of cards named Battalion Foot Soldier, reveal them, put them into your hand, then shuffle",
                    [
                        search(
                            "any number of cards named Battalion Foot Soldier",
                            { name: "Battalion Foot Soldier" },
                            { min: 0, max: ANY_NUMBER }
                        ),
                        reveal(),
                        move("hand"),
                        SHUFFLE,
                    ]
                )
            )
        );
    });

    it("'any number of <descriptor>': Iname, Death Aspect's Spirit cards into the graveyard", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Iname, Death Aspect",
                manaCost: "{4}{B}{B}",
                typeLine: "Legendary Creature — Spirit",
                oracleText:
                    "When Iname enters, you may search your library for any number of Spirit cards, put them into your graveyard, then shuffle.",
                power: "4",
                toughness: "4",
            })
        );
        expect(sortKeys(def.compiledTriggeredAbilities?.[0]?.effects)).toEqual(
            sortKeys(
                mayGate(
                    "Search your library for any number of Spirit cards, put them into your graveyard, then shuffle",
                    [
                        search(
                            "any number of Spirit cards",
                            { subtype: "Spirit" },
                            { min: 0, max: ANY_NUMBER }
                        ),
                        move("graveyard"),
                        SHUFFLE,
                    ]
                )
            )
        );
    });

    it("'a card named <another card>' is read as that English name (Asmoranomardicadaistinaculdacar's Cookbook)", () => {
        const chain = readFrameChain(
            "search your library for a card named The Underworld Cookbook, reveal it, put it into your hand, then shuffle",
            parseContext()
        );
        expect(chain?.ok).toBe(true);
        if (chain?.ok)
            expect(chain.value.frames[0]).toEqual({
                frame: "search",
                filter: { name: "The Underworld Cookbook" },
                phrase: "a card named The Underworld Cookbook",
                count: 1,
                upTo: false,
                reveal: "it",
            });
    });

    it("a name list is two finds and is refused: Bogbrew Witch's 'or', Alpine Houndmaster's 'and/or', a bare 'and a card named', a marker beside other words", () => {
        for (const text of [
            "Search your library for a card named Festering Newt or Bubbling Cauldron, put it onto the battlefield tapped, then shuffle.",
            "Search your library for a card named Alpine Watchdog and/or a card named Igneous Cur, reveal them, put them into your hand, then shuffle.",
            "Search your library for a card named Alpine Watchdog and a card named Igneous Cur, reveal them, put them into your hand, then shuffle.",
            "Search your library for a card named Alpine Watchdog and Igneous Cur, reveal it, put it into your hand, then shuffle.",
            "Search your library for a card named Probe Twin, reveal it, put it into your hand, then shuffle.",
        ])
            expect(compileCard(sorcery("Probe", "{B}", text)).state, text).toBe(
                "unparsed"
            );
    });

    it("a name with a comma is read whole (CR 201.2): ', ' inside a member opens no member (CR 608.2c) — Silver Surfer's 'Galactus, Devourer of Worlds'", () => {
        const surfer = compiledDefinition(
            sorcery(
                "Probe",
                "{B}",
                "Search your library for a card named Galactus, Devourer of Worlds, reveal it, put it into your hand, then shuffle."
            )
        );
        expect(surfer.effects?.[0]).toEqual(
            search(
                "a card named Galactus, Devourer of Worlds",
                { name: "Galactus, Devourer of Worlds" },
                { min: 0, max: 1 }
            )
        );
    });

    it("'with mana value X or less' reads the announced X (CR 107.3): Citanul Flute's {X} activation, Chord of Calling's {X} cost", () => {
        const flute = compiledDefinition(
            oracleCard({
                name: "Citanul Flute",
                manaCost: "{5}",
                typeLine: "Artifact",
                oracleText:
                    "{X}, {T}: Search your library for a creature card with mana value X or less, reveal it, put it into your hand, then shuffle.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(flute.activatedAbilities?.[0]?.effects).toEqual([
            search(
                "a creature card with mana value X or less",
                { type: "Creature", manaValueAtMost: { X: true } },
                { min: 0, max: 1 }
            ),
            reveal(),
            move("hand"),
            SHUFFLE,
        ]);
        const chord = compiledDefinition(
            oracleCard({
                name: "Chord of Calling",
                manaCost: "{X}{G}{G}{G}",
                typeLine: "Instant",
                oracleText:
                    "Convoke\nSearch your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(chord.effects).toEqual([
            search(
                "a creature card with mana value X or less",
                { type: "Creature", manaValueAtMost: { X: true } },
                { min: 0, max: 1 }
            ),
            move("battlefield"),
            SHUFFLE,
        ]);
    });

    it("X at a site that announces none is refused: a spell with no {X}, a trigger, a paid X (Taj-Nar Swordsmith)", () => {
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{2}{G}",
                    "Search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
        expect(
            compileCard(
                creature(
                    "Probe",
                    "{2}{G}",
                    "Creature — Elf",
                    "When this creature enters, search your library for a creature card with mana value X or less, put it onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
        expect(
            compileCard(
                creature(
                    "Taj-Nar Swordsmith",
                    "{3}{W}",
                    "Creature — Cat Soldier",
                    "When this creature enters, you may pay {X}. If you do, search your library for an Equipment card with mana value X or less, put that card onto the battlefield, then shuffle."
                )
            ).state
        ).toBe("unparsed");
    });

    it("a printed count of two or more is read and composes with the moveZone frame's 'exile them' (issue #6631): Foresight", () => {
        const outcome = compileCard(
            sorcery(
                "Foresight",
                "{1}{U}",
                "Search your library for three cards, exile them, then shuffle.\nDraw a card at the beginning of the next turn's upkeep."
            )
        );
        // The whole card reads; the smoke generator does not model a
        // library → exile move, but the golden fixtures of the multi-card
        // search (issue #5253) prove that form, so the row is `ready`.
        expect(outcome.state).toBe("ready");
        if (outcome.state === "ready") {
            expect(outcome.definition.effects?.slice(0, 2)).toEqual([
                search("three cards", null, 3),
                {
                    op: "moveZone",
                    cards: { ref: "$found1" },
                    player: "controller",
                    from: "library",
                    to: "exile",
                },
            ]);
        }
        const chain = readFrameChain(
            "Search your library for three cards, exile them, then shuffle",
            parseContext()
        );
        expect(chain?.ok).toBe(true);
        if (chain?.ok)
            expect(chain.value.frames.map((f) => f.frame)).toEqual([
                "search",
                "moveZone",
                "shuffle",
            ]);
    });

    it("' and ' joins two frames inside one member (CR 608.2c): Verdant Crescendo's 'and put it onto the battlefield tapped', Ruin in Their Wake's 'and reveal it'", () => {
        const put = readFrameChain(
            "Search your library for a basic land card and put it onto the battlefield tapped",
            parseContext()
        );
        expect(put?.ok).toBe(true);
        if (put?.ok)
            expect(put.value.frames.map((f) => f.frame)).toEqual([
                "search",
                "moveZone",
            ]);
        const revealed = readFrameChain(
            "Search your library for a basic land card and reveal it",
            parseContext()
        );
        // The find is revealed and put nowhere: the member reads, the chain
        // is refused — the next sentence of the card is where it goes.
        expect(revealed?.ok).toBe(false);
        if (revealed && !revealed.ok)
            expect(revealed.reason).toMatch(/put nowhere/);
    });

    it("an ' and ' whose right side opens no frame stays in the descriptor and is refused: Krosan Verge's two finds", () => {
        const chain = readFrameChain(
            "Search your library for a Forest card and a Plains card, put them onto the battlefield tapped, then shuffle",
            parseContext()
        );
        expect(chain?.ok).toBe(false);
        if (chain && !chain.ok)
            expect(chain.fragment).toBe(
                "Search your library for a Forest card and a Plains card"
            );
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

    it("refuses a destination outside the declared classes: another player's hand, 'into exile' (the verb is the destination, CR 406.1), 'into the battlefield'", () => {
        for (const text of [
            "Search your library for a card, put that card into its owner's hand, then shuffle.",
            "Search your library for a card, put that card into exile, then shuffle.",
            "Search your library for a card, put that card into the battlefield, then shuffle.",
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
    it("a pronoun with no referent: 'Put it into your hand' opens no search, and a spell's site names no object either (CR 608.2h)", () => {
        const outcome = compileCard(
            sorcery("Probe", "{U}", "Put it into your hand, then shuffle.")
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]?.reason).toContain(
                '"it" names no object at this site'
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
            // issue #6622 — the argument classes' fixtures: a named card, an
            // open count, the announced-X ceiling at three sites.
            "Avarax",
            "Iname, Death Aspect",
            "Citanul Flute",
            "Reshape",
            "Green Sun's Zenith",
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

const creature = (
    name: string,
    manaCost: string,
    typeLine: string,
    oracleText: string,
    power: string,
    toughness: string
) => oracleCard({ name, manaCost, typeLine, oracleText, power, toughness });

/** The effects of a card's first triggered / activated ability, or its spell. */
function firstEffects(card: ReturnType<typeof oracleCard>) {
    const def = compiledDefinition(card);
    return (
        def.compiledTriggeredAbilities?.[0]?.effects ??
        def.activatedAbilities?.[0]?.effects ??
        def.effects
    );
}

describe("moveZone frame — object classes beyond the found card (issue #6631)", () => {
    it("the site's 'it' exiled behind a dies head: Cyclopean Mummy (CR 400.7e, CR 701.13a)", () => {
        expect(
            firstEffects(
                creature(
                    "Cyclopean Mummy",
                    "{1}{B}",
                    "Creature — Zombie",
                    "When this creature dies, exile it.",
                    "2",
                    "1"
                )
            )
        ).toEqual([
            { op: "moveZone", target: { ref: "$source" }, to: "exile" },
        ]);
    });

    it("the site's 'it' on top of its owner's library behind 'you may': Avenging Angel — `library-top`, the one value that repositions a GRAVEYARD card (a `position` there is ignored and the card is bottomed)", () => {
        expect(
            firstEffects(
                creature(
                    "Avenging Angel",
                    "{3}{W}{W}",
                    "Creature — Angel",
                    "Flying\nWhen this creature dies, you may put it on top of its owner's library.",
                    "3",
                    "3"
                )
            )
        ).toEqual([
            {
                op: "mayPay",
                player: "controller",
                prompt: "Put it on top of its owner's library?",
                bind: "$may1",
            },
            {
                op: "if",
                predicate: { binding: "$may1" },
                then: [
                    {
                        op: "moveZone",
                        target: { ref: "$source" },
                        to: "library-top",
                    },
                ],
            },
        ]);
    });

    it("the source on top of its owner's library: Wayward Soul (CR 400.3)", () => {
        expect(
            firstEffects(
                creature(
                    "Wayward Soul",
                    "{2}{U}{U}",
                    "Creature — Spirit",
                    "Flying\n{U}: Put this creature on top of its owner's library.",
                    "3",
                    "2"
                )
            )
        ).toEqual([
            {
                op: "moveZone",
                target: { ref: "$source" },
                to: "library",
                position: 1,
            },
        ]);
    });

    it("a chain of two: 'exile it, then return the top creature card of your graveyard to the battlefield' — Mistmoon Griffin (CR 404.2)", () => {
        expect(
            firstEffects(
                creature(
                    "Mistmoon Griffin",
                    "{3}{W}",
                    "Creature — Griffin",
                    "Flying\nWhen this creature dies, exile it, then return the top creature card of your graveyard to the battlefield.",
                    "2",
                    "2"
                )
            )
        ).toEqual([
            { op: "moveZone", target: { ref: "$source" }, to: "exile" },
            {
                op: "moveZone",
                target: {
                    zone: "graveyard",
                    position: "top",
                    player: "controller",
                    filter: { type: "Creature" },
                },
                to: "battlefield",
            },
        ]);
    });

    it("a graveyard's top card on the bottom of your library: Soldevi Digger (CR 404.2, CR 401.2)", () => {
        expect(
            firstEffects(
                oracleCard({
                    name: "Soldevi Digger",
                    manaCost: "{2}",
                    typeLine: "Artifact",
                    oracleText:
                        "{2}: Put the top card of your graveyard on the bottom of your library.",
                })
            )
        ).toEqual([
            {
                op: "moveZone",
                target: {
                    zone: "graveyard",
                    position: "top",
                    player: "controller",
                },
                to: "library",
            },
        ]);
    });

    it("a chosen card from your hand onto the battlefield tapped, the 'may' folded into the pick: Elvish Pioneer (CR 110.5b)", () => {
        expect(
            firstEffects(
                creature(
                    "Elvish Pioneer",
                    "{G}",
                    "Creature — Elf Druid",
                    "When this creature enters, you may put a basic land card from your hand onto the battlefield tapped.",
                    "1",
                    "1"
                )
            )
        ).toEqual([
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: { type: "Land", supertype: "Basic" },
                count: { min: 0, max: 1 },
                prompt: "You may put a basic land card from your hand onto the battlefield tapped.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
                tapped: true,
            },
        ]);
    });

    it("'<Subtype> permanent card' from your hand keeps the catalogue's excludeType shape: Goblin Lackey, byte-identical to its kind-era definition", () => {
        const text =
            "Whenever this creature deals damage to a player, you may put a Goblin permanent card from your hand onto the battlefield.";
        expect(
            firstEffects(
                creature(
                    "Goblin Lackey",
                    "{R}",
                    "Creature — Goblin",
                    text,
                    "1",
                    "1"
                )
            )
        ).toEqual([
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                filter: {
                    subtype: "Goblin",
                    excludeType: ["Instant", "Sorcery"],
                },
                count: { min: 0, max: 1 },
                prompt: "You may put a Goblin permanent card from your hand onto the battlefield.",
                bind: "$picked",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked" },
                player: "controller",
                from: "hand",
                to: "battlefield",
            },
        ]);
    });

    it("two cards from your hand on the bottom of your library behind a ', then' chain, and an own permanent returned: Sawtooth Loon", () => {
        const def = compiledDefinition(
            creature(
                "Sawtooth Loon",
                "{2}{W}{U}",
                "Creature — Bird",
                "Flying\nWhen this creature enters, return a white or blue creature you control to its owner's hand.\nWhen this creature enters, draw two cards, then put two cards from your hand on the bottom of your library.",
                "2",
                "2"
            )
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual([
            {
                op: "choice",
                kind: "choose-permanents",
                player: "controller",
                zone: "battlefield",
                filter: { type: "Creature", color: ["W", "U"] },
                count: 1,
                prompt: "Return a white or blue creature you control to its owner's hand.",
                bind: "$bounce1",
            },
            {
                op: "forEach",
                select: { set: "bound", ref: "$bounce1" },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
        expect(def.compiledTriggeredAbilities?.[1]?.effects).toEqual([
            { op: "draw", player: "controller", count: 2 },
            {
                op: "choice",
                kind: "choose-hand-card",
                player: "controller",
                zone: "hand",
                count: 2,
                prompt: "Put two cards from your hand on the bottom of your library.",
                bind: "$picked1",
            },
            {
                op: "moveZone",
                cards: { ref: "$picked1" },
                player: "controller",
                from: "hand",
                to: "library",
            },
        ]);
    });

    it("an announced graveyard card to the battlefield tapped: Undergrowth Recon (CR 110.5b)", () => {
        expect(
            firstEffects(
                oracleCard({
                    name: "Undergrowth Recon",
                    manaCost: "{1}{G}{G}",
                    typeLine: "Enchantment",
                    oracleText:
                        "At the beginning of your upkeep, return target land card from your graveyard to the battlefield tapped.",
                })
            )
        ).toEqual([
            {
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
                tapped: true,
            },
        ]);
    });

    it("an announced permanent on the bottom of its owner's library: Condemn (CR 401.2)", () => {
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Condemn",
                    manaCost: "{W}",
                    typeLine: "Instant",
                    oracleText:
                        "Put target attacking creature on the bottom of its owner's library. Its controller gains life equal to its toughness.",
                })
            ).effects
        ).toEqual([
            {
                op: "moveZone",
                target: { target: 0 },
                to: "library",
                position: "bottom",
                bind: "$that1",
            },
            {
                op: "gainLife",
                player: { ref: "$that1.controller" },
                amount: { ref: "$that1.toughness" },
            },
        ]);
    });

    it("an announced graveyard card on the bottom of its owner's library is pushed, no position: Chrome Companion", () => {
        expect(
            compiledDefinition(
                creature(
                    "Chrome Companion",
                    "{2}",
                    "Artifact Creature — Dog",
                    "Whenever this creature becomes tapped, you gain 1 life.\n{2}, {T}: Put target card from a graveyard on the bottom of its owner's library.",
                    "2",
                    "1"
                )
            ).activatedAbilities?.[0]?.effects
        ).toEqual([{ op: "moveZone", target: { target: 0 }, to: "library" }]);
    });

    it("a comma inside a type list is not a chain join: Hoodwink's 'target artifact, enchantment, or land' (CR 608.2c)", () => {
        const def = compiledDefinition(
            oracleCard({
                name: "Hoodwink",
                manaCost: "{1}{U}",
                typeLine: "Instant",
                oracleText:
                    "Return target artifact, enchantment, or land to its owner's hand.",
            })
        );
        expect(def.effects).toEqual([
            { op: "moveZone", target: { target: 0 }, to: "hand" },
        ]);
        expect(def.targetRequirement).toEqual({
            type: ["Artifact", "Enchantment", "Land"],
            count: 1,
        });
    });

    it("re-pins the kind-era forms byte for byte: Reanimate (under your control), Hurkyl's Recall (a sweep an announced player owns)", () => {
        expect(
            compiledDefinition(
                sorcery(
                    "Reanimate",
                    "{B}",
                    "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value."
                )
            ).effects
        ).toEqual([
            {
                op: "moveZone",
                target: { target: 0 },
                to: "battlefield",
                controller: "controller",
                bind: "$that1",
            },
            {
                op: "loseLife",
                player: "controller",
                amount: { ref: "$that1.manaValue" },
            },
        ]);
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Hurkyl's Recall",
                    manaCost: "{1}{U}",
                    typeLine: "Instant",
                    oracleText:
                        "Return all artifacts target player owns to their hand.",
                })
            ).effects
        ).toEqual([
            {
                op: "forEach",
                select: {
                    set: "permanents",
                    zone: "battlefield",
                    filter: { type: "Artifact" },
                    controller: { target: 0 },
                },
                effects: [
                    { op: "moveZone", target: { ref: "$each" }, to: "hand" },
                ],
            },
        ]);
    });

    it("a group of targets wider than one goes to their owners' hands; one target does not (CR 400.3)", () => {
        const group = compiledDefinition(
            sorcery(
                "Probe",
                "{1}{U}",
                "Return up to two target nonblack creatures to their owners' hands."
            )
        );
        expect(group.effects).toEqual([
            { op: "moveZone", target: { target: 0 }, to: "hand" },
            { op: "moveZone", target: { target: 1 }, to: "hand" },
        ]);
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{U}",
                    "Return target creature to their owners' hands."
                )
            ).state
        ).toBe("unparsed");
    });

    it("refuses a battlefield object sent to exile or a graveyard by this frame (the target shape would skip it): the source at an attack head, 'that creature', a non-permanent chosen card onto the battlefield", () => {
        for (const [typeLine, text] of [
            ["Creature — Turtle", "Whenever this creature attacks, exile it."],
            [
                "Creature — Turtle",
                "{1}: Put this creature into its owner's graveyard.",
            ],
            [
                "Creature — Turtle",
                "When this creature enters, you may put a sorcery card from your graveyard onto the battlefield.",
            ],
            [
                "Creature — Turtle",
                "When this creature enters, you may put an instant card from your hand onto the battlefield.",
            ],
        ] as const)
            expect(
                compileCard(
                    oracleCard({
                        name: "Probe",
                        manaCost: "{1}{G}",
                        typeLine,
                        oracleText: text,
                        power: "1",
                        toughness: "1",
                    })
                ).state
            ).toBe("unparsed");
    });

    it("refuses the undeclared object classes by name: 'X cards' (a cost's quantity), 'any number of', 'from a graveyard' (no one owner's zone), the top card of a library put anywhere but exile (the exile Op is the only move that names it), 'into exile', a sweep to one hand", () => {
        for (const text of [
            "Exile X creature cards from your graveyard.",
            "Exile any number of cards from your graveyard.",
            "Exile a card from a graveyard.",
            "Put the top card of your library into your graveyard.",
            "Return all creatures to its owner's hand.",
        ])
            expect(compileCard(sorcery("Probe", "{B}", text)).state).toBe(
                "unparsed"
            );
    });

    it("refuses the pairs the sentence table still reads, so each keeps one reader: a battlefield permanent exiled, the source returned from your graveyard, a sweep onto the battlefield", () => {
        // Each of these compiles — by the TABLE (the exile kind, the
        // return-self kind, the graveyard sweep), never ambiguously.
        expect(
            compileCard(sorcery("Probe", "{W}", "Exile target creature.")).state
        ).not.toBe("unparsed");
        expect(
            compileCard(
                sorcery(
                    "Probe",
                    "{G}",
                    "Return all enchantment cards from your graveyard to the battlefield."
                )
            ).state
        ).not.toBe("unparsed");
    });
});

// ── the `sacrifice` frame (issue #6630, pilot 2) ─────────────────────────────
//
// One golden per ARGUMENT CLASS: the object (a named permanent — the source,
// "it" — or "<quantity> <descriptor>"; "enchanted creature" is refused), the quantity
// (a count, "X", "that many", "any number of"), the player (the imperative's
// controller, "target player", "each player", "each opponent") and the CR
// 118.12a rider. The classes the retired kinds read keep their own fixtures,
// re-pinned byte for byte in `playerEdict.test.ts`, `superlativeEdict.test.ts`,
// `sacrificeSource.test.ts`, `sacrificeUnless.test.ts` and
// `handPutAndThatManySacrifice.test.ts` (lost = 0 by test); here are the
// classes the frame ADDS, and a refusal per undeclared class.

const edict = (
    filter: object,
    phrase: string,
    count: unknown = 1,
    player: unknown = "controller",
    bind = "$sacrifice1"
) => [
    {
        op: "choice",
        kind: "sacrifice-permanents",
        player,
        zone: "battlefield",
        filter,
        count,
        prompt: `Sacrifice ${phrase}.`,
        bind,
    },
    { op: "sacrifice", permanents: { ref: bind } },
];
const EVERY_PERMANENT = {
    type: [
        "Artifact",
        "Battle",
        "Creature",
        "Enchantment",
        "Land",
        "Planeswalker",
    ],
};
const refusedSpan = (card: ReturnType<typeof oracleCard>) => {
    const outcome = compileCard(card);
    expect(outcome.state, card.oracleText).toBe("unparsed");
    return outcome.state === "unparsed"
        ? outcome.gaps[0]?.attribution?.span
        : undefined;
};
const refusedPath = (card: ReturnType<typeof oracleCard>) => {
    const outcome = compileCard(card);
    return outcome.state === "unparsed"
        ? outcome.gaps[0]?.attribution?.path
        : undefined;
};
const horror = (name: string, oracleText: string) =>
    oracleCard({
        name,
        manaCost: "{1}{B}",
        typeLine: "Creature — Horror",
        oracleText,
        power: "2",
        toughness: "2",
    });

describe("sacrifice frame — the object argument (CR 701.21a)", () => {
    it("the imperative edict, 'Sacrifice a creature': the controller's own pick — Accursed Centaur, whole", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (row) => row.card.name === "Accursed Centaur"
        )!;
        expect(sortKeys(compiledDefinition(fixture.card))).toEqual(
            sortKeys(fixture.expected)
        );
    });

    it("a type disjunction: Dredge's 'a creature or land' is one filter, then the next sentence", () => {
        const text = "Sacrifice a creature or land.\nDraw a card.";
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Dredge",
                    manaCost: "{B}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).effects
        ).toEqual([
            ...edict({ type: ["Creature", "Land"] }, "a creature or land"),
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("'nontoken' is the filter's isToken: false (CR 111.1) — Forbidden Ritual's first sentence", () => {
        expect(
            compiledDefinition(
                sorcery("Probe", "{B}", "Sacrifice a nontoken permanent.")
            ).effects
        ).toEqual(
            edict(
                { ...EVERY_PERMANENT, isToken: false },
                "a nontoken permanent"
            )
        );
    });

    it("'enchanted creature' is refused, even at an Aura's own site: an Aura on an opponent's creature names a permanent its controller cannot sacrifice (CR 701.21a)", () => {
        const aura = oracleCard({
            name: "Probe",
            manaCost: "{B}",
            typeLine: "Enchantment — Aura",
            oracleText: "Enchant creature\n{B}: Sacrifice enchanted creature.",
        });
        expect(refusedSpan(aura)).toBe("Sacrifice enchanted creature");
    });

    it("the verb agrees with its subject, and 'of their choice' needs a player head: 'You sacrifices', 'Each player sacrifice', 'Sacrifice a creature of their choice' are refused", () => {
        for (const text of [
            "You sacrifices a creature.",
            "Each player sacrifice a creature.",
            "Sacrifice a creature of their choice.",
        ])
            expect(refusedSpan(sorcery("Probe", "{B}", text))).toBe(
                text.slice(0, -1)
            );
    });

    it("'another <descriptor>' and '<descriptor> other than this <noun>' exclude the source: Lord of the Pit's sentence; 'other than that creature' is refused", () => {
        const def = compiledDefinition(
            horror(
                "Probe",
                "At the beginning of your upkeep, sacrifice a creature other than this creature."
            )
        );
        expect(def.compiledTriggeredAbilities?.[0]?.effects).toEqual(
            edict(
                { type: "Creature", excludeSource: true },
                "a creature other than this creature"
            )
        );
        expect(
            compiledDefinition(
                sorcery("Probe", "{B}", "Sacrifice another creature.")
            ).effects
        ).toEqual(
            edict({ type: "Creature", excludeSource: true }, "another creature")
        );
        expect(
            refusedSpan(
                horror(
                    "Probe",
                    "At the beginning of your upkeep, sacrifice a creature other than that creature."
                )
            )
        ).toBe("Sacrifice a creature other than that creature");
    });

    it("refuses an undeclared object class by name, the span the whole member: 'all …', 'two other …', a named card, 'half the creatures'", () => {
        for (const text of [
            "Sacrifice all creatures you control.",
            "Sacrifice two other creatures.",
            "Sacrifice a creature named Spitting Drake.",
            "Target opponent sacrifices half the creatures they control of their choice.",
        ]) {
            const card = sorcery("Probe", "{B}", text);
            expect(refusedSpan(card)).toBe(text.slice(0, -1));
            expect(refusedPath(card)).toEqual(["effect clause", "verb frame"]);
        }
    });

    it("a named permanent is its controller's to sacrifice: 'Target player sacrifices it' is refused", () => {
        expect(
            refusedSpan(sorcery("Probe", "{B}", "Target player sacrifices it."))
        ).toBe("Target player sacrifices it");
    });
});

describe("sacrifice frame — the quantity argument (CR 107.3, CR 120.3)", () => {
    it("'X' under 'each player': Tectonic Break, whole — a golden lifts the runtime-sized pick out of quarantine", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (row) => row.card.name === "Tectonic Break"
        )!;
        const outcome = compileCard(fixture.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed")
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(fixture.expected)
            );
    });

    it("'another' under 'you may … If you do': Brawl-Bash Ogre, whole — the golden lifts the runtime-binding gate out of quarantine", () => {
        const fixture = GOLDEN_FIXTURES.find(
            (row) => row.card.name === "Brawl-Bash Ogre"
        )!;
        const outcome = compileCard(fixture.card);
        expect(outcome.state).toBe("ready");
        if (outcome.state !== "unparsed")
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(fixture.expected)
            );
    });

    it("'any number of': a 0-up range the chooser sizes (Renounce's first sentence)", () => {
        const outcome = compileCard(
            sorcery("Probe", "{1}{W}", "Sacrifice any number of permanents.")
        );
        // No corpus card prints the form alone — every one counts "the
        // permanents sacrificed this way" next, the next slice — so the
        // form is a probe here and stays quarantined on a real card.
        expect(outcome.state).toBe("quarantine");
        if (outcome.state !== "unparsed")
            expect(outcome.definition.effects).toEqual(
                edict(EVERY_PERMANENT, "any number of permanents", {
                    min: 0,
                    max: 99,
                })
            );
    });

    it("a quantity and a noun that disagree in number are refused: 'two creature', 'X land', 'any number of creature'", () => {
        for (const text of [
            "Sacrifice two creature.",
            "Sacrifice X land.",
            "Sacrifice any number of creature.",
        ])
            expect(refusedSpan(sorcery("Probe", "{B}", text))).toBe(
                text.slice(0, -1)
            );
    });
});

describe("sacrifice frame — the rider and the chain (CR 118.12a, CR 608.2c)", () => {
    it("'unless you <payment>' on an edict, or with any payer but you, is refused: the rider spares a NAMED permanent", () => {
        for (const text of [
            "When this creature enters, sacrifice a creature unless you pay {2}.",
            "When this creature enters, sacrifice it unless they pay {2}.",
            "When this creature enters, sacrifice it unless any player pays {3}.",
        ])
            // The member is reported capitalised, as the sentence grammar
            // sees it behind the head.
            expect(refusedSpan(horror("Probe", text))).toBe(
                "S" + text.slice("When this creature enters, s".length, -1)
            );
    });

    it("an 'and' joining a clause the frame does not read refuses the member whole: Phyrexian War Beast", () => {
        expect(
            refusedSpan(
                horror(
                    "Phyrexian War Beast",
                    "When this creature leaves the battlefield, sacrifice a land and this creature deals 1 damage to you."
                )
            )
        ).toBe("Sacrifice a land and this creature deals 1 damage to you");
    });

    it("a sacrifice chain hands a non-frame tail back to the `, then` rule: 'Sacrifice a creature, then draw a card'", () => {
        expect(
            compiledDefinition(
                sorcery(
                    "Probe",
                    "{B}",
                    "Sacrifice a creature, then draw a card."
                )
            ).effects
        ).toEqual([
            ...edict({ type: "Creature" }, "a creature"),
            { op: "draw", player: "controller", count: 1 },
        ]);
    });

    it("a comma inside the descriptor stays in the member — the chain splits on ', then' alone: Braids, Cabal Minion", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Braids, Cabal Minion",
                manaCost: "{2}{B}{B}",
                typeLine: "Legendary Creature — Human Minion",
                oracleText:
                    "At the beginning of each player's upkeep, that player sacrifices an artifact, creature, or land.",
                power: "2",
                toughness: "2",
            })
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state !== "unparsed")
            expect(
                outcome.definition.compiledTriggeredAbilities?.[0]?.effects
            ).toEqual(
                edict(
                    { type: ["Artifact", "Creature", "Land"] },
                    "an artifact, creature, or land",
                    1,
                    { ref: "$event.activePlayerId" }
                )
            );
    });

    it("'it' behind a find is the card the chain found, not the source — the member is refused rather than read as the source (CR 608.2c)", () => {
        // Before the referent check this compiled `ready` with
        // `sacrifice` on `$source`: the wrong permanent, silently. A
        // creature's trigger, not a sorcery: a spell has no source object
        // for "it" and refuses at the lowering whatever the frame read.
        const outcome = compileCard(
            horror(
                "Probe",
                "When this creature enters, search your library for a creature card, put it onto the battlefield, then sacrifice it."
            )
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("the frame is a `, then` tail after a table head: Perilous Research, whole", () => {
        const text = "Draw two cards, then sacrifice a permanent.";
        expect(
            compiledDefinition(
                oracleCard({
                    name: "Perilous Research",
                    manaCost: "{1}{U}",
                    typeLine: "Instant",
                    oracleText: text,
                })
            ).effects
        ).toEqual([
            { op: "draw", player: "controller", count: 2 },
            ...edict(EVERY_PERMANENT, "a permanent"),
        ]);
    });

    it("a delayed 'Sacrifice it at the beginning of the next end step' stays the trigger kind's — the frame refuses, the table reads", () => {
        const def = compiledDefinition(
            sorcery(
                "Probe",
                "{B}",
                "Create a 1/1 black Rat creature token. Sacrifice it at the beginning of the next end step."
            )
        );
        expect(def.effects?.[1]).toMatchObject({
            op: "delayedTrigger",
            timing: "next-end-step",
        });
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
        // The sacrifice frame: the imperative, or a player reference the
        // shared sub-grammar reads, with the verb — never a verb alone.
        expect(frameOf("Sacrifice all creatures you control")).toBe(
            "sacrifice"
        );
        expect(
            frameOf("Each opponent sacrifices a creature of their choice")
        ).toBe("sacrifice");
        expect(frameOf("That creature's controller sacrifices a land")).toBe(
            null
        );
        expect(frameOf("Whenever you sacrifice a creature")).toBeNull();
    });
});
