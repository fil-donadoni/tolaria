// Cost taxes (issue #4560) — the Grammar Cluster of static taxes on casting,
// activating and attacking:
//
//   "Noncreature spells cost {1} more to cast"            CR 601.2f, excludeTypes
//   "Artifact and enchantment spells … cost {2} more"     CR 601.2f, a type union
//   "Each spell costs {3} more to cast except during
//    its controller's turn"                               CR 601.2f / 601.2a
//   "Activated abilities of <permanents> cost {N} more
//    to activate"                                         CR 602.2b
//   "Creatures can't attack you unless their controller
//    pays {N} for each creature they control that's
//    attacking you"                                       CR 508.1d / 508.1h
//
// Goldens compile REAL corpus Oracle rows and pin the WHOLE definition; the
// refusals pin the printed neighbours the rules must not read; the behaviour
// block runs the rebuilt effects through the engine's own collectors
// (`getCostModifiers`, `collectAttackManaTax`), which is where a descriptor
// that parsed but lowered wrong would show.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { OracleCard } from "../types";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { getCostModifiers } from "../../gre/state";
import { collectAttackManaTax } from "../../gre/combat";

function golden(card: OracleCard, expected: object): void {
    const outcome = compileCard(card);
    expect(outcome.state, JSON.stringify(outcome)).not.toBe("unparsed");
    if (outcome.state === "unparsed") return;
    expect(sortKeys(outcome.definition)).toEqual(sortKeys(expected));
}

function refused(card: OracleCard): void {
    expect(compileCard(card).state).toBe("unparsed");
}

// ── Real corpus rows ───────────────────────────────────────────────────────

const THALIA: OracleCard = {
    oracleId: "9b7f1d05-707c-4ed3-9f0e-8ced1232c2ee",
    name: "Thalia, Guardian of Thraben",
    manaCost: "{1}{W}",
    typeLine: "Legendary Creature — Human Soldier",
    oracleText: "First strike\nNoncreature spells cost {1} more to cast.",
    power: "2",
    toughness: "1",
};

const AURA_OF_SILENCE: OracleCard = {
    oracleId: "e7faf8eb-e829-4109-8dfe-42865a23ba86",
    name: "Aura of Silence",
    manaCost: "{1}{W}{W}",
    typeLine: "Enchantment",
    oracleText:
        "Artifact and enchantment spells your opponents cast cost {2} more to cast.\nSacrifice this enchantment: Destroy target artifact or enchantment.",
};

const DEFENSE_GRID: OracleCard = {
    oracleId: "22ba474e-f6e6-450d-a4cf-0739f0b51079",
    name: "Defense Grid",
    manaCost: "{2}",
    typeLine: "Artifact",
    oracleText:
        "Each spell costs {3} more to cast except during its controller's turn.",
};

const GLOOM: OracleCard = {
    oracleId: "4d022f53-b1fb-4071-afcc-0af3214fe604",
    name: "Gloom",
    manaCost: "{2}{B}",
    typeLine: "Enchantment",
    oracleText:
        "White spells cost {3} more to cast.\nActivated abilities of white enchantments cost {3} more to activate.",
};

const GHOSTLY_PRISON: OracleCard = {
    oracleId: "e828b189-0e8f-43b8-b909-4c23e742e028",
    name: "Ghostly Prison",
    manaCost: "{2}{W}",
    typeLine: "Enchantment",
    oracleText:
        "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you.",
};

// ── Goldens — one per accepted form ────────────────────────────────────────

describe("cost taxes — goldens", () => {
    it("Noncreature spells: a negated class (CR 601.2f / 205.4b)", () => {
        golden(THALIA, {
            name: "Thalia, Guardian of Thraben",
            types: ["Creature"],
            supertypes: ["Legendary"],
            subtypes: ["Human", "Soldier"],
            manaCost: { X: 1, W: 1 },
            power: 2,
            toughness: 1,
            oracleText: THALIA.oracleText,
            staticAbilities: ["first strike"],
            compiledStaticEffects: [
                {
                    kind: "cost-modifier",
                    spells: { excludeTypes: ["Creature"] },
                    increase: 1,
                },
            ],
        });
    });

    it("a union of bare card types, opponent-scoped (CR 601.2f)", () => {
        golden(AURA_OF_SILENCE, {
            name: "Aura of Silence",
            types: ["Enchantment"],
            manaCost: { X: 1, W: 2 },
            oracleText: AURA_OF_SILENCE.oracleText,
            activatedAbilities: [
                {
                    id: "aura-of-silence-ability",
                    oracleText:
                        "Sacrifice this enchantment: Destroy target artifact or enchantment.",
                    cost: { sacrifice: true },
                    useStack: true,
                    effects: [{ op: "destroy", target: { target: 0 } }],
                    targetRequirement: {
                        type: ["Artifact", "Enchantment"],
                        count: 1,
                    },
                },
            ],
            compiledStaticEffects: [
                {
                    kind: "cost-modifier",
                    spells: {
                        types: ["Artifact", "Enchantment"],
                        controller: "opponents",
                    },
                    increase: 2,
                },
            ],
        });
    });

    it("the off-turn tax (CR 601.2f / 601.2a)", () => {
        golden(DEFENSE_GRID, {
            name: "Defense Grid",
            types: ["Artifact"],
            manaCost: { X: 2 },
            oracleText: DEFENSE_GRID.oracleText,
            compiledStaticEffects: [
                {
                    kind: "cost-modifier",
                    spells: {},
                    onlyOutsideAnnouncersTurn: true,
                    increase: 3,
                },
            ],
        });
    });

    it("an activated-ability tax on a permanent class (CR 602.2b)", () => {
        golden(GLOOM, {
            name: "Gloom",
            types: ["Enchantment"],
            manaCost: { X: 2, B: 1 },
            oracleText: GLOOM.oracleText,
            compiledStaticEffects: [
                {
                    kind: "cost-modifier",
                    spells: { colors: ["W"] },
                    increase: 3,
                },
                {
                    kind: "cost-modifier",
                    abilities: { types: ["Enchantment"], colors: ["W"] },
                    increase: 3,
                },
            ],
        });
    });

    it("the per-attacker attack tax (CR 508.1d / 508.1h)", () => {
        golden(GHOSTLY_PRISON, {
            name: "Ghostly Prison",
            types: ["Enchantment"],
            manaCost: { X: 2, W: 1 },
            oracleText: GHOSTLY_PRISON.oracleText,
            compiledStaticEffects: [
                {
                    kind: "attack-mana-tax",
                    id: "ghostly-prison-attack-tax",
                    oracleText: GHOSTLY_PRISON.oracleText,
                    attackers: { types: ["Creature"] },
                    perAttacker: 2,
                },
            ],
        });
    });
});

// ── Refusals — printed neighbours the rules must not read ──────────────────

describe("cost taxes — refused neighbours", () => {
    const line = (oracleText: string): OracleCard => ({
        oracleId: "neighbour",
        name: "Neighbour",
        manaCost: "{2}",
        typeLine: "Enchantment",
        oracleText,
    });

    it("REFUSES a negated colour on an attack tax — PermanentFilter has no excludeColors (Elephant Grass)", () => {
        refused(
            line(
                "Nonblack creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."
            )
        );
    });

    it("REFUSES a union that is not of bare card types (Spectacle Mage)", () => {
        refused(
            line(
                "Instant and sorcery spells you cast with mana value 5 or greater cost {1} less to cast."
            )
        );
    });

    it("REFUSES an activation-cost REDUCTION (Sam, Loyal Attendant)", () => {
        refused(
            line(
                "Activated abilities of Foods you control cost {1} less to activate."
            )
        );
    });

    it("REFUSES a singular, attached subject (Oppressive Rays)", () => {
        refused(
            line(
                "Activated abilities of enchanted creature cost {3} more to activate."
            )
        );
    });

    it("REFUSES a chosen-name source class (Skyseer's Chariot)", () => {
        refused(
            line(
                "Activated abilities of sources with the chosen name cost {2} more to activate."
            )
        );
    });
});

// ── Behaviour — the rebuilt effects through the engine's collectors ────────

function asDefinition(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed") throw new Error("unparsed");
    return { ...outcome.definition, id: card.oracleId, rarity: "common" };
}

const SORCERY: CardDefinition = {
    id: "tax-test-sorcery",
    name: "Tax Test Sorcery",
    rarity: "common",
    types: ["Sorcery"],
    manaCost: { X: 1 },
};
const BEAR: CardDefinition = {
    id: "tax-test-bear",
    name: "Tax Test Bear",
    rarity: "common",
    types: ["Creature"],
    manaCost: { X: 2 },
    power: 2,
    toughness: 2,
};
const WHITE_ENCHANTMENT: CardDefinition = {
    id: "tax-test-white-enchantment",
    name: "Tax Test White Enchantment",
    rarity: "common",
    types: ["Enchantment"],
    manaCost: { W: 1 },
};
const GREEN_ENCHANTMENT: CardDefinition = {
    id: "tax-test-green-enchantment",
    name: "Tax Test Green Enchantment",
    rarity: "common",
    types: ["Enchantment"],
    manaCost: { G: 1 },
};

function withDefinitions(defs: CardDefinition[], fn: () => void): void {
    const [head, ...rest] = defs;
    if (head === undefined) return fn();
    withTemporaryDefinition(head, () => withDefinitions(rest, fn));
}

describe("cost taxes — behaviour through the engine", () => {
    it("taxes a noncreature spell and spares a creature spell (CR 601.2f)", () => {
        const thalia = asDefinition(THALIA);
        withDefinitions([thalia, SORCERY, BEAR], () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [makeInstance(thalia.id, { id: "t" })],
                    }),
                    makePlayer("p2"),
                ],
            });
            const sorcery = makeInstance(SORCERY.id, { zone: "hand" });
            const bear = makeInstance(BEAR.id, { zone: "hand" });
            expect(getCostModifiers(state, sorcery, "spell").increase).toEqual({
                X: 1,
            });
            expect(getCostModifiers(state, bear, "spell").increase).toEqual({});
        });
    });

    it("taxes a spell only outside its caster's turn (CR 601.2f / 601.2a)", () => {
        const grid = asDefinition(DEFENSE_GRID);
        withDefinitions([grid, SORCERY], () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [makeInstance(grid.id, { id: "g" })],
                    }),
                    makePlayer("p2"),
                ],
                activePlayerId: "p1",
            });
            const onTurn = makeInstance(SORCERY.id, {
                zone: "hand",
                controllerId: "p1",
            });
            const offTurn = makeInstance(SORCERY.id, {
                zone: "hand",
                controllerId: "p2",
            });
            expect(getCostModifiers(state, onTurn, "spell").increase).toEqual(
                {}
            );
            expect(getCostModifiers(state, offTurn, "spell").increase).toEqual({
                X: 3,
            });
            // The gate reads the ANNOUNCER (CR 601.2a), not the card's
            // controller: p1 casting p2's card on p1's turn is untaxed.
            expect(
                getCostModifiers(state, offTurn, "spell", undefined, "p1")
                    .increase
            ).toEqual({});
        });
    });

    it("taxes the abilities of a white enchantment only (CR 602.2b)", () => {
        const gloom = asDefinition(GLOOM);
        withDefinitions([gloom, WHITE_ENCHANTMENT, GREEN_ENCHANTMENT], () => {
            const white = makeInstance(WHITE_ENCHANTMENT.id, { id: "w" });
            const green = makeInstance(GREEN_ENCHANTMENT.id, { id: "gr" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            makeInstance(gloom.id, { id: "gloom" }),
                            white,
                            green,
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(getCostModifiers(state, white, "ability").increase).toEqual({
                X: 3,
            });
            expect(getCostModifiers(state, green, "ability").increase).toEqual(
                {}
            );
            // The spell line and the ability line are separate effects: a
            // white enchantment SPELL pays the spell tax once, not twice.
            const whiteSpell = makeInstance(WHITE_ENCHANTMENT.id, {
                zone: "hand",
            });
            expect(
                getCostModifiers(state, whiteSpell, "spell").increase
            ).toEqual({ X: 3 });
        });
    });

    it("charges {2} per creature attacking the prison's controller (CR 508.1d)", () => {
        const prison = asDefinition(GHOSTLY_PRISON);
        withDefinitions([prison, BEAR], () => {
            const attackers = ["a1", "a2"].map((id) =>
                makeInstance(BEAR.id, {
                    id,
                    controllerId: "p1",
                    isAttacking: true,
                })
            );
            const state = makeState({
                players: [
                    makePlayer("p1", { battlefield: attackers }),
                    makePlayer("p2", {
                        battlefield: [
                            makeInstance(prison.id, {
                                id: "prison",
                                controllerId: "p2",
                            }),
                        ],
                    }),
                ],
                phase: "DECLARE_ATTACKERS",
                activePlayerId: "p1",
                priorityPlayerId: "p1",
                combat: {
                    attackerIds: ["a1", "a2"],
                    blockerAssignments: {},
                    confirmed: false,
                    blockersConfirmed: false,
                },
            });
            const charges = collectAttackManaTax(state);
            expect(charges.map((c) => [c.controllerId, c.cost])).toEqual([
                ["p1", { X: 2 }],
                ["p1", { X: 2 }],
            ]);
        });
    });
});
