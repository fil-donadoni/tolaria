// Cost-parameter keyword lines: Cycling, Madness, Morph and Fading
// (CR 702.29a, 702.35a, 702.37, 702.32a; issue #4539).
//
// Two layers, each watching a different way a parameterised keyword goes wrong:
//
//  1. GOLDEN fixtures — a real corpus card compiled whole must produce exactly
//     this Compiled Definition: the cost lands in the field the engine reads
//     (`activatedAbilities` via the catalogue's own `cyclingAbility` factory,
//     `madness`, `morph`, the `"fading N"` static string), never dropped.
//  2. REFUSALS — the neighbours the rule must NOT read: a cost the payment
//     path cannot pay or label ({X}, hybrid, Phyrexian), a non-mana cost, a
//     second declaration, and a malformed count. Fail-closed is pinned, not
//     assumed (ADR 0105 § 2).

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { keywordLineSlot } from "../grammar/slots/keywordLine";
import { oracleCard, parseContext } from "./oracle.fixture";

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

function readLine(line: string) {
    return keywordLineSlot.run(line, parseContext());
}

describe("Cycling [cost] (CR 702.29a)", () => {
    it("Barren Moor: the land's cycling ability is the catalogue's own", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Barren Moor",
                    manaCost: "",
                    typeLine: "Land",
                    power: undefined,
                    toughness: undefined,
                    oracleText:
                        "This land enters tapped.\n{T}: Add {B}.\nCycling {B} ({B}, Discard this card: Draw a card.)",
                })
            )
        ).toEqual({
            name: "Barren Moor",
            types: ["Land"],
            oracleText:
                "This land enters tapped.\n{T}: Add {B}.\nCycling {B} ({B}, Discard this card: Draw a card.)",
            activatedAbilities: [
                {
                    id: "barren-moor-mana",
                    oracleText: "{T}: Add {B}.",
                    cost: { tap: true },
                    useStack: false,
                    manaProduced: { B: 1 },
                },
                {
                    id: "cycling",
                    oracleText:
                        "Cycling {B} ({B}, Discard this card: Draw a card.)",
                    cost: {
                        mana: { B: 1 },
                        discardThis: true,
                        cyclingCost: true,
                    },
                    activateFromHand: true,
                    useStack: true,
                    effects: [{ op: "draw", player: "controller", count: 1 }],
                },
            ],
            entersTapped: true,
        });
    });

    it("Unearth: a generic cost is `generic`, as the catalogue writes it, and prints as {2}", () => {
        const def = compiled(
            oracleCard({
                name: "Unearth",
                manaCost: "{B}",
                typeLine: "Sorcery",
                power: undefined,
                toughness: undefined,
                oracleText:
                    "Return target creature card with mana value 3 or less from your graveyard to the battlefield.\nCycling {2} ({2}, Discard this card: Draw a card.)",
            })
        );
        expect(def.activatedAbilities).toEqual([
            {
                id: "cycling",
                oracleText:
                    "Cycling {2} ({2}, Discard this card: Draw a card.)",
                cost: {
                    mana: { generic: 2 },
                    discardThis: true,
                    cyclingCost: true,
                },
                activateFromHand: true,
                useStack: true,
                effects: [{ op: "draw", player: "controller", count: 1 }],
            },
        ]);
    });

    it.each([
        ["a variable cost", "Cycling {X}"],
        ["a hybrid pip", "Cycling {W/U}"],
        ["a Phyrexian pip", "Cycling {B/P}"],
        ["a non-mana cost", "Cycling—Pay 2 life."],
        ["typecycling (CR 702.29e)", "Plainscycling {1}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });

    it("REFUSES a card declaring cycling twice (one ability id per card)", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Double Cycler",
                oracleText: "Cycling {1}\nCycling {2}",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

describe("Madness [cost] (CR 702.35a)", () => {
    it("Arrogant Wurm: the cost lands on `madness`", () => {
        expect(
            compiled(
                oracleCard({
                    name: "Arrogant Wurm",
                    manaCost: "{3}{G}{G}",
                    typeLine: "Creature — Wurm",
                    power: "4",
                    toughness: "4",
                    oracleText:
                        "Trample\nMadness {2}{G} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
                })
            )
        ).toEqual({
            name: "Arrogant Wurm",
            types: ["Creature"],
            subtypes: ["Wurm"],
            manaCost: { X: 3, G: 2 },
            power: 4,
            toughness: 4,
            oracleText:
                "Trample\nMadness {2}{G} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)",
            staticAbilities: ["trample"],
            madness: { X: 2, G: 1 },
        });
    });

    it("Madness {0} is the empty cost (Basking Rootwalla)", () => {
        const parsed = readLine("Madness {0}");
        expect(parsed.ok).toBe(true);
        if (parsed.ok)
            expect(parsed.value).toEqual({ kind: "madness", cost: {} });
    });

    it.each([
        ["a variable cost", "Madness {X}"],
        ["a hybrid pip", "Madness {R/G}"],
        ["a non-mana cost", "Madness—Discard a card."],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });
});

describe("Morph [cost] (CR 702.37a, 702.37e)", () => {
    it("Exalted Angel: the turn-up cost lands on `morph`", () => {
        const def = compiled(
            oracleCard({
                name: "Exalted Angel",
                manaCost: "{4}{W}{W}",
                typeLine: "Creature — Angel",
                power: "4",
                toughness: "5",
                oracleText:
                    "Flying\nWhenever this creature deals damage, you gain that much life.\nMorph {2}{W}{W} (You may cast this card face down as a 2/2 creature for {3}. Turn it face up any time for its morph cost.)",
            })
        );
        expect(def.morph).toEqual({ X: 2, W: 2 });
        expect(def.staticAbilities).toEqual(["flying"]);
    });

    it.each([
        ["a variable cost", "Morph {X}"],
        ["a hybrid pip", "Morph {W/U}"],
        ["a non-mana cost", "Morph—Reveal a white card in your hand."],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });
});

describe("Fading N (CR 702.32a)", () => {
    it("Blastoderm: the count rides the one `fading N` string", () => {
        const def = compiled(
            oracleCard({
                name: "Blastoderm",
                manaCost: "{2}{G}{G}",
                typeLine: "Creature — Beast",
                power: "5",
                toughness: "5",
                oracleText:
                    "Shroud (This creature can't be the target of spells or abilities.)\nFading 3 (This creature enters with three fade counters on it. At the beginning of your upkeep, remove a fade counter from it. If you can't, sacrifice it.)",
            })
        );
        expect(def.staticAbilities).toEqual(["shroud", "fading 3"]);
    });

    it("reads each printed count (Ancient Hydra's Fading 5)", () => {
        const parsed = readLine("Fading 5");
        expect(parsed.ok).toBe(true);
        if (parsed.ok && parsed.value.kind === "keywords")
            expect(parsed.value.keywords.map((k) => k.ability)).toEqual([
                "fading 5",
            ]);
    });

    it.each([
        ["a zero count", "Fading 0"],
        ["a variable count", "Fading X"],
        ["a cost where the count goes", "Fading {1}"],
    ])("REFUSES %s", (_why, line) => {
        expect(readLine(line).ok).toBe(false);
    });
});
