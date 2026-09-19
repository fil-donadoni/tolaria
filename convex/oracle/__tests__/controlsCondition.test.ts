// "you control a <colour> …" conditions and the "… instead" upgrade (issue
// #4126): the Apocalypse Sanctuaries and Minotaur Tactician.
//
//  1. GRAMMAR — a "<colour> or <colour>" descriptor (CR 105.1) is one
//     adjective, and nothing else joins it; cost sites still refuse colours.
//  2. GOLDEN fixtures — Raka Sanctuary (the damage replacement) and Minotaur
//     Tactician (two conditional statics) compiled whole. The other four
//     Sanctuaries are `GOLDEN_FIXTURES` rows (`goldenFixtures.test.ts`).
//  3. REFUSALS — the neighbours the rule must not read.
//  4. ENGINE — each seam the compiled output leans on, run for real: the
//     trigger gate reads LIVE colours off the raw game state, the upgrade's
//     nested `if` counts colours at resolution (one two-colour permanent
//     satisfies both clauses), the conditional static buffs in layer 7c and
//     survives the wire, and the three hand-written cards moved off `pt-cda`
//     keep their bonus under a layer-7b set.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards/catalogue";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import { withTemporaryDefinition } from "../../cards/registry";
import type {
    CardDefinition,
    PermanentView,
    TriggerStateView,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { resolveTopOfStack } from "../../gre/state";
import { compileCard } from "../compile";
import { conditionRule } from "../grammar/shared/condition";
import { sentenceRule } from "../grammar/shared/effectClause";
import {
    descriptorRule,
    permanentFilterFromDescriptor,
} from "../grammar/shared/targetFilter";
import type { OracleCard } from "../types";
import { oracleCard, parseContext } from "./fixtures";

function compiled(card: OracleCard): CardDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition as CardDefinition;
}

const PERMANENT_TYPES = [
    "Artifact",
    "Battle",
    "Creature",
    "Enchantment",
    "Land",
    "Planeswalker",
];

describe("colour disjunction in a descriptor (CR 105.1)", () => {
    it('reads "blue or black permanent" as either colour', () => {
        const parsed = conditionRule.run(
            "if you control a blue or black permanent",
            parseContext()
        );
        expect(parsed.ok && parsed.value).toEqual({
            kind: "controls",
            filter: { types: PERMANENT_TYPES, colors: ["U", "B"] },
            atLeast: 1,
        });
    });

    it.each([
        [
            "a third colour beside the disjunction",
            "white blue or black permanent",
        ],
        ["one colour twice", "blue or blue permanent"],
        ["a disjunction after a colour", "blue black or red permanent"],
    ])("refuses %s", (_what, span) => {
        expect(descriptorRule.run(span, parseContext()).ok).toBe(false);
    });

    it("keeps refusing a colour at a cost site (no colour reader there)", () => {
        const descriptor = descriptorRule.run("black creature", parseContext());
        expect(descriptor.ok).toBe(true);
        if (!descriptor.ok) return;
        expect(permanentFilterFromDescriptor(descriptor.value).ok).toBe(false);
        expect(
            permanentFilterFromDescriptor(descriptor.value, { colors: true }).ok
        ).toBe(true);
    });
});

const RAKA: OracleCard = {
    oracleId: "0b085c90-95df-4823-ba67-9eb398b1ec94",
    name: "Raka Sanctuary",
    manaCost: "{2}{R}",
    typeLine: "Enchantment",
    oracleText:
        "At the beginning of your upkeep, if you control a white or blue permanent, this enchantment deals 1 damage to target creature. If you control a white permanent and a blue permanent, this enchantment deals 3 damage instead.",
    layout: "normal",
};

const MINOTAUR: OracleCard = {
    oracleId: "197fd850-0a08-4e82-9249-a8d719436f77",
    name: "Minotaur Tactician",
    manaCost: "{3}{R}",
    typeLine: "Creature — Minotaur",
    oracleText:
        "Haste\nThis creature gets +1/+1 as long as you control a white creature.\nThis creature gets +1/+1 as long as you control a blue creature.",
    power: "1",
    toughness: "1",
    layout: "normal",
};

/** `{ count: <colour> permanents you control } >= 1` (CR 109.5 "you"). */
function controls(color: string) {
    return {
        left: {
            count: {
                zone: "battlefield",
                controller: "controller",
                filter: { type: PERMANENT_TYPES, color: [color] },
            },
        },
        op: "ge",
        right: 1,
    };
}

describe("golden fixtures (CR 603.4, CR 608.2c, CR 611.3a)", () => {
    it("Raka Sanctuary — the damage replacement keeps the one announced target", () => {
        const base = { op: "dealDamage", amount: 1, to: { target: 0 } };
        expect(compiled(RAKA)).toEqual({
            name: "Raka Sanctuary",
            types: ["Enchantment"],
            manaCost: { X: 2, R: 1 },
            oracleText: RAKA.oracleText,
            compiledTriggeredAbilities: [
                {
                    id: "raka-sanctuary-trigger",
                    oracleText: RAKA.oracleText,
                    head: { kind: "phase", phase: "UPKEEP", scope: "your" },
                    condition: {
                        kind: "controls",
                        filter: {
                            types: PERMANENT_TYPES,
                            colors: ["W", "U"],
                        },
                        atLeast: 1,
                    },
                    targetRequirement: { type: "Creature", count: 1 },
                    effects: [
                        {
                            op: "if",
                            predicate: controls("W"),
                            then: [
                                {
                                    op: "if",
                                    predicate: controls("U"),
                                    then: [
                                        {
                                            op: "dealDamage",
                                            amount: 3,
                                            to: { target: 0 },
                                        },
                                    ],
                                    else: [base],
                                },
                            ],
                            else: [base],
                        },
                    ],
                },
            ],
        });
    });

    it("Minotaur Tactician — one conditional self buff per line", () => {
        const buff = (color: string) => ({
            kind: "pt-buff",
            appliesTo: "self",
            power: 1,
            toughness: 1,
            condition: {
                kind: "controls",
                filter: { types: ["Creature"], colors: [color] },
                atLeast: 1,
            },
        });
        expect(compiled(MINOTAUR)).toEqual({
            name: "Minotaur Tactician",
            types: ["Creature"],
            subtypes: ["Minotaur"],
            manaCost: { X: 3, R: 1 },
            power: 1,
            toughness: 1,
            oracleText: MINOTAUR.oracleText,
            staticAbilities: ["haste"],
            compiledStaticEffects: [buff("W"), buff("U")],
        });
    });
});

describe("refused neighbours (fail-closed)", () => {
    it('refuses an "as long as" whose condition is not "you control" (Water Wurm)', () => {
        const outcome = compileCard(
            oracleCard({
                name: "Water Wurm",
                manaCost: "{U}",
                typeLine: "Creature — Wurm",
                oracleText:
                    "This creature gets +0/+1 as long as an opponent controls an Island.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
    });

    it.each([
        [
            "a single controls clause",
            "If you control a black permanent, you gain 4 life instead",
        ],
        [
            "three controls clauses",
            "If you control a black permanent and a red permanent and a green permanent, you gain 4 life instead",
        ],
    ])("refuses %s", (_what, span) => {
        expect(sentenceRule.run(span, parseContext()).ok).toBe(false);
    });

    it.each([
        [
            "a different duration",
            "Target creature gets +1/+1 until end of turn. If you control a blue permanent and a black permanent, that creature gets +5/+5 until your next turn instead.",
        ],
        [
            '"that player" where the base effect named you',
            "You gain 2 life. If you control a black permanent and a red permanent, that player gains 4 life instead.",
        ],
        [
            "a gain turned into a loss",
            "You gain 2 life. If you control a black permanent and a red permanent, you lose 4 life instead.",
        ],
        [
            '"instead" with no effect in front of it',
            "If you control a black permanent and a red permanent, you gain 4 life instead.",
        ],
    ])("refuses an upgrade with %s", (_what, oracleText) => {
        const outcome = compileCard(
            oracleCard({
                name: "Test Card",
                manaCost: "{2}{W}",
                typeLine: "Sorcery",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

// ── Engine ─────────────────────────────────────────────────────────────────

const card = (name: string) => getCardByName(name).id;

describe("the trigger gate reads live colours (CR 603.4, CR 105.2)", () => {
    const dega = {
        ...compiled({
            oracleId: "75c626fb-9dfc-4a94-b59f-f0e45c7b2f56",
            name: "Dega Sanctuary",
            manaCost: "{2}{W}",
            typeLine: "Enchantment",
            oracleText:
                "At the beginning of your upkeep, if you control a black or red permanent, you gain 2 life. If you control a black permanent and a red permanent, you gain 4 life instead.",
            layout: "normal",
        }),
        id: "compiled-dega-4126",
        rarity: "uncommon" as const,
    };

    function gateOn(battlefield: string[]): boolean {
        return withTemporaryDefinition(dega, () => {
            const source = makeInstance(dega.id, { id: "dega" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            source,
                            ...battlefield.map((name, i) =>
                                makeInstance(card(name), { id: `p${i}` })
                            ),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            const ability = resolveCompiledTrigger(
                dega.compiledTriggeredAbilities![0]!
            );
            // The raw game state, as `state.ts` hands it to the gate: its
            // instances carry no `colors` field.
            return ability.interveningIf!(
                {
                    type: "PHASE_BEGIN",
                    phase: "UPKEEP",
                    playerId: "p1",
                } as never,
                source as unknown as PermanentView,
                state as unknown as TriggerStateView
            );
        });
    }

    it("opens on a black permanent and stays shut on a green one", () => {
        expect(gateOn(["Black Knight"])).toBe(true);
        expect(gateOn(["Birds of Paradise"])).toBe(false);
    });
});

describe("the upgrade decides at resolution, per colour (CR 608.2c)", () => {
    // Dega Sanctuary's two sentences as a sorcery: the same sentence walk and
    // the same nested `if`, resolved on the real stack.
    const spell = {
        ...compiled(
            oracleCard({
                oracleId: "00000000-0000-0000-0000-000000004126",
                name: "Compiled Upgrade",
                manaCost: "{2}{W}",
                typeLine: "Sorcery",
                oracleText:
                    "You gain 2 life. If you control a black permanent and a red permanent, you gain 4 life instead.",
                power: undefined,
                toughness: undefined,
            })
        ),
        id: "compiled-upgrade-4126",
        rarity: "common" as const,
    };

    function lifeGainedWith(battlefield: string[]): number {
        return withTemporaryDefinition(spell, () => {
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        life: 20,
                        battlefield: battlefield.map((name, i) =>
                            makeInstance(card(name), { id: `p${i}` })
                        ),
                    }),
                    makePlayer("p2"),
                ],
            });
            pushSpell(state, spell.id, "p1");
            resolveTopOfStack(state);
            return state.players[0]!.life - 20;
        });
    }

    it("gains 4 with a black and a red permanent", () => {
        expect(lifeGainedWith(["Black Knight", "Dwarven Warriors"])).toBe(4);
    });

    it("gains 2 with only one of the two colours", () => {
        expect(lifeGainedWith(["Black Knight"])).toBe(2);
        expect(lifeGainedWith(["Dwarven Warriors"])).toBe(2);
    });

    it("gains 4 with ONE black-red permanent — it is each of the two", () => {
        expect(lifeGainedWith(["Barktooth Warbeard"])).toBe(4);
    });
});

describe("the conditional self buff in the layer system (CR 611.3a, CR 613.4c)", () => {
    const tactician = { ...compiled(MINOTAUR), id: "compiled-minotaur-4126" };

    function stateWith(others: string[]) {
        const self = makeInstance(tactician.id, { id: "tactician" });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [
                        self,
                        ...others.map((name, i) =>
                            makeInstance(card(name), { id: `c${i}` })
                        ),
                    ],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, self };
    }

    it("buffs once per colour controlled, and not at all with neither", () => {
        withTemporaryDefinition(tactician, () => {
            const none = stateWith(["Grizzly Bears"]);
            expect(getEffectivePower(none.state, none.self)).toBe(1);
            const white = stateWith(["Savannah Lions"]);
            expect(getEffectivePower(white.state, white.self)).toBe(2);
            const both = stateWith([
                "Savannah Lions",
                "Merfolk of the Pearl Trident",
            ]);
            expect(getEffectivePower(both.state, both.self)).toBe(3);
            expect(getEffectiveToughness(both.state, both.self)).toBe(3);
        });
    });

    it("wire format: the buff survives projectPublicState", () => {
        withTemporaryDefinition(tactician, () => {
            const { state } = stateWith(["Savannah Lions"]);
            const projected = projectPublicState(state, 1, "p1");
            const slim = projected.players[0]!.battlefield.find(
                (c) => c.id === "tactician"
            )!;
            expect(getEffectivePower(projected, slim)).toBe(2);
        });
    });
});

describe("the hand-written conditional buffs apply in layer 7c, not 7a (CR 613.4)", () => {
    // A layer-7b base-P/T set on every creature: under it a 7c modifier still
    // applies, a 7a CDA is overwritten.
    const setter: CardDefinition = {
        id: "pt-set-probe-4126",
        rarity: "common",
        name: "P/T Set Probe",
        types: ["Enchantment"],
        staticEffects: [
            {
                kind: "pt-set",
                applies: (target) => target.types.includes("Creature"),
                power: 0,
                toughness: 1,
            },
        ],
    };

    it.each([
        ["Kird Ape", "Forest", 1, 3],
        ["Sedge Troll", "Swamp", 1, 2],
        ["Mire Kavu", "Swamp", 1, 2],
    ])("%s keeps its bonus under a 7b set", (name, land, power, toughness) => {
        withTemporaryDefinition(setter, () => {
            const creature = makeInstance(card(name), { id: "creature" });
            const state = makeState({
                players: [
                    makePlayer("p1", {
                        battlefield: [
                            creature,
                            makeInstance(card(land), { id: "land" }),
                            makeInstance(setter.id, { id: "setter" }),
                        ],
                    }),
                    makePlayer("p2"),
                ],
            });
            expect(getEffectivePower(state, creature)).toBe(power);
            expect(getEffectiveToughness(state, creature)).toBe(toughness);
        });
    });
});
