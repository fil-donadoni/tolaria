// The "choose a color" Grammar Cluster: an as-enters colour choice and the mana
// ability that reads it (CR 614.12a, CR 607.2d, CR 106.5), protection from the
// colour of your choice (CR 702.16a, CR 105.1) and "becomes colorless"
// (CR 105.2c, CR 613.1e).
//
//  1. GOLDEN forms — a real corpus card must produce exactly this Compiled
//     Definition, one per accepted form.
//  2. REFUSALS — the neighbours the rules must not read; each pins WHERE the
//     compiler gave up, so a card cannot go on being refused for another reason.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const QUALITIES: ReadonlyArray<[string, string]> = [
    ["W", "white"],
    ["U", "blue"],
    ["B", "black"],
    ["R", "red"],
    ["G", "green"],
];

/** The `optionChoice` a "protection from the color of your choice" lowers to. */
function protectionPick(name: string, target: Record<string, unknown>) {
    return {
        op: "optionChoice",
        prompt: `Choose a color (${name}).`,
        modes: QUALITIES.map(([color, quality]) => ({
            id: `protection-${quality}`,
            label: `Protection from ${quality}`,
            color,
            effects: [
                {
                    op: "grantAbility",
                    ability: `protection from ${quality}`,
                    target,
                    duration: { phase: "end-of-turn" },
                },
            ],
        })),
    };
}

/** What an as-enters colour choice writes on the definition. */
const AS_ENTERS_COLOR = {
    entersWith: { asEnters: [{ kind: "mode" }] },
    modes: [
        { id: "W", label: "White", oracleText: "White." },
        { id: "U", label: "Blue", oracleText: "Blue." },
        { id: "B", label: "Black", oracleText: "Black." },
        { id: "R", label: "Red", oracleText: "Red." },
        { id: "G", label: "Green", oracleText: "Green." },
    ],
};

/** The mana ability "{T}: Add one mana of the chosen color." lowers to. */
function chosenColorMana(id: string) {
    return {
        id,
        oracleText: "{T}: Add one mana of the chosen color.",
        cost: { tap: true },
        useStack: false,
        manaChoices: [{ W: 1 }, { U: 1 }, { B: 1 }, { R: 1 }, { G: 1 }],
        manaColorSource: { colors: "chosen-color" },
    };
}

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

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

const MOTHER_OF_RUNES = {
    oracleId: "60433b48-d27f-413c-905c-43839b1943f1",
    name: "Mother of Runes",
    manaCost: "{W}",
    typeLine: "Creature — Human Cleric",
    oracleText:
        "{T}: Target creature you control gains protection from the color of your choice until end of turn.",
    power: "1",
    toughness: "1",
};

const ANCIENT_KAVU = {
    oracleId: "598a7347-b772-4839-a02f-b930076c1354",
    name: "Ancient Kavu",
    manaCost: "{3}{R}",
    typeLine: "Creature — Kavu",
    oracleText: "{2}: This creature becomes colorless until end of turn.",
    power: "3",
    toughness: "3",
};

const ERSATZ_GNOMES = {
    oracleId: "ea016b84-7f77-42e7-bd14-2e62a1e35f3b",
    name: "Ersatz Gnomes",
    manaCost: "{3}",
    typeLine: "Artifact Creature — Gnome",
    oracleText:
        "{T}: Target spell becomes colorless.\n{T}: Target permanent becomes colorless until end of turn.",
    power: "1",
    toughness: "1",
};

const QUIRION_ELVES = {
    oracleId: "e2975a88-5a5a-462a-90b9-d8c00150b6d3",
    name: "Quirion Elves",
    manaCost: "{1}{G}",
    typeLine: "Creature — Elf Druid",
    oracleText:
        "As this creature enters, choose a color.\n{T}: Add {G}.\n{T}: Add one mana of the chosen color.",
    power: "1",
    toughness: "1",
};

describe("As this enters, choose a color + its mana reader (CR 614.12a, CR 607.2d)", () => {
    it("compiles the creature form beside a fixed ability — Quirion Elves, whole", () => {
        expect(sortKeys(compiled(oracleCard(QUIRION_ELVES)))).toEqual(
            sortKeys({
                name: "Quirion Elves",
                types: ["Creature"],
                subtypes: ["Elf", "Druid"],
                manaCost: { X: 1, G: 1 },
                power: 1,
                toughness: 1,
                oracleText: QUIRION_ELVES.oracleText,
                ...AS_ENTERS_COLOR,
                activatedAbilities: [
                    {
                        id: "quirion-elves-mana",
                        oracleText: "{T}: Add {G}.",
                        cost: { tap: true },
                        useStack: false,
                        manaProduced: { G: 1 },
                    },
                    chosenColorMana("quirion-elves-mana-2"),
                ],
            })
        );
    });

    it("compiles the artifact form — Sol Grail, whole", () => {
        const oracleText =
            "As this artifact enters, choose a color.\n{T}: Add one mana of the chosen color.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "0396ef40-3774-4684-9971-160aaccf6ac6",
                        name: "Sol Grail",
                        manaCost: "{3}",
                        typeLine: "Artifact",
                        oracleText,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Sol Grail",
                types: ["Artifact"],
                manaCost: { X: 3 },
                oracleText,
                ...AS_ENTERS_COLOR,
                activatedAbilities: [chosenColorMana("sol-grail-mana")],
            })
        );
    });

    it("compiles the land form — Shimmerdrift Vale, whole", () => {
        const oracleText =
            "This land enters tapped.\nAs this land enters, choose a color.\n{T}: Add one mana of the chosen color.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "2ac34f3e-822d-4fde-99ca-a31c4d9503fd",
                        name: "Shimmerdrift Vale",
                        manaCost: "",
                        typeLine: "Snow Land",
                        oracleText,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Shimmerdrift Vale",
                types: ["Land"],
                supertypes: ["Snow"],
                oracleText,
                entersTapped: true,
                ...AS_ENTERS_COLOR,
                activatedAbilities: [chosenColorMana("shimmerdrift-vale-mana")],
            })
        );
    });

    // The enchantment form's every printing has a reader this cluster does not
    // read, so no whole card graduates: what is pinned is that the choice line
    // is READ, because the only line left refused is the reader.
    it("reads the enchantment form — Shifting Sky refuses on its reader alone", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "4634fd4e-5b38-4cfb-ab73-bf3b14b3bdee",
                    name: "Shifting Sky",
                    manaCost: "{2}{U}",
                    typeLine: "Enchantment",
                    oracleText:
                        "As this enchantment enters, choose a color.\nAll nonland permanents are the chosen color.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual([
            "static clause: All nonland permanents are the chosen color",
        ]);
    });

    it("reaches ready — Quirion Elves is not a quarantined parse", () => {
        expect(compileCard(oracleCard(QUIRION_ELVES)).state).toBe("ready");
    });
});

describe("the choice and its reader are tied together (CR 607.2d, CR 106.5)", () => {
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

    it("refuses a reader on a card with no choice", () => {
        expect(
            refusedAt(artifact("{T}: Add one mana of the chosen color."))
        ).toEqual([
            '"the chosen color" on a card with no as-enters color choice',
        ]);
    });

    it("refuses a choice no line of the card reads", () => {
        expect(
            refusedAt(artifact("As this artifact enters, choose a color."))
        ).toEqual(["an as-enters color choice no line of the card reads"]);
    });

    it("refuses a second choice on the same card", () => {
        expect(
            refusedAt(
                artifact(
                    "As this artifact enters, choose a color.\nAs this artifact enters, choose a color.\n{T}: Add one mana of the chosen color."
                )
            )
        ).toEqual(["a card declares an as-enters color choice twice"]);
    });

    it("refuses a choice beside another as-enters choice", () => {
        expect(
            refusedAt(
                artifact(
                    "As this artifact enters, choose a color.\nAs this artifact enters, choose an opponent.\n{T}: Add one mana of the chosen color."
                )
            )
        ).toEqual(["a card declares two as-enters choices"]);
    });

    // The reader lowered inside quotes would ask the HOST for a colour only the
    // granting permanent chose: the land would tap for nothing, silently.
    it("refuses the reader inside a granted ability", () => {
        const refused = refusedAt(
            oracleCard({
                name: "Probe",
                manaCost: "{G}",
                typeLine: "Enchantment — Aura",
                oracleText:
                    'Enchant land\nAs this Aura enters, choose a color.\nEnchanted land has "{T}: Add one mana of the chosen color."',
                power: undefined,
                toughness: undefined,
            })
        );
        expect(refused).toHaveLength(1);
        expect(refused[0]).toContain("chosen color");
    });
});

describe("the neighbours of the choice and the reader (fail-closed, ADR 0105 § 2)", () => {
    it("refuses a restricted choice and a split production — Citadel Gate", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "15f1fe23-5af4-4fc4-8cde-2e0bf9f9be0c",
                    name: "Citadel Gate",
                    manaCost: "",
                    typeLine: "Land — Gate",
                    oracleText:
                        "This land enters tapped.\nAs this land enters, choose a color other than white.\n{T}: Add {W} or one mana of the chosen color.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual([
            "static clause: As this land enters, choose a color other than white",
            "mana production: {W} or one mana of the chosen color",
        ]);
    });

    it("refuses a choice folded onto another sentence — Uncharted Haven", () => {
        expect(
            refusedAt(
                oracleCard({
                    oracleId: "d23c3613-bc5e-4fc5-939c-62a090c53a79",
                    name: "Uncharted Haven",
                    manaCost: "",
                    typeLine: "Land",
                    oracleText:
                        "This land enters tapped. As it enters, choose a color.\n{T}: Add one mana of the chosen color.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toEqual([
            "static clause: This land enters tapped. As it enters, choose a color",
        ]);
    });
});

describe("protection from the color of your choice (CR 702.16a, CR 105.1)", () => {
    it("compiles a target you control, on an activated ability — Mother of Runes, whole", () => {
        expect(sortKeys(compiled(oracleCard(MOTHER_OF_RUNES)))).toEqual(
            sortKeys({
                name: "Mother of Runes",
                types: ["Creature"],
                subtypes: ["Human", "Cleric"],
                manaCost: { W: 1 },
                power: 1,
                toughness: 1,
                oracleText: MOTHER_OF_RUNES.oracleText,
                activatedAbilities: [
                    {
                        id: "mother-of-runes-ability",
                        oracleText: MOTHER_OF_RUNES.oracleText,
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            protectionPick("Mother of Runes", { target: 0 }),
                        ],
                        targetRequirement: {
                            type: "Creature",
                            count: 1,
                            controller: "you",
                        },
                    },
                ],
            })
        );
    });

    it("compiles a plain target, on a spell — Stave Off, whole", () => {
        const oracleText =
            "Target creature gains protection from the color of your choice until end of turn.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "c77c23bc-efde-43ce-bf6f-7a8531d81d89",
                        name: "Stave Off",
                        manaCost: "{W}",
                        typeLine: "Instant",
                        oracleText,
                        power: undefined,
                        toughness: undefined,
                    })
                )
            )
        ).toEqual(
            sortKeys({
                name: "Stave Off",
                types: ["Instant"],
                manaCost: { W: 1 },
                oracleText,
                effects: [protectionPick("Stave Off", { target: 0 })],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });

    it("compiles a subtype target — Sygg, River Guide's ability", () => {
        const definition = compiled(
            oracleCard({
                oracleId: "73f6da1e-b8ce-4b5a-9da0-84ca67adaf1c",
                name: "Sygg, River Guide",
                manaCost: "{W}{U}",
                typeLine: "Legendary Creature — Merfolk Wizard",
                oracleText:
                    "Islandwalk (This creature can't be blocked as long as defending player controls an Island.)\n{1}{W}: Target Merfolk you control gains protection from the color of your choice until end of turn.",
                power: "2",
                toughness: "2",
            })
        );
        expect(definition.activatedAbilities?.[0]).toMatchObject({
            effects: [protectionPick("Sygg, River Guide", { target: 0 })],
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
                subtypeFilter: ["Merfolk"],
            },
        });
    });

    it("compiles the source itself — Knight of Dawn's ability", () => {
        const definition = compiled(
            oracleCard({
                oracleId: "51262155-f1be-45a8-a21f-94e920a93e55",
                name: "Knight of Dawn",
                manaCost: "{1}{W}{W}",
                typeLine: "Creature — Human Knight",
                oracleText:
                    "First strike\n{W}{W}: This creature gains protection from the color of your choice until end of turn.",
                power: "2",
                toughness: "2",
            })
        );
        expect(definition.activatedAbilities?.[0]).toEqual({
            id: "knight-of-dawn-ability",
            oracleText:
                "{W}{W}: This creature gains protection from the color of your choice until end of turn.",
            cost: { mana: { W: 2 } },
            useStack: true,
            effects: [protectionPick("Knight of Dawn", { ref: "$source" })],
        });
    });

    it("compiles the triggered site — Midvast Protector's trigger", () => {
        const definition = compiled(
            oracleCard({
                oracleId: "33a5ad42-cd81-4724-9f68-7f32a1c8a047",
                name: "Midvast Protector",
                manaCost: "{3}{W}",
                typeLine: "Creature — Human Wizard",
                oracleText:
                    "When this creature enters, target creature you control gains protection from the color of your choice until end of turn.",
                power: "2",
                toughness: "3",
            })
        );
        expect(definition.compiledTriggeredAbilities?.[0]).toMatchObject({
            targetRequirement: {
                type: "Creature",
                count: 1,
                controller: "you",
            },
            effects: [protectionPick("Midvast Protector", { target: 0 })],
        });
    });
});

describe("the neighbours of protection of your choice (fail-closed)", () => {
    function instant(oracleText: string) {
        return oracleCard({
            name: "Probe",
            manaCost: "{W}",
            typeLine: "Instant",
            oracleText,
            power: undefined,
            toughness: undefined,
        });
    }

    it("refuses a player subject — protection on a player is another form", () => {
        expect(
            refusedAt(
                instant(
                    "You gain protection from the color of your choice until end of turn."
                )
            )
        ).toEqual([
            "effect clause: You gain protection from the color of your choice until end of turn",
        ]);
    });

    it("refuses an announced player", () => {
        expect(
            refusedAt(
                instant(
                    "Target player gains protection from the color of your choice until end of turn."
                )
            )
        ).toEqual(["protection of your choice reads a permanent target"]);
    });

    it("refuses a spell target", () => {
        expect(
            refusedAt(
                instant(
                    "Target spell gains protection from the color of your choice until end of turn."
                )
            )
        ).toEqual(["protection of your choice reads a permanent target"]);
    });

    it("refuses a subject that is neither a target nor the source", () => {
        expect(
            refusedAt(
                instant(
                    "That creature gains protection from the color of your choice until end of turn."
                )
            )
        ).toEqual(["protection of your choice reads a target or the source"]);
    });

    it("refuses the grant with no duration", () => {
        expect(
            refusedAt(
                instant(
                    "Target creature gains protection from the color of your choice."
                )
            )
        ).toHaveLength(1);
    });

    // CR 608.2c — a "Choose a color." marker feeds "the chosen color"; a
    // sentence that picks for itself would leave the marker's pick unread.
    it('refuses a "Choose a color." marker before it', () => {
        expect(
            refusedAt(
                instant(
                    "Choose a color. Target creature gains protection from the color of your choice until end of turn."
                )
            )
        ).toEqual([
            "sentence assembly: Choose a color. Target creature gains protection from the color of your choice until end of turn",
        ]);
    });

    it('still refuses "the chosen color" with no marker', () => {
        expect(
            refusedAt(
                instant(
                    "Target creature gains protection from the chosen color until end of turn."
                )
            )
        ).toHaveLength(1);
    });
});

describe("becomes colorless (CR 105.2c, CR 613.1e)", () => {
    it("compiles the source with a duration — Ancient Kavu, whole", () => {
        expect(sortKeys(compiled(oracleCard(ANCIENT_KAVU)))).toEqual(
            sortKeys({
                name: "Ancient Kavu",
                types: ["Creature"],
                subtypes: ["Kavu"],
                manaCost: { X: 3, R: 1 },
                power: 3,
                toughness: 3,
                oracleText: ANCIENT_KAVU.oracleText,
                activatedAbilities: [
                    {
                        id: "ancient-kavu-ability",
                        oracleText: ANCIENT_KAVU.oracleText,
                        cost: { mana: { X: 2 } },
                        useStack: true,
                        effects: [
                            {
                                op: "setColor",
                                target: { ref: "$source" },
                                colors: [],
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
            })
        );
    });

    it("compiles a spell with no duration and a permanent with one — Ersatz Gnomes, whole", () => {
        expect(sortKeys(compiled(oracleCard(ERSATZ_GNOMES)))).toEqual(
            sortKeys({
                name: "Ersatz Gnomes",
                types: ["Artifact", "Creature"],
                subtypes: ["Gnome"],
                manaCost: { X: 3 },
                power: 1,
                toughness: 1,
                oracleText: ERSATZ_GNOMES.oracleText,
                activatedAbilities: [
                    {
                        id: "ersatz-gnomes-ability",
                        oracleText: "{T}: Target spell becomes colorless.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "setColor",
                                target: { target: 0 },
                                colors: [],
                            },
                        ],
                        targetRequirement: { type: "spell", count: 1 },
                    },
                    {
                        id: "ersatz-gnomes-ability-2",
                        oracleText:
                            "{T}: Target permanent becomes colorless until end of turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "setColor",
                                target: { target: 0 },
                                colors: [],
                                duration: { phase: "end-of-turn" },
                            },
                        ],
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
                        },
                    },
                ],
            })
        );
    });

    it("compiles the indefinite spell-or-permanent union — Moonlace, whole", () => {
        const oracleText = "Target spell or permanent becomes colorless.";
        expect(
            sortKeys(
                compiled(
                    oracleCard({
                        oracleId: "52d4dc8a-2799-4b4e-9c20-f14bb75c2279",
                        name: "Moonlace",
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
                name: "Moonlace",
                types: ["Instant"],
                manaCost: { U: 1 },
                oracleText,
                effects: [
                    { op: "setColor", target: { target: 0 }, colors: [] },
                ],
                targetRequirement: { type: "spell-or-permanent", count: 1 },
            })
        );
    });
});

describe("the neighbours of becomes colorless (fail-closed)", () => {
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

    it("refuses 'any target' — a player has no color", () => {
        expect(
            refusedAt(artifact("{T}: Any target becomes colorless."))
        ).toEqual(["a player has no color (CR 109.1)"]);
    });

    it("refuses a tail that is not a duration", () => {
        expect(
            refusedAt(
                artifact(
                    "{T}: Target permanent becomes colorless for as long as this artifact remains on the battlefield."
                )
            )
        ).toEqual([
            "effect clause > duration: for as long as this artifact remains on the battlefield",
        ]);
    });

    it("refuses mana as a subject — that mana names no object", () => {
        expect(
            refusedAt(
                artifact(
                    "If you would lose unspent mana, that mana becomes colorless instead."
                )
            )
        ).toHaveLength(1);
    });
});
