// Colour change, chosen on resolution: "<subject> becomes the color of your
// choice [until end of turn]" (CR 613.1e layer 5, CR 105.1/105.3, issue #4137).
//
// Four layers, each watching a different way this family can go wrong:
//
//  1. GOLDEN forms — a real corpus card must produce exactly the Compiled
//     Definition below: the permanent target with a duration and without one,
//     the two narrowed STACK phrases (an instant-or-sorcery spell, and
//     CR 115.2's spell-or-permanent union), and the source itself. Each is the
//     whole card, except Illusion — the front FACE of the split card
//     Illusion // Reality (CR 712), asserted on its own because the split
//     layout is another rule's subject; the face compiles byte-identically
//     inside the real card, which `goldenFixtures`-style whole-card evidence
//     for the union is not needed twice for.
//  2. REFUSALS — the neighbouring colour templates this rule must NOT read: a
//     plural target, "the color OR COLORS of your choice", a conjunct tail in
//     the duration slot, and a fronted duration whose grant hangs off the
//     colour that was picked. Each is a printed card, and each stays refused
//     under its own Grammar Gap key.
//  3. The two new TARGET phrases — each is exactly one spelling, and neither
//     may be read by a verb that acts on the battlefield (CR 112.1: half of
//     what the union announces is not there).
//  4. The DURATION, which is optional HERE and nowhere else: its absence is a
//     colour change that never reverts (CR 611.2a), so it must not be read as
//     "until end of turn" and must not refuse the line.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./fixtures";

/** The five modes a colour pick offers (CR 105.1 — never colourless). */
const COLOURS: ReadonlyArray<[string, string]> = [
    ["W", "White"],
    ["U", "Blue"],
    ["B", "Black"],
    ["R", "Red"],
    ["G", "Green"],
];

/** The `optionChoice` Op the rule emits, for a target and a duration. */
function colourPick(
    name: string,
    target: Record<string, unknown>,
    duration?: Record<string, unknown>
) {
    return {
        op: "optionChoice",
        prompt: `Choose a color (${name}).`,
        modes: COLOURS.map(([id, label]) => ({
            id,
            label,
            color: id,
            effects: [
                {
                    op: "setColor",
                    target,
                    colors: [id],
                    ...(duration === undefined ? {} : { duration }),
                },
            ],
        })),
    };
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

/**
 * WHERE the compiler gave up on every line of a card it refuses — the reason,
 * or the furthest sub-grammar path and the span it could not read.
 *
 * Every line, not the first: a refusal test whose card carries a SECOND unread
 * sentence goes on passing after the thing it guards stops guarding.
 */
function refusedAt(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} parsed, but should not have`);
    return outcome.gaps.map((gap) =>
        gap.attribution === undefined
            ? gap.reason
            : `${gap.attribution.path.join(" > ")}: ${gap.attribution.span}`
    );
}

describe("becomes the color of your choice (CR 613.1e)", () => {
    // A permanent target, with the duration the template usually prints.
    it("compiles the permanent target — Tidal Visionary, whole", () => {
        const oracleText =
            "{T}: Target creature becomes the color of your choice until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "8fc72080-8d4d-427d-ae30-065bc8ee9a28",
                        name: "Tidal Visionary",
                        manaCost: "{U}",
                        typeLine: "Creature — Merfolk Wizard",
                        oracleText,
                        power: "1",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Tidal Visionary",
                types: ["Creature"],
                subtypes: ["Merfolk", "Wizard"],
                manaCost: { U: 1 },
                power: 1,
                toughness: 1,
                oracleText,
                activatedAbilities: [
                    {
                        id: "tidal-visionary-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            colourPick(
                                "Tidal Visionary",
                                { target: 0 },
                                { phase: "end-of-turn" }
                            ),
                        ],
                        targetRequirement: { type: "Creature", count: 1 },
                    },
                ],
            })
        );
    });

    // CR 611.2a — no duration printed, so no reversion is emitted: the
    // reminder text says so in as many words, and the Op carries no
    // `duration` field at all rather than an "until end of turn" the card
    // never printed.
    it("compiles the INDEFINITE permanent form — Alchor's Tomb, whole", () => {
        const oracleText =
            "{2}, {T}: Target permanent you control becomes the color of your choice. (This effect lasts indefinitely.)";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "61473d8e-45f1-4753-918d-04918a466031",
                        name: "Alchor's Tomb",
                        manaCost: "{4}",
                        typeLine: "Artifact",
                        oracleText,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Alchor's Tomb",
                types: ["Artifact"],
                manaCost: { X: 4 },
                oracleText,
                activatedAbilities: [
                    {
                        id: "alchor-s-tomb-ability",
                        oracleText:
                            "{2}, {T}: Target permanent you control becomes the color of your choice.",
                        cost: { mana: { X: 2 }, tap: true },
                        useStack: true,
                        effects: [colourPick("Alchor's Tomb", { target: 0 })],
                        targetRequirement: {
                            type: [
                                "Artifact",
                                "Battle",
                                "Creature",
                                "Enchantment",
                                "Land",
                                "Planeswalker",
                            ],
                            count: 1,
                            controller: "you",
                        },
                    },
                ],
            })
        );
    });

    // CR 115.2 — a SPELL on the stack, narrowed by card type. Colour is a
    // characteristic (CR 109.3), and a spell is an object (CR 109.1), so the
    // stack is as legal a home for the change as the battlefield is.
    it("compiles the narrowed spell target — Vodalian Mystic, whole", () => {
        const oracleText =
            "{T}: Target instant or sorcery spell becomes the color of your choice.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "c7feecf0-5229-4c12-806a-16c9ab38e147",
                        name: "Vodalian Mystic",
                        manaCost: "{1}{U}",
                        typeLine: "Creature — Merfolk Wizard",
                        oracleText,
                        power: "1",
                        toughness: "1",
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Vodalian Mystic",
                types: ["Creature"],
                subtypes: ["Merfolk", "Wizard"],
                manaCost: { X: 1, U: 1 },
                power: 1,
                toughness: 1,
                oracleText,
                activatedAbilities: [
                    {
                        id: "vodalian-mystic-ability",
                        oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [colourPick("Vodalian Mystic", { target: 0 })],
                        targetRequirement: {
                            type: "spell",
                            count: 1,
                            spellTypeFilter: ["Instant", "Sorcery"],
                        },
                    },
                ],
            })
        );
    });

    // CR 115.2 — the lace template's union: one announced slot legal on either
    // side of the stack/battlefield line.
    it("compiles the spell-or-permanent union at the SPELL slot — Illusion", () => {
        const oracleText =
            "Target spell or permanent becomes the color of your choice until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "5af2689d-c45c-4d45-b6a9-f32e8410b336",
                        name: "Illusion",
                        manaCost: "{U}",
                        typeLine: "Instant",
                        oracleText,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Illusion",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText,
                effects: [
                    colourPick(
                        "Illusion",
                        { target: 0 },
                        { phase: "end-of-turn" }
                    ),
                ],
                targetRequirement: { type: "spell-or-permanent", count: 1 },
            })
        );
    });

    // CR 113.7 — the ability's own SOURCE, which announces no target at all:
    // the Op points at `$source`, and the ability carries no
    // `targetRequirement`.
    it("compiles the self form — Caldera Kavu's second ability", () => {
        const definition = compiled(
            oracleCard({
                oracleId: "7cdcfbdf-5ec7-451b-8c96-f19d75a4d76c",
                name: "Caldera Kavu",
                manaCost: "{2}{R}",
                typeLine: "Creature — Kavu",
                oracleText:
                    "{1}{B}: This creature gets +1/+1 until end of turn.\n{G}: This creature becomes the color of your choice until end of turn.",
                power: "2",
                toughness: "2",
            })
        );
        expect(definition.activatedAbilities?.[1]).toEqual({
            id: "caldera-kavu-ability-2",
            oracleText:
                "{G}: This creature becomes the color of your choice until end of turn.",
            cost: { mana: { G: 1 } },
            useStack: true,
            effects: [
                colourPick(
                    "Caldera Kavu",
                    { ref: "$source" },
                    { phase: "end-of-turn" }
                ),
            ],
        });
    });
});

describe("the graduates reach ready, not quarantine (ADR 0105 § 3)", () => {
    // `compiled` above only proves the line PARSED. A definition that parses
    // and then fails `validateEffectScript` is a quarantined card, which
    // graduates nothing — and the indefinite form did exactly that until the
    // shared builder stopped writing `duration: undefined` for it (a key the
    // validator rejects, where an ABSENT key is the legal encoding). Nothing
    // else here distinguishes the two: `toEqual` reads an undefined property
    // and a missing one as equal.
    const CARDS: ReadonlyArray<Parameters<typeof oracleCard>[0]> = [
        {
            oracleId: "61473d8e-45f1-4753-918d-04918a466031",
            name: "Alchor's Tomb",
            manaCost: "{4}",
            typeLine: "Artifact",
            oracleText:
                "{2}, {T}: Target permanent you control becomes the color of your choice. (This effect lasts indefinitely.)",
            power: undefined,
            toughness: undefined,
        },
        {
            oracleId: "c7feecf0-5229-4c12-806a-16c9ab38e147",
            name: "Vodalian Mystic",
            manaCost: "{1}{U}",
            typeLine: "Creature — Merfolk Wizard",
            oracleText:
                "{T}: Target instant or sorcery spell becomes the color of your choice.",
            power: "1",
            toughness: "1",
        },
        {
            oracleId: "79bf98c8-1169-477d-838e-2ebc0fa396dc",
            name: "Rainbow Crow",
            manaCost: "{3}{U}",
            typeLine: "Creature — Bird",
            oracleText:
                "Flying\n{1}: This creature becomes the color of your choice until end of turn.",
            power: "2",
            toughness: "2",
        },
    ];

    it.each(CARDS)("$name compiles to ready", (card) => {
        const outcome = compileCard(oracleCard(card));
        expect(
            outcome.state === "quarantine"
                ? outcome.reasons.map((reason) => reason.detail)
                : outcome.state
        ).toBe("ready");
    });
});

describe("the neighbours this rule refuses (fail-closed, ADR 0105 § 2)", () => {
    // A PLURAL announced slot: the requirement would need a count AND the
    // effect would need to fan out per target, and half of that is worse than
    // none (`targetFilter.ts` — the singular-only mandate).
    it("refuses a plural target — Sway of Illusion", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "9a7e2298-8855-43a7-8cb1-4b31e4058c3f",
                    name: "Sway of Illusion",
                    manaCost: "{1}{U}",
                    typeLine: "Instant",
                    oracleText:
                        "Any number of target creatures become the color of your choice until end of turn.\nDraw a card.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual([
            "effect clause: Any number of target creatures become the color of your choice until end of turn",
        ]);
    });

    // CR 105.2 — "the color OR COLORS of your choice" is a pick of a SUBSET of
    // the five, not one of them; five single-colour modes cannot express it,
    // and reading it as if they could would make Dream Coat a worse card that
    // looks like it works.
    it("refuses the multi-colour pick — Dream Coat", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "988aaf54-2e46-4afc-ae37-b0a01191a1f1",
                    name: "Dream Coat",
                    manaCost: "{U}",
                    typeLine: "Enchantment — Aura",
                    oracleText:
                        "Enchant creature\n{0}: Enchanted creature becomes the color or colors of your choice. Activate only once each turn.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual([
            "effect clause: Enchanted creature becomes the color or colors of your choice",
        ]);
    });

    // A conjunct tail where the duration belongs: the sentence is a pump AND a
    // colour change sharing one "until end of turn", which this rule does not
    // assemble. It keeps its own gap key (`… › duration › and becomes …`).
    it("refuses the conjunct tail — Wild Mongrel", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "e9441ab3-7a17-4f9b-a873-e5e82f6e9690",
                    name: "Wild Mongrel",
                    manaCost: "{1}{G}",
                    typeLine: "Creature — Dog",
                    oracleText:
                        "Discard a card: This creature gets +1/+1 and becomes the color of your choice until end of turn.",
                    power: "2",
                    toughness: "2",
                })
            )
        ).toEqual([
            "effect clause > duration: and becomes the color of your choice until end of turn",
        ]);
    });

    // A FRONTED duration, and a keyword grant whose quality is the colour that
    // was just picked ("hexproof from THAT color") — an anaphor no mode body
    // here binds. Its second line is refused for a reason of its own, and the
    // assertion names both so this card cannot start passing on the wrong one.
    it("refuses the fronted duration and its linked grant — Mondo Gecko", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "fa3ae120-756d-4c52-91f9-235767539d67",
                    name: "Mondo Gecko",
                    manaCost: "{1}{U}{U}",
                    typeLine: "Legendary Creature — Lizard Mutant",
                    oracleText:
                        "{1}, Discard a card: Until end of turn, Mondo Gecko becomes the color of your choice and gains hexproof from that color.\nWhenever Mondo Gecko deals combat damage to a player, draw a card for each color among permanents you control.",
                    power: "2",
                    toughness: "3",
                })
            )
        ).toEqual([
            "effect clause: Until end of turn, {self} becomes the color of your choice and",
            "effect clause: Draw a card for each color among permanents you control",
        ]);
    });
});

describe("the two new target phrases (CR 115.2)", () => {
    function instant(name: string, oracleText: string) {
        return oracleCard({
            name,
            manaCost: "{U}",
            typeLine: "Instant",
            oracleText,
            power: undefined,
            toughness: undefined,
        });
    }

    // Both phrases are read by EXACT spelling, so a narrowing neither of them
    // spells is still refused rather than silently dropped.
    it("refuses a spell phrase that is neither spelling", () => {
        expect(
            refusedAt(
                instant(
                    "Probe",
                    "Target artifact or enchantment spell becomes the color of your choice until end of turn."
                )
            )
        ).toEqual([
            "effect clause > target filter > object descriptor: artifact or enchantment spell",
        ]);
    });

    // CR 112.1 — half of the union is on the STACK, so a battlefield verb that
    // read it would act on some of its legal targets and no-op on the rest.
    // The colour change is the only verb here that works in both zones.
    it("lets no battlefield verb read the spell-or-permanent union", () => {
        expect(
            refusedAt(instant("Probe", "Destroy target spell or permanent."))
        ).toEqual([
            "a spell-or-permanent slot spans two zones; a battlefield verb reads one (CR 115.2)",
        ]);
    });

    // CR 701.6a — a counter cancels a SPELL; the union announces something
    // that may be a permanent, which nothing can counter.
    it("lets no counter read the spell-or-permanent union", () => {
        expect(
            refusedAt(instant("Probe", "Counter target spell or permanent."))
        ).toEqual(["effect clause: Counter target spell or permanent"]);
    });

    // The OTHER verb the narrowed spell phrase reaches through the shared
    // sub-grammar, evidenced rather than left to be rediscovered: a counter
    // announcing the same slot is correct (CR 701.6a on a spell), and it is
    // the only further form this ticket's target phrases open. No printed card
    // moves state on it today.
    it("lets a counter read the narrowed spell phrase, correctly", () => {
        expect(
            compiled(
                instant("Probe", "Counter target instant or sorcery spell.")
            )
        ).toMatchObject({
            effects: [{ op: "counter", target: { target: 0 } }],
            targetRequirement: {
                type: "spell",
                count: 1,
                spellTypeFilter: ["Instant", "Sorcery"],
            },
        });
    });
});

describe("the colour change's own selector is an allow-list", () => {
    function artifact(oracleText: string) {
        return oracleCard({
            name: "Probe",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText,
            power: undefined,
            toughness: undefined,
        });
    }

    // CR 115.4 — "any target" announces a slot a PLAYER can fill, and a player
    // has no colour. Lowered, the ability would be activated legally, the
    // player chosen legally, and nothing would happen.
    it("refuses 'any target'", () => {
        expect(
            refusedAt(
                artifact(
                    "{T}: Any target becomes the color of your choice until end of turn."
                )
            )
        ).toEqual(["a player has no color (CR 109.1)"]);
    });

    // CR 400.1 — a card in a graveyard is in neither zone the Op writes
    // (`setColorOverride` reaches a permanent or a spell).
    it("refuses a card in a graveyard", () => {
        expect(
            refusedAt(
                artifact(
                    "{T}: Target creature card in your graveyard becomes the color of your choice."
                )
            )
        ).toEqual([
            "a colour change reaches the battlefield and the stack (CR 613.1e)",
        ]);
    });
});

describe("the duration is optional HERE and read when printed", () => {
    function artifact(oracleText: string) {
        return oracleCard({
            name: "Probe",
            manaCost: "{2}",
            typeLine: "Artifact",
            oracleText,
            power: undefined,
            toughness: undefined,
        });
    }

    /** The `duration` the emitted `setColor` carries, or `undefined`. */
    function durationOf(card: ReturnType<typeof oracleCard>) {
        const ops = compiled(card).activatedAbilities?.[0]?.effects?.[0];
        const mode = (ops as { modes?: { effects?: unknown[] }[] }).modes?.[0];
        return (mode?.effects?.[0] as { duration?: unknown }).duration;
    }

    it("emits no duration field when the line prints none", () => {
        expect(
            durationOf(
                artifact(
                    "{T}: Target permanent becomes the color of your choice."
                )
            )
        ).toBeUndefined();
    });

    it("reads the printed duration rather than assuming one", () => {
        expect(
            durationOf(
                artifact(
                    "{T}: Target permanent becomes the color of your choice until end of combat."
                )
            )
        ).toEqual({ phase: "end-of-combat" });
    });

    // A tail that is not a duration is a sentence this grammar has not read,
    // not a duration to shrug off: the phrase must END at the colour clause
    // or at a duration phrase, and nowhere else.
    it("refuses a tail that is not a duration", () => {
        expect(
            refusedAt(
                artifact(
                    "{T}: Target permanent becomes the color of your choice for as long as this artifact remains on the battlefield."
                )
            )
        ).toEqual([
            "effect clause > duration: for as long as this artifact remains on the battlefield",
        ]);
    });
});
