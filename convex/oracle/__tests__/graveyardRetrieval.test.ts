// Graveyard retrieval — the clause forms that take a card out of a graveyard
// without announcing it as an ordinary single target (issue #4568): a
// reanimation under YOUR control from any graveyard (CR 110.2a, CR 400.7), the
// top / bottom card of the ordered graveyard (CR 404.2), every matching card
// at once (CR 400.7), the source returning itself (CR 113.6b) and "each
// player" putting a card of their own onto the battlefield (CR 101.4).
//
// Two layers:
//
//  1. GOLDENS — one per accepted form, each a real corpus row compared with
//     `sortKeys` equality against the WHOLE Compiled Definition.
//  2. REFUSALS — the neighbours the rules must NOT read: a graveyard that is
//     not named, a non-permanent type, another player's control, a count above
//     one, and an X-sized count.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const REANIMATE: OracleCard = {
    name: "Reanimate",
    manaCost: "{B}",
    typeLine: "Sorcery",
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    oracleId: "a044474a-cd72-4e9d-bd8d-a08f2de9cdc0",
    layout: "normal",
};
const REANIMATE_EXPECTED = {
    name: "Reanimate",
    types: ["Sorcery"],
    manaCost: { B: 1 },
    oracleText:
        "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to that card's mana value.",
    effects: [
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
    ],
    targetRequirement: {
        type: "Creature",
        count: 1,
        zone: "graveyard",
        controller: "any",
    },
};

const REPLENISH: OracleCard = {
    name: "Replenish",
    manaCost: "{3}{W}",
    typeLine: "Sorcery",
    oracleText:
        "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
    oracleId: "523ae937-5535-490d-96ea-07f331b5e5ad",
    layout: "normal",
};
const REPLENISH_EXPECTED = {
    name: "Replenish",
    types: ["Sorcery"],
    manaCost: { X: 3, W: 1 },
    oracleText:
        "Return all enchantment cards from your graveyard to the battlefield. (Auras with nothing to enchant remain in your graveyard.)",
    effects: [
        {
            op: "forEach",
            select: {
                set: "graveyard",
                controller: "controller",
                filter: { type: "Enchantment" },
            },
            simultaneous: true,
            effects: [
                { op: "moveZone", target: { ref: "$each" }, to: "battlefield" },
            ],
        },
    ],
};

const PHYREXIAN_FURNACE: OracleCard = {
    name: "Phyrexian Furnace",
    manaCost: "{1}",
    typeLine: "Artifact",
    oracleText:
        "{T}: Exile the bottom card of target player's graveyard.\n{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
    oracleId: "4aafb7e7-b9fc-44ae-9c54-da11fd9dcc17",
    layout: "normal",
};
const PHYREXIAN_FURNACE_EXPECTED = {
    name: "Phyrexian Furnace",
    types: ["Artifact"],
    manaCost: { X: 1 },
    oracleText:
        "{T}: Exile the bottom card of target player's graveyard.\n{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
    activatedAbilities: [
        {
            id: "phyrexian-furnace-ability",
            oracleText:
                "{T}: Exile the bottom card of target player's graveyard.",
            cost: { tap: true },
            useStack: true,
            effects: [
                {
                    op: "moveZone",
                    target: {
                        zone: "graveyard",
                        position: "bottom",
                        player: { target: 0 },
                    },
                    to: "exile",
                },
            ],
            targetRequirement: { type: "player", count: 1 },
        },
        {
            id: "phyrexian-furnace-ability-2",
            oracleText:
                "{1}, Sacrifice this artifact: Exile target card from a graveyard. Draw a card.",
            cost: { mana: { X: 1 }, sacrifice: true },
            useStack: true,
            effects: [
                { op: "moveZone", target: { target: 0 }, to: "exile" },
                { op: "draw", player: "controller", count: 1 },
            ],
            targetRequirement: {
                type: "card",
                count: 1,
                zone: "graveyard",
                controller: "any",
            },
        },
    ],
};

const SQUEE: OracleCard = {
    name: "Squee, Goblin Nabob",
    manaCost: "{2}{R}",
    typeLine: "Legendary Creature — Goblin",
    oracleText:
        "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
    power: "1",
    toughness: "1",
    oracleId: "0ef760f4-bbec-4735-8d60-fc24d973452a",
    layout: "normal",
};
const SQUEE_EXPECTED = {
    name: "Squee, Goblin Nabob",
    types: ["Creature"],
    supertypes: ["Legendary"],
    subtypes: ["Goblin"],
    manaCost: { X: 2, R: 1 },
    power: 1,
    toughness: 1,
    oracleText:
        "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
    compiledTriggeredAbilities: [
        {
            id: "squee-goblin-nabob-trigger",
            oracleText:
                "At the beginning of your upkeep, you may return this card from your graveyard to your hand.",
            head: { kind: "phase", phase: "UPKEEP", scope: "your" },
            zone: "graveyard",
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Return this card from your graveyard to your hand?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    predicate: { binding: "$may1" },
                    then: [
                        {
                            op: "moveZone",
                            target: { ref: "$source" },
                            to: "hand",
                        },
                    ],
                },
            ],
        },
    ],
};

const EXHUME: OracleCard = {
    name: "Exhume",
    manaCost: "{1}{B}",
    typeLine: "Sorcery",
    oracleText:
        "Each player puts a creature card from their graveyard onto the battlefield.",
    oracleId: "fbe61f74-1b3c-4e12-8758-7029872c9ff1",
    layout: "normal",
};
const EXHUME_EXPECTED = {
    name: "Exhume",
    types: ["Sorcery"],
    manaCost: { X: 1, B: 1 },
    oracleText:
        "Each player puts a creature card from their graveyard onto the battlefield.",
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-graveyard-card",
                    player: { ref: "$each" },
                    zone: "graveyard",
                    filter: { type: "Creature" },
                    count: 1,
                    prompt: "Exhume: put a creature card from your graveyard onto the battlefield.",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: { ref: "$each" },
                    from: "graveyard",
                    to: "battlefield",
                },
            ],
        },
    ],
};

const SHOW_AND_TELL: OracleCard = {
    name: "Show and Tell",
    manaCost: "{2}{U}",
    typeLine: "Sorcery",
    oracleText:
        "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
    oracleId: "b83a3ba0-249e-4c39-bbf0-cb005413f7d2",
    layout: "normal",
};
const SHOW_AND_TELL_EXPECTED = {
    name: "Show and Tell",
    types: ["Sorcery"],
    manaCost: { X: 2, U: 1 },
    oracleText:
        "Each player may put an artifact, creature, enchantment, or land card from their hand onto the battlefield.",
    effects: [
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "choice",
                    kind: "choose-hand-card",
                    player: { ref: "$each" },
                    zone: "hand",
                    filter: {
                        type: ["Artifact", "Creature", "Enchantment", "Land"],
                    },
                    count: { min: 0, max: 1 },
                    prompt: "Show and Tell: put an artifact, creature, enchantment, or land card from your hand onto the battlefield (or none).",
                    bind: "$picked",
                },
                {
                    op: "moveZone",
                    cards: { ref: "$picked" },
                    player: { ref: "$each" },
                    from: "hand",
                    to: "battlefield",
                },
            ],
        },
    ],
};

const SHALLOW_GRAVE: OracleCard = {
    name: "Shallow Grave",
    manaCost: "{1}{B}",
    typeLine: "Instant",
    oracleText:
        "Return the top creature card of your graveyard to the battlefield.",
    oracleId: "9843d8a6-bcbf-40c2-8c41-316e97db9c62",
    layout: "normal",
};
const SHALLOW_GRAVE_EXPECTED = {
    name: "Shallow Grave",
    types: ["Instant"],
    manaCost: { X: 1, B: 1 },
    oracleText:
        "Return the top creature card of your graveyard to the battlefield.",
    effects: [
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
    ],
};

function compiled(card: OracleCard) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** A sorcery whose Oracle text is exactly `oracleText`. */
function sorcery(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Graveyard Probe",
            manaCost: "{3}{B}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

describe("graveyard retrieval — goldens", () => {
    it("Reanimate: any graveyard, under your control (CR 110.2a)", () => {
        expect(sortKeys(compiled(REANIMATE))).toEqual(
            sortKeys(REANIMATE_EXPECTED)
        );
    });
    it("Replenish: every enchantment card at once (CR 400.7)", () => {
        expect(sortKeys(compiled(REPLENISH))).toEqual(
            sortKeys(REPLENISH_EXPECTED)
        );
    });
    it("Phyrexian Furnace: the bottom card of a target player's graveyard (CR 404.2)", () => {
        expect(sortKeys(compiled(PHYREXIAN_FURNACE))).toEqual(
            sortKeys(PHYREXIAN_FURNACE_EXPECTED)
        );
    });
    it("Squee: the source returns itself, functioning from the graveyard (CR 113.6b)", () => {
        expect(sortKeys(compiled(SQUEE))).toEqual(sortKeys(SQUEE_EXPECTED));
    });
    it("Exhume: each player puts a creature card from their graveyard (CR 101.4)", () => {
        expect(sortKeys(compiled(EXHUME))).toEqual(sortKeys(EXHUME_EXPECTED));
    });
    it("Show and Tell: each player MAY put a permanent card from their hand (CR 101.4)", () => {
        expect(sortKeys(compiled(SHOW_AND_TELL))).toEqual(
            sortKeys(SHOW_AND_TELL_EXPECTED)
        );
    });
    it("Shallow Grave: the top creature card of your graveyard (CR 404.2)", () => {
        expect(sortKeys(compiled(SHALLOW_GRAVE))).toEqual(
            sortKeys(SHALLOW_GRAVE_EXPECTED)
        );
    });
});

describe("graveyard retrieval — refused neighbours (fail-closed)", () => {
    it.each([
        // CR 110.2a — control is the ABILITY controller's only.
        "Put target creature card from a graveyard onto the battlefield under target opponent's control.",
        // CR 400.7 — a non-permanent card cannot enter the battlefield.
        "Put target instant card from a graveyard onto the battlefield under your control.",
        "Return all instant cards from your graveyard to the battlefield.",
        "Each player puts an instant card from their graveyard onto the battlefield.",
        // CR 404.2 — an unnamed owner / an unknown end of the pile.
        "Return the top creature card of target player's graveyard to the battlefield.",
        "Return the middle creature card of your graveyard to the battlefield.",
        // CR 400.7 — a sweep of ANOTHER graveyard.
        "Return all enchantment cards from a graveyard to the battlefield.",
        // CR 107.3 — a count read off a runtime quantity.
        "Return up to X target cards from your graveyard to your hand, where X is the number of black permanents target opponent controls as you cast this spell.",
    ])("refuses %s", (line) => {
        expect(sorcery(line).state).toBe("unparsed");
    });
});

describe("graveyard retrieval — the source returning itself (CR 113.6b)", () => {
    const creature = (oracleText: string) =>
        compileCard(
            oracleCard({
                name: "Graveyard Probe",
                manaCost: "{2}{R}",
                typeLine: "Creature — Goblin",
                oracleText,
                power: "1",
                toughness: "1",
            })
        );

    it("refuses an activated ability that cannot be activated from the graveyard", () => {
        expect(
            creature("{B}: Return this card from your graveyard to your hand.")
                .state
        ).toBe("unparsed");
    });

    it("refuses the battlefield as the destination (no corpus evidence)", () => {
        expect(
            creature(
                "At the beginning of your upkeep, you may return this card from your graveyard to the battlefield."
            ).state
        ).toBe("unparsed");
    });

    it("keeps an intervening-if instead of dropping it", () => {
        const outcome = creature(
            "At the beginning of your upkeep, if you control a creature, you may return this card from your graveyard to your hand."
        );
        expect(outcome.state).not.toBe("unparsed");
        if (outcome.state === "unparsed") return;
        const trigger = outcome.definition.compiledTriggeredAbilities?.[0];
        expect(trigger?.condition).toBeDefined();
    });
});
