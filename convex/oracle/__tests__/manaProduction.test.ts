// Mana production — lands with ONE basic land type and the conditional ritual
// (issue #4541).
//
// Three layers, each watching a different way the rules can go wrong:
//
//  1. GOLDEN — a real Oracle card compiled whole must produce exactly this
//     Compiled Definition (CR 305.6 intrinsic mana ability, CR 106.1 add mana,
//     CR 608.2c replacement).
//  2. REFUSALS — the neighbours stay `unparsed`: a land with two basic types
//     (the engine reads the first subtype only), a replacement with nothing to
//     replace, a threshold over another zone.
//  3. INVARIANT — a one-type land carries NO explicit mana ability: the
//     intrinsic path supplies it, and emitting one would double the mana.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { oracleCard } from "./oracle.fixture";

const FOREST = oracleCard({
    oracleId: "b34bb2dc-c1af-4d77-b0b3-a0fb342a5fc6",
    name: "Forest",
    manaCost: "",
    typeLine: "Basic Land — Forest",
    oracleText: "({T}: Add {G}.)",
    power: undefined,
    toughness: undefined,
});

const DRYAD_ARBOR = oracleCard({
    oracleId: "e996cd67-739c-40f4-b276-0042acf26c71",
    name: "Dryad Arbor",
    manaCost: "",
    typeLine: "Land Creature — Forest Dryad",
    oracleText:
        "(This land isn't a spell, it's affected by summoning sickness, and it has \"{T}: Add {G}.\")",
    power: "1",
    toughness: "1",
});

const BADLANDS = oracleCard({
    oracleId: "13ff3222-91cb-4796-a34e-899ed817694c",
    name: "Badlands",
    manaCost: "",
    typeLine: "Land — Swamp Mountain",
    oracleText: "({T}: Add {B} or {R}.)",
    power: undefined,
    toughness: undefined,
});

const CABAL_RITUAL = oracleCard({
    oracleId: "5b5bf1fa-6502-4790-b66b-f0f8504ebc7c",
    name: "Cabal Ritual",
    manaCost: "{1}{B}",
    typeLine: "Instant",
    oracleText:
        "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
    power: undefined,
    toughness: undefined,
});

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error(`${card.name} unparsed`);
    return outcome.definition;
}

/** An instant whose whole text is `text`, for the refusal neighbours. */
function ritual(text: string) {
    return compileCard(
        oracleCard({
            name: "Test Ritual",
            manaCost: "{B}",
            typeLine: "Instant",
            oracleText: text,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("land with exactly one basic land type (CR 305.6)", () => {
    it("compiles a basic land to its bare definition", () => {
        expect(sortKeys(compiled(FOREST))).toEqual(
            sortKeys({
                name: "Forest",
                types: ["Land"],
                supertypes: ["Basic"],
                subtypes: ["Forest"],
                oracleText: "({T}: Add {G}.)",
            })
        );
    });

    it("compiles a nonbasic land with a basic type and a creature type", () => {
        expect(sortKeys(compiled(DRYAD_ARBOR))).toEqual(
            sortKeys({
                name: "Dryad Arbor",
                types: ["Land", "Creature"],
                subtypes: ["Forest", "Dryad"],
                power: 1,
                toughness: 1,
                oracleText:
                    "(This land isn't a spell, it's affected by summoning sickness, and it has \"{T}: Add {G}.\")",
            })
        );
    });

    it("emits no explicit mana ability — the intrinsic path supplies it", () => {
        const definition = compiled(FOREST);
        expect(definition.activatedAbilities).toBeUndefined();
    });

    it("refuses a printed tap-mana line beside the intrinsic ability", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Land",
                manaCost: "",
                typeLine: "Land — Forest",
                oracleText: "{T}: Add {G}.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("still refuses a land with two basic land types", () => {
        const outcome = compileCard(BADLANDS);
        expect(outcome.state).toBe("unparsed");
        if (outcome.state !== "unparsed") return;
        expect(outcome.gaps[0]!.reason).toContain("CR 305.6");
    });
});

describe("conditional ritual — Add … instead if there are N cards in your graveyard (CR 608.2c)", () => {
    it("compiles Cabal Ritual to one if/else over the graveyard count", () => {
        expect(sortKeys(compiled(CABAL_RITUAL))).toEqual(
            sortKeys({
                name: "Cabal Ritual",
                types: ["Instant"],
                manaCost: { X: 1, B: 1 },
                oracleText: CABAL_RITUAL.oracleText,
                effects: [
                    {
                        op: "if",
                        predicate: {
                            left: {
                                count: {
                                    zone: "graveyard",
                                    controller: "controller",
                                },
                            },
                            op: "ge",
                            right: 7,
                        },
                        then: [{ op: "addMana", mana: { B: 5 } }],
                        else: [{ op: "addMana", mana: { B: 3 } }],
                    },
                ],
            })
        );
    });

    it("refuses a replacement with no Add in front of it", () => {
        expect(
            ritual(
                "Threshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a replacement after something other than an Add", () => {
        expect(
            ritual(
                "Draw a card.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a replacement glued behind an activated ability", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Rock",
                manaCost: "{2}",
                typeLine: "Artifact",
                oracleText:
                    "{T}: Add {B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it("refuses a replacement behind a modal bullet", () => {
        expect(
            ritual(
                "Choose one —\n• Add {B}{B}{B}.\n• Draw a card.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a threshold over another zone", () => {
        expect(
            ritual(
                "Add {B}{B}{B}.\nAdd {B}{B}{B}{B}{B} instead if there are seven or more cards in your hand."
            ).state
        ).toBe("unparsed");
    });

    it("refuses a threshold that is not a number", () => {
        expect(
            ritual(
                "Add {B}{B}{B}.\nAdd {B}{B}{B}{B}{B} instead if there are many or more cards in your graveyard."
            ).state
        ).toBe("unparsed");
    });

    it("leaves the wider damage replacement refused (Thermal Blast)", () => {
        expect(
            ritual(
                "Test Ritual deals 3 damage to target creature.\nThreshold — Test Ritual deals 5 damage instead if there are seven or more cards in your graveyard."
            ).state
        ).toBe("unparsed");
    });
});
