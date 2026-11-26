// "Enchanted creature" across an Aura's own abilities (CR 303.4b) — the
// Grammar Cluster of issue #4583: the host as the object of tap / untap,
// counters, regenerate, exile, the hand return and damage; the host-scoped
// untap lock (CR 502.3); and the two host-scoped trigger heads, "becomes
// tapped" (CR 701.26a) and "becomes the target of a spell or ability"
// (CR 603.2).
//
// Three layers:
//
//  1. GOLDEN — each form's real corpus row compiled whole, equal to its
//     GOLDEN_FIXTURES row, which is what clears the smoke skip `$host` raises.
//  2. REFUSALS — the neighbours the rules must NOT read: a site a verb was
//     never shown the host at, an Aura that removes itself as a cost, a
//     trigger on the Aura's own departure, a non-creature untap lock, a
//     non-Aura source, "exile that creature" behind the target head.
//  3. BEHAVIOUR — the compiled abilities run through the real interpreter on
//     a real attachment (an Aura of p1's on p2's creature): the host is acted
//     on, a bystander is not, and the host-scoped heads fire for the host only.

import { describe, expect, it } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../cards";
import { resolveCompiledTrigger } from "../../cards/compiledTriggers";
import type { CardDefinition, GameEvent } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import { projectPublicState } from "../../gameProjections";
import { getEffectiveToughness } from "../../gre/layers";
import { resolveTopOfStack } from "../../gre/state";
import type { CardInstanceState, GameState, StackItem } from "../../gre/state";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompiledDefinition, OracleCard } from "../types";
import { oracleCard } from "./oracle.fixture";

/** An Aura's row, with only the fields the rows here differ in. */
function aura(name: string, oracleText: string): OracleCard {
    return oracleCard({
        name,
        manaCost: "{1}{U}",
        typeLine: "Enchantment — Aura",
        oracleText: `Enchant creature\n${oracleText}`,
        power: undefined,
        toughness: undefined,
    });
}

function fixture(name: string) {
    const found = GOLDEN_FIXTURES.find((f) => f.card.name === name);
    if (found === undefined) throw new Error(`no golden fixture for ${name}`);
    return found;
}

function compiled(card: OracleCard): CompiledDefinition {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome.definition;
}

/** The refusal's gap reasons and fragments, joined — what a test greps. */
function refusal(card: OracleCard): string {
    const outcome = compileCard(card);
    expect(outcome.state).toBe("unparsed");
    if (outcome.state !== "unparsed") return "";
    return JSON.stringify(outcome.gaps);
}

describe("enchanted creature — golden fixtures (CR 303.4b)", () => {
    it.each([
        ["Waterknot", "effect clause"],
        ["Freed from the Real", "effect clause"],
        ["Keldon Mantle", "effect clause"],
        ["Cooped Up", "effect clause"],
        ["Sun Clasp", "verb frame"],
        ["Fatal Attraction", "effect clause"],
        ["Insolence", "trigger head"],
        ["Spirit Shackle", "trigger head"],
        ["Spinal Graft", "trigger head"],
    ])(
        "%s: the whole definition equals its GOLDEN_FIXTURES row, ready",
        (name, rule) => {
            const row = fixture(name);
            expect(row.rule).toBe(rule);
            const outcome = compileCard(row.card);
            expect(outcome.state).toBe("ready");
            if (outcome.state === "unparsed") return;
            expect(sortKeys(outcome.definition)).toEqual(
                sortKeys(row.expected)
            );
        }
    );

    it("each form lowers onto `$host`, never an announced target", () => {
        const scripts = [
            fixture("Waterknot").expected.compiledTriggeredAbilities?.[0]
                ?.effects,
            fixture("Freed from the Real").expected.activatedAbilities?.[1]
                ?.effects,
            fixture("Keldon Mantle").expected.activatedAbilities?.[0]?.effects,
            fixture("Cooped Up").expected.activatedAbilities?.[0]?.effects,
            fixture("Sun Clasp").expected.activatedAbilities?.[0]?.effects,
        ];
        expect(scripts).toEqual([
            [{ op: "tapUntap", action: "tap", target: { ref: "$host" } }],
            [{ op: "tapUntap", action: "untap", target: { ref: "$host" } }],
            [{ op: "regenerate", target: { ref: "$host" } }],
            [{ op: "exile", target: { ref: "$host" } }],
            [{ op: "moveZone", target: { ref: "$host" }, to: "hand" }],
        ]);
        expect(fixture("Waterknot").expected.compiledStaticEffects).toEqual([
            {
                kind: "keyword-grant",
                appliesTo: "host",
                keyword: "does-not-untap",
            },
        ]);
    });
});

describe("the host's untap lock — goldens (CR 502.3)", () => {
    const LOCK = {
        kind: "keyword-grant",
        appliesTo: "host",
        keyword: "does-not-untap",
    };

    it("the bare lock: Paralyzing Grasp", () => {
        const definition = compiled(
            oracleCard({
                name: "Paralyzing Grasp",
                manaCost: "{2}{U}",
                typeLine: "Enchantment — Aura",
                oracleText:
                    "Enchant creature\nEnchanted creature doesn't untap during its controller's untap step.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.compiledStaticEffects).toEqual([LOCK]);
        expect(definition.staticAbilities ?? []).not.toContain(
            "does-not-untap"
        );
    });

    it("behind a host pump: Leaden Fists", () => {
        const definition = compiled(
            oracleCard({
                name: "Leaden Fists",
                manaCost: "{2}{U}",
                typeLine: "Enchantment — Aura",
                oracleText:
                    "Flash (You may cast this spell any time you could cast an instant.)\nEnchant creature\nEnchanted creature gets +3/+3 and doesn't untap during its controller's untap step.",
                power: undefined,
                toughness: undefined,
            })
        );
        expect(definition.compiledStaticEffects).toEqual([
            { kind: "pt-buff", appliesTo: "host", power: 3, toughness: 3 },
            LOCK,
        ]);
    });
});

describe("enchanted creature — refused neighbours (fail-closed, ADR 0105 § 2)", () => {
    it("a verb shown the host at the activated site only: a triggered regenerate", () => {
        expect(
            refusal(
                aura(
                    "Test Ward",
                    "At the beginning of your upkeep, regenerate enchanted creature."
                )
            )
        ).toContain("regenerate enchanted creature");
    });

    it("a verb shown the host at the triggered site only: activated damage", () => {
        expect(
            refusal(
                aura(
                    "Test Brand",
                    "{1}: This Aura deals 1 damage to enchanted creature."
                )
            )
        ).toContain("deals 1 damage to enchanted creature");
    });

    it("a verb never shown the host: 'Destroy enchanted creature' on a trigger", () => {
        expect(
            refusal(
                aura(
                    "Test Doom",
                    "At the beginning of your upkeep, destroy enchanted creature."
                )
            )
        ).toContain("destroy enchanted creature");
    });

    it("an Aura that sacrifices itself to regenerate its host: Carapace (CR 608.2h)", () => {
        expect(
            refusal(
                aura(
                    "Carapace",
                    "Enchanted creature gets +0/+2.\nSacrifice this Aura: Regenerate enchanted creature."
                )
            )
        ).toContain("an Aura removed by its own cost");
    });

    it("an Aura that sacrifices itself to return its host: Phantom Wings (CR 608.2h)", () => {
        expect(
            refusal(
                aura(
                    "Phantom Wings",
                    "Enchanted creature has flying.\nSacrifice this Aura: Return enchanted creature to its owner's hand."
                )
            )
        ).toContain("an Aura removed by its own cost");
    });

    it("a trigger on the Aura's own departure cannot read its host (CR 603.10a)", () => {
        expect(
            refusal(
                aura(
                    "Test Snare",
                    "When this Aura leaves the battlefield, tap enchanted creature."
                )
            )
        ).toContain("leaves-the-battlefield trigger cannot read");
    });

    it("a trigger on the HOST's departure cannot read the host either (CR 603.10a)", () => {
        expect(
            refusal(
                aura(
                    "Test Wake",
                    "When enchanted creature dies, put a +1/+1 counter on enchanted creature."
                )
            )
        ).toContain("leaves-the-battlefield trigger cannot read");
    });

    it("the untap lock on a non-creature host keeps its own gap", () => {
        expect(
            refusal(
                oracleCard({
                    name: "Test Rust",
                    manaCost: "{1}{U}",
                    typeLine: "Enchantment — Aura",
                    oracleText:
                        "Enchant artifact\nEnchanted artifact doesn't untap during its controller's untap step.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toContain("Enchanted artifact doesn't untap");
    });

    it("a source that is not an Aura names no host", () => {
        expect(
            refusal(
                oracleCard({
                    name: "Test Rod",
                    typeLine: "Artifact",
                    manaCost: "{2}",
                    oracleText: "{1}: Tap enchanted creature.",
                    power: undefined,
                    toughness: undefined,
                })
            )
        ).toContain("Tap enchanted creature");
    });

    it("exiling 'that creature' behind the target head: Crystallization keeps its gap", () => {
        expect(
            refusal(
                aura(
                    "Crystallization",
                    "When enchanted creature becomes the target of a spell or ability, exile that creature."
                )
            )
        ).toContain("a permanent on the battlefield is not put into exile");
    });
});

const AURA_ID = (name: string) => `test-aura-host-verbs-${name}`;

/** A compiled Aura of p1's, registered, attached (or not) to p2's `bear1`;
 *  `bear2` is p2's bystander. */
function hostBoard(definition: CompiledDefinition, attached = true): GameState {
    registerTokenDefinition({
        id: AURA_ID(definition.name),
        rarity: "common",
        ...definition,
    } as unknown as CardDefinition);
    const bears = getCardByName("Grizzly Bears").id;
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(AURA_ID(definition.name), {
                        id: "aura1",
                        controllerId: "p1",
                        ownerId: "p1",
                        ...(attached ? { attachedTo: "bear1" } : {}),
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(bears, {
                        id: "bear1",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: true,
                    }),
                    makeInstance(bears, {
                        id: "bear2",
                        controllerId: "p2",
                        ownerId: "p2",
                        isTapped: true,
                    }),
                ],
            }),
        ],
    });
}

const theAura = (state: GameState) =>
    state.players[0].battlefield.find((c) => c.id === "aura1")!;
const creature = (state: GameState, id: string) =>
    state.players[1].battlefield.find((c) => c.id === id);

function activate(state: GameState, abilityId: string): void {
    state.stack.push({
        ...theAura(state),
        zone: "stack",
        castById: "p1",
        abilityId,
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

function resolveTrigger(
    state: GameState,
    definition: CompiledDefinition,
    event: GameEvent
): void {
    state.stack.push({
        ...theAura(state),
        id: "aura-trigger",
        zone: "stack",
        castById: "p1",
        triggeredAbilityId: definition.compiledTriggeredAbilities?.[0]?.id,
        triggerSourceId: "aura1",
        triggerEvent: event,
        targets: undefined,
    } as StackItem);
    resolveTopOfStack(state);
}

const tapped = (permanentId: string): GameEvent => ({
    type: "PERMANENT_TAPPED",
    permanentId,
    controllerId: "p2",
    permanentTypes: ["Creature"],
    permanentSubtypes: ["Bear"],
    forMana: false,
});

const targeted = (id: string): GameEvent => ({
    type: "BECAME_TARGET",
    target: { type: "permanent", id },
    sourceKind: "spell",
    targetControllerId: "p2",
    sourceControllerId: "p1",
    sourceInstanceId: "spell1",
});

/** Whether the definition's first compiled trigger fires for `event`, read
 *  through the same factory the engine registers. */
function fires(
    definition: CompiledDefinition,
    event: GameEvent,
    self: CardInstanceState
): boolean {
    const ability = resolveCompiledTrigger(
        definition.compiledTriggeredAbilities![0]!
    );
    return ability.matches!(event, self as never, undefined);
}

describe("enchanted creature — behaviour through the interpreter (CR 303.4b)", () => {
    it("the enters trigger taps the host, not the bystander (Waterknot)", () => {
        const definition = fixture("Waterknot").expected;
        const state = hostBoard(definition);
        creature(state, "bear1")!.isTapped = false;
        creature(state, "bear2")!.isTapped = false;
        resolveTrigger(state, definition, {
            type: "PERMANENT_ENTERED",
            instanceId: "aura1",
            controllerId: "p1",
        } as GameEvent);
        expect(creature(state, "bear1")!.isTapped).toBe(true);
        expect(creature(state, "bear2")!.isTapped).toBe(false);
        const slim = projectPublicState(
            state,
            1,
            "p1"
        ).players[1].battlefield.find((c) => c.id === "bear1")!;
        expect(slim.isTapped).toBe(true);
    });

    it("the activated untap untaps the host only (Freed from the Real)", () => {
        const definition = fixture("Freed from the Real").expected;
        const state = hostBoard(definition);
        // Its second ability: "{U}: Untap enchanted creature."
        activate(state, definition.activatedAbilities![1]!.id);
        expect(creature(state, "bear1")!.isTapped).toBe(false);
        expect(creature(state, "bear2")!.isTapped).toBe(true);
    });

    it("regenerate shields the host only (Keldon Mantle, CR 701.19a)", () => {
        const definition = fixture("Keldon Mantle").expected;
        const state = hostBoard(definition);
        activate(state, definition.activatedAbilities![0]!.id);
        expect(creature(state, "bear1")!.regenerationShields).toBe(1);
        expect(creature(state, "bear2")!.regenerationShields).toBeUndefined();
    });

    it("exile moves the host to exile, the bystander stays (Cooped Up, CR 701.13a)", () => {
        const definition = fixture("Cooped Up").expected;
        const state = hostBoard(definition);
        activate(state, definition.activatedAbilities![0]!.id);
        expect(creature(state, "bear1")).toBeUndefined();
        expect(state.players[1].exile.map((c) => c.id)).toContain("bear1");
        expect(creature(state, "bear2")).toBeDefined();
    });

    it("the hand return puts the host into its OWNER's hand (Sun Clasp, CR 400.7)", () => {
        const definition = fixture("Sun Clasp").expected;
        const state = hostBoard(definition);
        activate(state, definition.activatedAbilities![0]!.id);
        expect(creature(state, "bear1")).toBeUndefined();
        expect(state.players[1].hand.map((c) => c.id)).toContain("bear1");
        expect(state.players[0].hand.map((c) => c.id)).not.toContain("bear1");
    });

    // Its first trigger: "When this Aura enters, it deals 2 damage to
    // enchanted creature."
    it("the damage trigger damages the host only (Fatal Attraction, CR 120.3)", () => {
        const definition = fixture("Fatal Attraction").expected;
        const state = hostBoard(definition);
        resolveTrigger(state, definition, {
            type: "PERMANENT_ENTERED",
            instanceId: "aura1",
            controllerId: "p1",
        } as GameEvent);
        const host = creature(state, "bear1");
        expect(host!.damageMarked).toBe(2);
        expect(creature(state, "bear2")!.damageMarked).toBeUndefined();
    });

    it("the unattached Aura's host Op finds nothing", () => {
        const definition = fixture("Keldon Mantle").expected;
        const state = hostBoard(definition, false);
        expect(() =>
            activate(state, definition.activatedAbilities![0]!.id)
        ).not.toThrow();
        expect(creature(state, "bear1")!.regenerationShields).toBeUndefined();
    });
});

describe("Aura host trigger heads — becomes tapped (CR 701.26a), becomes a target (CR 603.2)", () => {
    it("'becomes tapped' fires for the host, not the bystander nor the Aura (Insolence)", () => {
        const definition = fixture("Insolence").expected;
        const state = hostBoard(definition);
        const self = theAura(state);
        expect(fires(definition, tapped("bear1"), self)).toBe(true);
        expect(fires(definition, tapped("bear2"), self)).toBe(false);
        expect(fires(definition, tapped("aura1"), self)).toBe(false);
    });

    it("its damage goes to the HOST's controller, not the Aura's (Insolence, CR 608.2h)", () => {
        const definition = fixture("Insolence").expected;
        const state = hostBoard(definition);
        const before = state.players.map((p) => p.life);
        resolveTrigger(state, definition, tapped("bear1"));
        expect(state.players[1].life).toBe(before[1]! - 2);
        expect(state.players[0].life).toBe(before[0]);
    });

    it("its 'it' is the host (Spirit Shackle)", () => {
        const definition = fixture("Spirit Shackle").expected;
        const state = hostBoard(definition);
        resolveTrigger(state, definition, tapped("bear1"));
        expect(getEffectiveToughness(state, creature(state, "bear1")!)).toBe(0);
        expect(getEffectiveToughness(state, creature(state, "bear2")!)).toBe(2);
    });

    it("'becomes the target' fires for the host only (Spinal Graft)", () => {
        const definition = fixture("Spinal Graft").expected;
        const state = hostBoard(definition);
        const self = theAura(state);
        expect(fires(definition, targeted("bear1"), self)).toBe(true);
        expect(fires(definition, targeted("bear2"), self)).toBe(false);
        expect(fires(definition, targeted("aura1"), self)).toBe(false);
        const loose = { ...self, attachedTo: undefined };
        expect(fires(definition, targeted("bear1"), loose)).toBe(false);
    });

    it("its 'destroy that creature' destroys the host (Spinal Graft)", () => {
        const definition = fixture("Spinal Graft").expected;
        const state = hostBoard(definition);
        resolveTrigger(state, definition, targeted("bear1"));
        expect(creature(state, "bear1")).toBeUndefined();
        expect(creature(state, "bear2")).toBeDefined();
    });
});
