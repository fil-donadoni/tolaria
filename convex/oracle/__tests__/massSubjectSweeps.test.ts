// Mass subjects — the Grammar Cluster of issue #4557 (premodern-metagame).
//
// One cluster, several clause forms around a SWEEP: a creature sweep as a
// damage recipient ("each creature", "each creature without flying and each
// player", "each creature target opponent controls"), a colour on a sweep
// ("all green creatures") with the plural "They can't be regenerated.", a
// bounce sweep ("Return all permanents to their owners' hands."), a sweep
// bounded by a counter tally ("mana value equal to the number of fuse counters
// on this artifact"), a negative subtype ("all non-Aura enchantments"), a bare
// subtype group ("Goblin creatures get +3/+0") and a colour on an edict
// ("a green or white permanent"). Each form is read by a rule that names it
// and nothing wider; the neighbours the rule must NOT read are pinned below.
//
// Two layers:
//
//  1. GOLDENS — a REAL corpus card per accepted form, compared whole
//     (`sortKeys` equality). Where the smoke generator cannot build the
//     `forEach` / `$each` script the card is also a registered
//     `GOLDEN_FIXTURES` row, and the golden here asserts the fixture takes the
//     card all the way to `ready`.
//  2. REFUSALS — the neighbours that stay `unparsed`.
//
// Dystopia's golden uses its second line only: the card also prints
// "Cumulative upkeep—Pay 1 life.", a separate Grammar Gap, so the real row
// cannot compile and has no fixture.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** A probe whose Oracle text is exactly `oracleText` on a sorcery. */
function sorcery(oracleText: string) {
    return compileCard(
        oracleCard({
            name: "Refusal Probe",
            manaCost: "{2}{R}",
            typeLine: "Sorcery",
            oracleText,
            power: undefined,
            toughness: undefined,
        })
    );
}

const PYROCLASM: OracleCard = {
    oracleId: "e4bcd4ea-e7cd-4471-8f3b-18bb51d3d70c",
    name: "Pyroclasm",
    manaCost: "{1}{R}",
    typeLine: "Sorcery",
    oracleText: "Pyroclasm deals 2 damage to each creature.",
    layout: "normal",
};

const PYROCLASM_DEFINITION: CompiledDefinition = {
    name: "Pyroclasm",
    types: ["Sorcery"],
    manaCost: { X: 1, R: 1 },
    oracleText: "Pyroclasm deals 2 damage to each creature.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
            },
            effects: [{ op: "dealDamage", amount: 2, to: { ref: "$each" } }],
        },
    ],
};

const SIMOON: OracleCard = {
    oracleId: "128e201a-f520-4917-a1a4-2f3836f1f92d",
    name: "Simoon",
    manaCost: "{R}{G}",
    typeLine: "Instant",
    oracleText:
        "Simoon deals 1 damage to each creature target opponent controls.",
    layout: "normal",
};

const SIMOON_DEFINITION: CompiledDefinition = {
    name: "Simoon",
    types: ["Instant"],
    manaCost: { R: 1, G: 1 },
    oracleText:
        "Simoon deals 1 damage to each creature target opponent controls.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature" },
                controller: { target: 0 },
            },
            effects: [{ op: "dealDamage", amount: 1, to: { ref: "$each" } }],
        },
    ],
    targetRequirement: { type: "player", count: 1, controller: "opponent" },
};

const EARTHQUAKE: OracleCard = {
    oracleId: "9a40614b-50a3-422c-849e-53c8b7d3d204",
    name: "Earthquake",
    manaCost: "{X}{R}",
    typeLine: "Sorcery",
    oracleText:
        "Earthquake deals X damage to each creature without flying and each player.",
    layout: "normal",
};

const EARTHQUAKE_DEFINITION: CompiledDefinition = {
    name: "Earthquake",
    types: ["Sorcery"],
    manaCost: { X: "X", R: 1 },
    oracleText:
        "Earthquake deals X damage to each creature without flying and each player.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", excludeAbility: "flying" },
            },
            effects: [
                { op: "dealDamage", amount: { X: true }, to: { ref: "$each" } },
            ],
        },
        {
            op: "forEach",
            select: { set: "players" },
            effects: [
                {
                    op: "dealDamage",
                    amount: { X: true },
                    to: { player: { ref: "$each" } },
                },
            ],
        },
    ],
};

const PERISH: OracleCard = {
    oracleId: "dd84d291-cb7a-4f44-81cd-9f1181bb5ae5",
    name: "Perish",
    manaCost: "{2}{B}",
    typeLine: "Sorcery",
    oracleText: "Destroy all green creatures. They can't be regenerated.",
    layout: "normal",
};

const PERISH_DEFINITION: CompiledDefinition = {
    name: "Perish",
    types: ["Sorcery"],
    manaCost: { X: 2, B: 1 },
    oracleText: "Destroy all green creatures. They can't be regenerated.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", color: "G" },
            },
            effects: [
                {
                    op: "destroy",
                    target: { ref: "$each" },
                    cantBeRegenerated: true,
                },
            ],
        },
    ],
};

const RIPTIDE: OracleCard = {
    oracleId: "b4541f38-23c1-4f51-a35b-0b222cdaed2c",
    name: "Riptide",
    manaCost: "{U}",
    typeLine: "Instant",
    oracleText: "Tap all blue creatures.",
    layout: "normal",
};

const RIPTIDE_DEFINITION: CompiledDefinition = {
    name: "Riptide",
    types: ["Instant"],
    manaCost: { U: 1 },
    oracleText: "Tap all blue creatures.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Creature", color: "U" },
            },
            effects: [
                { op: "tapUntap", action: "tap", target: { ref: "$each" } },
            ],
        },
    ],
};

const GUARDIANS_PLEDGE: OracleCard = {
    oracleId: "32d78ffd-5bed-45e8-be6a-420149a263bb",
    name: "Guardians' Pledge",
    manaCost: "{1}{W}{W}",
    typeLine: "Instant",
    oracleText: "White creatures you control get +2/+2 until end of turn.",
    layout: "normal",
};

const GUARDIANS_PLEDGE_DEFINITION: CompiledDefinition = {
    name: "Guardians' Pledge",
    types: ["Instant"],
    manaCost: { X: 1, W: 2 },
    oracleText: "White creatures you control get +2/+2 until end of turn.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                controller: "controller",
                filter: { type: "Creature", color: "W" },
            },
            effects: [
                {
                    op: "pump",
                    target: { ref: "$each" },
                    power: 2,
                    toughness: 2,
                    duration: { phase: "end-of-turn" },
                },
            ],
        },
    ],
};

const UPHEAVAL: OracleCard = {
    oracleId: "7cafc972-a6f5-4cac-a3d3-8a3ae36ffb1e",
    name: "Upheaval",
    manaCost: "{4}{U}{U}",
    typeLine: "Sorcery",
    oracleText: "Return all permanents to their owners' hands.",
    layout: "normal",
};

const UPHEAVAL_DEFINITION: CompiledDefinition = {
    name: "Upheaval",
    types: ["Sorcery"],
    manaCost: { X: 4, U: 2 },
    oracleText: "Return all permanents to their owners' hands.",
    effects: [
        {
            op: "forEach",
            select: { set: "permanents", zone: "battlefield" },
            effects: [{ op: "moveZone", target: { ref: "$each" }, to: "hand" }],
        },
    ],
};

const POWDER_KEG: OracleCard = {
    oracleId: "ca1144c2-49a3-49b4-9085-3094141769ea",
    name: "Powder Keg",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText:
        "At the beginning of your upkeep, you may put a fuse counter on this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
    layout: "normal",
};

const POWDER_KEG_DEFINITION: CompiledDefinition = {
    name: "Powder Keg",
    types: ["Artifact"],
    manaCost: { X: 2 },
    oracleText:
        "At the beginning of your upkeep, you may put a fuse counter on this artifact.\n{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
    activatedAbilities: [
        {
            id: "powder-keg-ability",
            oracleText:
                "{T}, Sacrifice this artifact: Destroy each artifact and creature with mana value equal to the number of fuse counters on this artifact.",
            cost: { tap: true, sacrifice: true },
            useStack: true,
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: ["Artifact", "Creature"] },
                    },
                    effects: [
                        {
                            op: "if",
                            predicate: {
                                left: { manaValue: { of: { ref: "$each" } } },
                                op: "eq",
                                right: {
                                    counters: {
                                        of: { ref: "$source" },
                                        type: "fuse",
                                    },
                                },
                            },
                            then: [{ op: "destroy", target: { ref: "$each" } }],
                        },
                    ],
                },
            ],
        },
    ],
    compiledTriggeredAbilities: [
        {
            id: "powder-keg-trigger",
            oracleText:
                "At the beginning of your upkeep, you may put a fuse counter on this artifact.",
            head: { kind: "phase", phase: "UPKEEP", scope: "your" },
            effects: [
                {
                    op: "mayPay",
                    player: "controller",
                    prompt: "Put a fuse counter on this artifact?",
                    bind: "$may1",
                },
                {
                    op: "if",
                    predicate: { binding: "$may1" },
                    then: [
                        {
                            op: "counters",
                            action: "add",
                            counter: "fuse",
                            target: { ref: "$source" },
                            count: 1,
                        },
                    ],
                },
            ],
        },
    ],
};

const TRANQUIL_DOMAIN: OracleCard = {
    oracleId: "87547bf0-02cf-4d83-9a1f-c82d2f1a22f1",
    name: "Tranquil Domain",
    manaCost: "{1}{G}",
    typeLine: "Instant",
    oracleText: "Destroy all non-Aura enchantments.",
    layout: "normal",
};

const TRANQUIL_DOMAIN_DEFINITION: CompiledDefinition = {
    name: "Tranquil Domain",
    types: ["Instant"],
    manaCost: { X: 1, G: 1 },
    oracleText: "Destroy all non-Aura enchantments.",
    effects: [
        {
            op: "forEach",
            select: {
                set: "permanents",
                zone: "battlefield",
                filter: { type: "Enchantment", excludeSubtype: "Aura" },
            },
            effects: [{ op: "destroy", target: { ref: "$each" } }],
        },
    ],
};

const GOBLIN_PYROMANCER: OracleCard = {
    oracleId: "696ee797-0c32-4bff-8c3d-02d05835b138",
    name: "Goblin Pyromancer",
    manaCost: "{3}{R}",
    typeLine: "Creature — Goblin Wizard",
    oracleText:
        "When this creature enters, Goblin creatures get +3/+0 until end of turn.\nAt the beginning of the end step, destroy all Goblins.",
    power: "2",
    toughness: "2",
    layout: "normal",
};

const GOBLIN_PYROMANCER_DEFINITION: CompiledDefinition = {
    name: "Goblin Pyromancer",
    types: ["Creature"],
    subtypes: ["Goblin", "Wizard"],
    manaCost: { X: 3, R: 1 },
    power: 2,
    toughness: 2,
    oracleText:
        "When this creature enters, Goblin creatures get +3/+0 until end of turn.\nAt the beginning of the end step, destroy all Goblins.",
    compiledTriggeredAbilities: [
        {
            id: "goblin-pyromancer-trigger",
            oracleText:
                "When this creature enters, Goblin creatures get +3/+0 until end of turn.",
            head: { kind: "entered", scope: "self" },
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { type: "Creature", subtype: "Goblin" },
                    },
                    effects: [
                        {
                            op: "pump",
                            target: { ref: "$each" },
                            power: 3,
                            toughness: 0,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                },
            ],
        },
        {
            id: "goblin-pyromancer-trigger-2",
            oracleText:
                "At the beginning of the end step, destroy all Goblins.",
            head: { kind: "phase", phase: "END_STEP", scope: "each" },
            effects: [
                {
                    op: "forEach",
                    select: {
                        set: "permanents",
                        zone: "battlefield",
                        filter: { subtype: "Goblin" },
                    },
                    effects: [{ op: "destroy", target: { ref: "$each" } }],
                },
            ],
        },
    ],
};

const DYSTOPIA_UPKEEP: OracleCard = {
    oracleId: "d0e6203b-cef2-470f-8c79-7b139290e2d5",
    name: "Dystopia",
    manaCost: "{1}{B}{B}",
    typeLine: "Enchantment",
    oracleText:
        "At the beginning of each player's upkeep, that player sacrifices a green or white permanent of their choice.",
    layout: "normal",
};

const DYSTOPIA_UPKEEP_DEFINITION: CompiledDefinition = {
    name: "Dystopia",
    types: ["Enchantment"],
    manaCost: { X: 1, B: 2 },
    oracleText:
        "At the beginning of each player's upkeep, that player sacrifices a green or white permanent of their choice.",
    compiledTriggeredAbilities: [
        {
            id: "dystopia-trigger",
            oracleText:
                "At the beginning of each player's upkeep, that player sacrifices a green or white permanent of their choice.",
            head: { kind: "phase", phase: "UPKEEP", scope: "each" },
            effects: [
                {
                    op: "choice",
                    kind: "sacrifice-permanents",
                    player: { ref: "$event.activePlayerId" },
                    zone: "battlefield",
                    filter: {
                        type: [
                            "Artifact",
                            "Battle",
                            "Creature",
                            "Enchantment",
                            "Land",
                            "Planeswalker",
                        ],
                        color: ["G", "W"],
                    },
                    count: 1,
                    prompt: "Sacrifice a green or white permanent.",
                    bind: "$sacrifice1",
                },
                { op: "sacrifice", permanents: { ref: "$sacrifice1" } },
            ],
        },
    ],
};

describe("mass subjects (issue #4557) — goldens", () => {
    it("Pyroclasm: damage to a bare 'each creature'", () => {
        expect(sortKeys(compiled(PYROCLASM))).toEqual(
            sortKeys(PYROCLASM_DEFINITION)
        );
    });

    it("Simoon: damage to 'each creature target opponent controls'", () => {
        expect(sortKeys(compiled(SIMOON))).toEqual(sortKeys(SIMOON_DEFINITION));
    });

    it("Earthquake: damage to 'each creature without flying and each player'", () => {
        expect(sortKeys(compiled(EARTHQUAKE))).toEqual(
            sortKeys(EARTHQUAKE_DEFINITION)
        );
    });

    it("Perish: destroy a colour sweep, 'They can't be regenerated.'", () => {
        expect(sortKeys(compiled(PERISH))).toEqual(sortKeys(PERISH_DEFINITION));
    });

    it("Riptide: tap a colour sweep", () => {
        expect(sortKeys(compiled(RIPTIDE))).toEqual(
            sortKeys(RIPTIDE_DEFINITION)
        );
    });

    it("Guardians' Pledge: pump a colour sweep you control", () => {
        expect(sortKeys(compiled(GUARDIANS_PLEDGE))).toEqual(
            sortKeys(GUARDIANS_PLEDGE_DEFINITION)
        );
    });

    it("Upheaval: bounce every permanent to its owner's hand", () => {
        expect(sortKeys(compiled(UPHEAVAL))).toEqual(
            sortKeys(UPHEAVAL_DEFINITION)
        );
    });

    it("Powder Keg: destroy by mana value equal to the fuse counters on this artifact", () => {
        expect(sortKeys(compiled(POWDER_KEG))).toEqual(
            sortKeys(POWDER_KEG_DEFINITION)
        );
    });

    it("Tranquil Domain: destroy all non-Aura enchantments", () => {
        expect(sortKeys(compiled(TRANQUIL_DOMAIN))).toEqual(
            sortKeys(TRANQUIL_DOMAIN_DEFINITION)
        );
    });

    it("Goblin Pyromancer: pump a bare subtype group", () => {
        expect(sortKeys(compiled(GOBLIN_PYROMANCER))).toEqual(
            sortKeys(GOBLIN_PYROMANCER_DEFINITION)
        );
    });

    it("Dystopia (upkeep line): an edict over a printed green-or-white is a colour OR-list", () => {
        expect(sortKeys(compiled(DYSTOPIA_UPKEEP))).toEqual(
            sortKeys(DYSTOPIA_UPKEEP_DEFINITION)
        );
    });
});

describe("mass subjects — golden fixtures take the card to ready", () => {
    it.each([
        "Earthquake",
        "Perish",
        "Riptide",
        "Guardians' Pledge",
        "Upheaval",
        "Powder Keg",
        "Tranquil Domain",
        "Goblin Pyromancer",
    ])("%s", (name) => {
        const fixture = GOLDEN_FIXTURES.find((f) => f.card.name === name);
        expect(fixture).toBeDefined();
        expect(compileCard(fixture!.card).state).toBe("ready");
    });
});

describe("mass subjects — refusals stay fail-closed", () => {
    it.each([
        [
            "another card type as a damage recipient",
            "Refusal Probe deals 2 damage to each artifact.",
        ],
        [
            "'all creatures' as a damage recipient (the recipient is 'each')",
            "Refusal Probe deals 2 damage to all creatures.",
        ],
        [
            "a keyword exclusion on a destroy sweep (damage only)",
            "Destroy each creature without flying.",
        ],
        [
            "an announced PLAYER's creatures (only an opponent is read)",
            "Refusal Probe deals 1 damage to each creature target player controls.",
        ],
        [
            "a keyword exclusion AND an announced opponent together",
            "Refusal Probe deals 1 damage to each creature without flying target opponent controls.",
        ],
        [
            "an announced opponent's creatures joined to 'each player'",
            "Refusal Probe deals 1 damage to each creature target opponent controls and each player.",
        ],
        ["several colours on a sweep", "Destroy all white or black creatures."],
        ["stacked colours on a sweep", "Destroy all white black creatures."],
        [
            "a bare plural with no subtype and no controller",
            "Creatures get +1/+1 until end of turn.",
        ],
        [
            "the plural destination behind a single object",
            "Return target creature to their owners' hands.",
        ],
        [
            "a sweep bounced to a hand that is not its owners'",
            "Return all permanents to your hand.",
        ],
        [
            "'It can't be regenerated.' behind a sweep (the pronoun is plural)",
            "Destroy all green creatures. It can't be regenerated.",
        ],
        [
            "'They can't be regenerated.' behind one object",
            "Destroy target creature. They can't be regenerated.",
        ],
        [
            "'They can't be regenerated.' behind nothing",
            "They can't be regenerated.",
        ],
        [
            "a stacked-colour edict (an AND the OR-list cannot say)",
            "Target opponent sacrifices a green white permanent of their choice.",
        ],
        [
            "tap + 'loses all unspent mana' (no mana-pool Op — Mana Short)",
            "Tap all lands target player controls and that player loses all unspent mana.",
        ],
    ])("refuses %s", (_what, text) => {
        expect(sorcery(text).state).toBe("unparsed");
    });

    it("a counter tally on an object that is not THIS artifact is refused", () => {
        const outcome = compileCard(
            oracleCard({
                name: "Refusal Probe",
                manaCost: "{2}",
                typeLine: "Artifact",
                oracleText:
                    "{T}, Sacrifice this artifact: Destroy each artifact with mana value equal to the number of fuse counters on target artifact.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});
