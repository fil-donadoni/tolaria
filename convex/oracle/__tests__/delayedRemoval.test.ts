// Delayed removal of an object this effect put onto the battlefield, and the
// Mirage flash permission's off-timing cleanup sacrifice (CR 603.7a, issue
// #5256).
//
// Four layers, each watching a different way the rules can go wrong:
//
//  1. GOLDEN fixtures — a real Oracle card compiled whole must produce exactly
//     this Compiled Definition: "Sacrifice it …" after a token (Tidal Wave),
//     "Exile it …" after a token on an activated ability (Rakdos Guildmage),
//     "That creature … Exile it …" after a reanimation (Shallow Grave), and
//     the Mirage static (Spider Climb).
//  2. REFUSALS — the neighbours stay unparsed: "them" over several tokens
//     (Waylay), "it" naming an announced target (Krovikan Elementalist), and
//     "that creature" after an optional targeted return (Dawn of the Dead).
//  3. SEAM — the compiled `cast-off-sorcery-timing` condition rides the
//     entered trigger's self-decided gate.
//  4. BEHAVIOUR — the compiled definitions, registered as-is, run through the
//     real stack and phase machinery: the token is sacrificed at the next end
//     step, and the Mirage permanent at the next cleanup step only when it was
//     cast off sorcery timing.

import { describe, expect, it } from "vitest";
import { withTemporaryDefinition } from "../../cards/registry";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type {
    CardDefinition,
    PermanentView,
    StackItem,
} from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../gre/state";
import { advancePhase } from "../../gre/phases";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

const TIDAL_WAVE = oracleCard({
    oracleId: "c5f5b7e5-af1e-4c8a-8d44-3e2152955d4e",
    name: "Tidal Wave",
    manaCost: "{2}{U}",
    typeLine: "Instant",
    oracleText:
        "Create a 5/5 blue Wall creature token with defender. Sacrifice it at the beginning of the next end step.",
    power: undefined,
    toughness: undefined,
});

const RAKDOS_GUILDMAGE = oracleCard({
    oracleId: "650949ca-609b-46c5-bc6b-6f782cdcb6d2",
    name: "Rakdos Guildmage",
    manaCost: "{B/R}{B/R}",
    typeLine: "Creature — Zombie Shaman",
    oracleText:
        "({B/R} can be paid with either {B} or {R}.)\n{3}{B}, Discard a card: Target creature gets -2/-2 until end of turn.\n{3}{R}: Create a 2/1 red Goblin creature token with haste. Exile it at the beginning of the next end step.",
    power: "2",
    toughness: "2",
});

const SHALLOW_GRAVE = oracleCard({
    oracleId: "9843d8a6-bcbf-40c2-8c41-316e97db9c62",
    name: "Shallow Grave",
    manaCost: "{1}{B}",
    typeLine: "Instant",
    oracleText:
        "Return the top creature card of your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.",
    power: undefined,
    toughness: undefined,
});

const SPIDER_CLIMB = oracleCard({
    oracleId: "2636aafa-83f9-4b72-b729-04e1c3aa0eec",
    name: "Spider Climb",
    manaCost: "{G}",
    typeLine: "Enchantment — Aura",
    oracleText:
        "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nEnchant creature\nEnchanted creature gets +0/+3 and has reach. (It can block creatures with flying.)",
    power: undefined,
    toughness: undefined,
});

const PARAPET = oracleCard({
    oracleId: "4e73634a-9df8-4c36-b1d2-f366eae902fc",
    name: "Parapet",
    manaCost: "{1}{W}",
    typeLine: "Enchantment",
    oracleText:
        "You may cast this spell as though it had flash. If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.\nCreatures you control get +0/+1.",
    power: undefined,
    toughness: undefined,
});

/** The Mirage static's trigger, the same on every card that prints it. */
const CLEANUP_SACRIFICE = (id: string) => ({
    id,
    oracleText:
        "If you cast it any time a sorcery couldn't have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step.",
    head: { kind: "entered", scope: "self" },
    condition: { kind: "cast-off-sorcery-timing" },
    effects: [
        {
            op: "delayedTrigger",
            timing: "next-cleanup-step",
            oracleText:
                "At the beginning of the next cleanup step, the controller of this permanent sacrifices it.",
            capture: { $becomes: { ref: "$source" } },
            effects: [{ op: "sacrifice", target: { ref: "$becomes" } }],
        },
    ],
});

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} did not compile: ${outcome.gaps
                .map((g) => g.reason)
                .join("; ")}`
        );
    return outcome.definition;
}

function expectGolden(card: OracleCard, expected: object): void {
    expect(sortKeys(compiled(card))).toEqual(sortKeys(expected));
}

describe("delayed removal — golden fixtures (CR 603.7a)", () => {
    it('Tidal Wave: "Sacrifice it …" sacrifices the token just created (CR 111.1)', () => {
        expectGolden(TIDAL_WAVE, {
            name: "Tidal Wave",
            types: ["Instant"],
            manaCost: { X: 2, U: 1 },
            oracleText: TIDAL_WAVE.oracleText,
            effects: [
                {
                    op: "createToken",
                    token: {
                        name: "Wall",
                        types: ["Creature"],
                        subtypes: ["Wall"],
                        power: 5,
                        toughness: 5,
                        colors: ["U"],
                        staticAbilities: ["defender"],
                    },
                    controller: "controller",
                    bind: "$that1",
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Sacrifice it at the beginning of the next end step.",
                    capture: { $captured: { ref: "$that1" } },
                    effects: [
                        { op: "sacrifice", target: { ref: "$captured" } },
                    ],
                },
            ],
        });
    });

    it('Rakdos Guildmage: "Exile it …" on an activated ability exiles its token', () => {
        expectGolden(RAKDOS_GUILDMAGE, {
            name: "Rakdos Guildmage",
            types: ["Creature"],
            subtypes: ["Zombie", "Shaman"],
            manaCost: {
                hybrid: [
                    ["B", "R"],
                    ["B", "R"],
                ],
            },
            power: 2,
            toughness: 2,
            oracleText: RAKDOS_GUILDMAGE.oracleText,
            activatedAbilities: [
                {
                    id: "rakdos-guildmage-ability",
                    oracleText:
                        "{3}{B}, Discard a card: Target creature gets -2/-2 until end of turn.",
                    cost: {
                        mana: { X: 3, B: 1 },
                        discardFilter: { filter: {}, count: 1 },
                    },
                    useStack: true,
                    effects: [
                        {
                            op: "pump",
                            target: { target: 0 },
                            power: -2,
                            toughness: -2,
                            duration: { phase: "end-of-turn" },
                        },
                    ],
                    targetRequirement: { type: "Creature", count: 1 },
                },
                {
                    id: "rakdos-guildmage-ability-2",
                    oracleText:
                        "{3}{R}: Create a 2/1 red Goblin creature token with haste. Exile it at the beginning of the next end step.",
                    cost: { mana: { X: 3, R: 1 } },
                    useStack: true,
                    effects: [
                        {
                            op: "createToken",
                            token: {
                                name: "Goblin",
                                types: ["Creature"],
                                subtypes: ["Goblin"],
                                power: 2,
                                toughness: 1,
                                colors: ["R"],
                                staticAbilities: ["haste"],
                            },
                            controller: "controller",
                            bind: "$that1",
                        },
                        {
                            op: "delayedTrigger",
                            timing: "next-end-step",
                            oracleText:
                                "Exile it at the beginning of the next end step.",
                            capture: { $captured: { ref: "$that1" } },
                            effects: [
                                { op: "exile", target: { ref: "$captured" } },
                            ],
                        },
                    ],
                },
            ],
        });
    });

    it('Shallow Grave: "That creature" and "it" name the returned creature (CR 400.7j)', () => {
        expectGolden(SHALLOW_GRAVE, {
            name: "Shallow Grave",
            types: ["Instant"],
            manaCost: { X: 1, B: 1 },
            oracleText: SHALLOW_GRAVE.oracleText,
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
                    bind: "$that1",
                },
                {
                    op: "grantAbility",
                    target: { ref: "$that1" },
                    ability: "haste",
                    duration: { phase: "end-of-turn" },
                },
                {
                    op: "delayedTrigger",
                    timing: "next-end-step",
                    oracleText:
                        "Exile it at the beginning of the next end step.",
                    capture: { $captured: { ref: "$that1" } },
                    effects: [{ op: "exile", target: { ref: "$captured" } }],
                },
            ],
        });
    });

    it("Spider Climb: the flash permission and its cleanup sacrifice (CR 702.8a, CR 514.3a)", () => {
        expectGolden(SPIDER_CLIMB, {
            name: "Spider Climb",
            types: ["Enchantment"],
            subtypes: ["Aura"],
            manaCost: { G: 1 },
            oracleText: SPIDER_CLIMB.oracleText,
            castAsThoughFlash: true,
            targetRequirement: { type: "Creature", count: 1 },
            compiledTriggeredAbilities: [
                CLEANUP_SACRIFICE("spider-climb-cleanup-sacrifice"),
            ],
            compiledStaticEffects: [
                { kind: "pt-buff", appliesTo: "host", power: 0, toughness: 3 },
                { kind: "keyword-grant", appliesTo: "host", keyword: "reach" },
            ],
        });
    });
});

describe("delayed removal — refusals (fail-closed)", () => {
    it('Waylay: "Exile them …" over three tokens names no ONE object', () => {
        expect(
            compileCard(
                oracleCard({
                    oracleId: "f0db78c7-09b5-4981-8ca8-6dbab597c5d9",
                    name: "Waylay",
                    manaCost: "{2}{W}",
                    typeLine: "Instant",
                    oracleText:
                        "Create three 2/2 white Knight creature tokens. Exile them at the beginning of the next cleanup step.",
                    power: undefined,
                    toughness: undefined,
                })
            ).state
        ).toBe("unparsed");
    });

    it('Krovikan Elementalist: "Sacrifice it …" after an announced target is refused', () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "43e6fc44-8b23-4bff-91da-936019efe84b",
                name: "Krovikan Elementalist",
                manaCost: "{B}{B}",
                typeLine: "Creature — Human Wizard",
                oracleText:
                    "{2}{R}: Target creature gets +1/+0 until end of turn.\n{U}{U}: Target creature you control gains flying until end of turn. Sacrifice it at the beginning of the next end step.",
                power: "1",
                toughness: "1",
            })
        );
        expect(outcome.state).toBe("unparsed");
        if (outcome.state === "unparsed")
            expect(outcome.gaps[0]!.reason).toContain(
                "names no object an earlier sentence put onto the battlefield"
            );
    });

    it('Dawn of the Dead: "That creature" after an optional targeted return is refused', () => {
        const outcome = compileCard(
            oracleCard({
                oracleId: "309e61f5-1fc7-4481-8d3a-9b35d335c99f",
                name: "Dawn of the Dead",
                manaCost: "{2}{B}{B}{B}",
                typeLine: "Enchantment",
                oracleText:
                    "At the beginning of your upkeep, you lose 1 life.\nAt the beginning of your upkeep, you may return target creature card from your graveyard to the battlefield. That creature gains haste until end of turn. Exile it at the beginning of the next end step.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(outcome.state).toBe("unparsed");
    });
});

// Constructed neighbours (no corpus card prints them): each puts a SECOND
// candidate antecedent between the object and "it" / "that creature", and the
// referent must be refused rather than bound to the older object (CR 608.2h).
describe("delayed removal — refusals of an ambiguous referent (CR 608.2h)", () => {
    const sorcery = (oracleText: string) =>
        compileCard(
            oracleCard({
                typeLine: "Sorcery",
                oracleText,
                power: undefined,
                toughness: undefined,
            })
        ).state;

    it('a later multi-token creation makes "it" stale', () => {
        expect(
            sorcery(
                "Create a 1/1 white Soldier creature token. Create two 2/2 green Wolf creature tokens. Sacrifice it at the beginning of the next end step."
            )
        ).toBe("unparsed");
    });

    it("control: the same creation without the intervening sentence compiles", () => {
        expect(
            sorcery(
                "Create a 1/1 white Soldier creature token. Sacrifice it at the beginning of the next end step."
            )
        ).not.toBe("unparsed");
    });

    it('"that creature" on a head that names a creature of its own is refused', () => {
        expect(
            compileCard(
                oracleCard({
                    typeLine: "Enchantment",
                    oracleText:
                        "Whenever a creature you control attacks, create a 1/1 white Soldier creature token. That creature gets +1/+1 until end of turn.",
                    power: undefined,
                    toughness: undefined,
                })
            ).state
        ).toBe("unparsed");
    });
});

describe("cast-off-sorcery-timing — the compiled condition's gate (CR 400.7d)", () => {
    const ability = resolveCompiledTrigger(
        CLEANUP_SACRIFICE("parapet-cleanup-sacrifice") as never
    );

    it("is a self-decided gate the Bot's value model can evaluate", () => {
        const gate = ability.gate as {
            onSelf: (self: PermanentView) => boolean;
        };
        expect(
            gate.onSelf({ castOffSorceryTiming: true } as PermanentView)
        ).toBe(true);
        expect(gate.onSelf({} as PermanentView)).toBe(false);
    });
});

describe("delayed removal — behaviour through the real stack and phases", () => {
    function asDefinition(card: OracleCard, id: string): CardDefinition {
        return { ...compiled(card), id, rarity: "common" } as CardDefinition;
    }

    function onStack(
        def: CardDefinition,
        id: string,
        extra: Partial<StackItem> = {}
    ): GameState {
        const state = makeState({
            players: [makePlayer("p1"), makePlayer("p2")],
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            phase: "PRECOMBAT_MAIN",
        });
        state.stack.push({
            ...makeInstance(def.id, {
                id,
                controllerId: "p1",
                ownerId: "p1",
                zone: "stack",
            }),
            castById: "p1",
            ...extra,
        } as StackItem);
        return state;
    }

    function drain(state: GameState): void {
        resolveTriggerOrder(state);
        let guard = 0;
        while (state.stack.length > 0 && guard++ < 8) {
            resolveTopOfStack(state);
            resolveTriggerOrder(state);
        }
        expect(state.stack).toHaveLength(0);
    }

    const battlefield = (state: GameState) =>
        state.players[0].battlefield.map((c) => c.name ?? c.cardId);

    it("Tidal Wave's Wall is sacrificed at the beginning of the next end step", () => {
        const def = asDefinition(TIDAL_WAVE, "test-tidal-wave");
        withTemporaryDefinition(def, () => {
            const state = onStack(def, "wave-1");
            drain(state);
            const walls = state.players[0].battlefield.filter((c) => c.isToken);
            expect(walls).toHaveLength(1);
            expect(state.delayedTriggers).toHaveLength(1);

            state.phase = "POSTCOMBAT_MAIN";
            advancePhase(state);
            expect(state.phase).toBe("END_STEP");
            drain(state);
            expect(
                state.players[0].battlefield.filter((c) => c.isToken)
            ).toHaveLength(0);
        });
    });

    function parapetCast(offSorceryTiming: boolean): GameState {
        const def = asDefinition(PARAPET, "test-parapet");
        return withTemporaryDefinition(def, () => {
            const state = onStack(
                def,
                "parapet-1",
                offSorceryTiming ? { castOffSorceryTiming: true } : {}
            );
            drain(state);
            expect(
                state.players[0].battlefield.some((c) => c.id === "parapet-1")
            ).toBe(true);
            state.phase = "END_STEP";
            advancePhase(state);
            drain(state);
            return state;
        });
    }

    it("Parapet cast off sorcery timing is sacrificed at the next cleanup step (CR 514.3a)", () => {
        const state = parapetCast(true);
        expect(
            state.players[0].battlefield.some((c) => c.id === "parapet-1")
        ).toBe(false);
        expect(state.players[0].graveyard.map((c) => c.id)).toContain(
            "parapet-1"
        );
    });

    it("Parapet cast at sorcery timing arms nothing and stays", () => {
        const state = parapetCast(false);
        expect(state.delayedTriggers ?? []).toHaveLength(0);
        expect(battlefield(state)).toHaveLength(1);
    });
});
