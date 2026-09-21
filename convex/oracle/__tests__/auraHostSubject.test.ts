// "Enchanted creature" as the subject of an Aura's own activated ability
// (CR 303.4b, issue #4303).
//
// Three layers:
//
//  1. GOLDEN — real Aura rows compiled whole. The pump on the host
//     (Firebreathing's `{R}: … gets +1/+0`, Flowstone Embrace's `{T}` cost and
//     negative toughness) and the keyword grant on the host (Ocular Halo's
//     vigilance). Each reaches `ready`: the two GOLDEN_FIXTURES rows are what
//     clears the smoke skip `$host` raises, so a `ready` here is the fixture
//     doing its job.
//  2. REFUSALS — every neighbour the rule must NOT read, each under its own
//     reason so it stays its own Grammar Gap: a modal pump, an Aura that
//     removes itself as a cost, a source that is not an Aura, a granted
//     ability, a verb the rule was never shown, and a triggered site.
//  3. BEHAVIOUR — the compiled ability resolved through the real interpreter
//     on a real attachment: the host is pumped, the bystander is not, an
//     unattached Aura does nothing (CR 608.2b), and the pump survives the wire
//     projection. Without it a golden only proves the definition was written.

import { describe, expect, it } from "vitest";
import { compileCard } from "../compile";
import { sortKeys } from "../gates";
import { GOLDEN_FIXTURES } from "../grammar/fixtures";
import type { CompiledDefinition } from "../types";
import { getCardByName, registerTokenDefinition } from "../../cards";
import type { CardDefinition } from "../../cards/types";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { projectPublicState } from "../../gameProjections";
import { getEffectivePower, getEffectiveToughness } from "../../gre/layers";
import { resolveTopOfStack } from "../../gre/state";
import type { GameState, StackItem } from "../../gre/state";
import { oracleCard } from "./fixtures";

/** A real Aura's row, with only the fields the rows here differ in. */
function aura(
    name: string,
    manaCost: string,
    oracleText: string,
    overrides: Partial<Parameters<typeof oracleCard>[0]> = {}
) {
    return oracleCard({
        name,
        manaCost,
        typeLine: "Enchantment — Aura",
        oracleText,
        power: undefined,
        toughness: undefined,
        ...overrides,
    });
}

const FIREBREATHING = aura(
    "Firebreathing",
    "{R}",
    "Enchant creature\n{R}: Enchanted creature gets +1/+0 until end of turn."
);
const OCULAR_HALO = aura(
    "Ocular Halo",
    "{3}{U}",
    'Enchant creature\nEnchanted creature has "{T}: Draw a card."\n{W}: Enchanted creature gains vigilance until end of turn.'
);
const FLOWSTONE_EMBRACE = aura(
    "Flowstone Embrace",
    "{1}{R}",
    "Enchant creature\n{T}: Enchanted creature gets +2/-2 until end of turn."
);

function compiled(card: ReturnType<typeof oracleCard>) {
    const outcome = compileCard(card);
    if (outcome.state === "unparsed")
        throw new Error(
            `${card.name} unparsed: ${JSON.stringify(outcome.gaps)}`
        );
    return outcome;
}

/** Why `card` was refused — every reason its gaps carry, joined. */
function refusal(card: ReturnType<typeof oracleCard>): string {
    const outcome = compileCard(card);
    if (outcome.state !== "unparsed")
        throw new Error(`${card.name} compiled (${outcome.state})`);
    return outcome.gaps.map((g) => `${g.reason} | ${g.fragment}`).join("\n");
}

describe("enchanted creature — golden fixtures (CR 303.4b)", () => {
    it("pump on the host: Firebreathing reaches ready through its fixture", () => {
        const outcome = compiled(FIREBREATHING);
        expect(outcome.state).toBe("ready");
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Firebreathing"
        )!;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
    });

    it("keyword grant on the host: Ocular Halo reaches ready through its fixture", () => {
        const outcome = compiled(OCULAR_HALO);
        expect(outcome.state).toBe("ready");
        const fixture = GOLDEN_FIXTURES.find(
            (f) => f.card.name === "Ocular Halo"
        )!;
        expect(sortKeys(outcome.definition)).toEqual(
            sortKeys(fixture.expected)
        );
    });

    it("a {T} cost and a negative toughness: Flowstone Embrace", () => {
        expect(sortKeys(compiled(FLOWSTONE_EMBRACE).definition)).toEqual(
            sortKeys({
                name: "Flowstone Embrace",
                types: ["Enchantment"],
                subtypes: ["Aura"],
                manaCost: { X: 1, R: 1 },
                oracleText:
                    "Enchant creature\n{T}: Enchanted creature gets +2/-2 until end of turn.",
                activatedAbilities: [
                    {
                        id: "flowstone-embrace-ability",
                        oracleText:
                            "{T}: Enchanted creature gets +2/-2 until end of turn.",
                        cost: { tap: true },
                        useStack: true,
                        effects: [
                            {
                                op: "pump",
                                target: { ref: "$host" },
                                power: 2,
                                toughness: -2,
                                duration: { phase: "end-of-turn" },
                            },
                        ],
                    },
                ],
                targetRequirement: { type: "Creature", count: 1 },
            })
        );
    });
});

describe("enchanted creature — refused neighbours (fail-closed)", () => {
    it("a modal pump: Pemmin's Aura's '+1/-1 or -1/+1'", () => {
        expect(
            refusal(
                aura(
                    "Pemmin's Aura",
                    "{1}{U}{U}",
                    "Enchant creature\n{1}: Enchanted creature gets +1/-1 or -1/+1 until end of turn."
                )
            )
        ).toContain("Enchanted creature gets +1/-1 or -1/+1");
    });

    it("an Aura that removes itself as a cost: Briar Shield (the host is read off the live attachment, CR 608.2h)", () => {
        expect(
            refusal(
                aura(
                    "Briar Shield",
                    "{G}",
                    "Enchant creature\nEnchanted creature gets +1/+1.\nSacrifice this Aura: Enchanted creature gets +3/+3 until end of turn."
                )
            )
        ).toContain("removed by its own cost");
    });

    it("a source that is not an Aura names no host", () => {
        expect(
            refusal(
                oracleCard({
                    name: "Test Creature",
                    typeLine: "Creature — Bear",
                    oracleText:
                        "{R}: Enchanted creature gets +1/+0 until end of turn.",
                })
            )
        ).toContain("{R}: Enchanted creature gets +1/+0 until end of turn.");
    });

    it("a granted ability's own 'enchanted creature' is not the Aura's host", () => {
        expect(
            refusal(
                aura(
                    "Test Aura",
                    "{1}{R}",
                    'Enchant creature\nEnchanted creature has "{R}: Enchanted creature gets +1/+0 until end of turn."'
                )
            )
        ).toContain("Enchanted creature");
    });

    it("a verb the rule was never shown at this site: 'can't block this turn' (Manacles of Decay)", () => {
        expect(
            refusal(
                aura(
                    "Manacles of Decay",
                    "{1}{W}",
                    "Enchant creature\n{R}: Enchanted creature can't block this turn."
                )
            )
        ).toContain("Enchanted creature can't block this turn");
    });

    it("a triggered site keeps its own gap: Mantle of Leadership", () => {
        expect(
            refusal(
                aura(
                    "Mantle of Leadership",
                    "{1}{W}",
                    "Enchant creature\nWhenever a creature enters, enchanted creature gets +2/+2 until end of turn."
                )
            )
        ).toContain("enchanted creature gets +2/+2 until end of turn");
    });
});

/** A compiled Aura registered as a permanent, attached to `bear1`. */
function hostBoard(
    definition: CompiledDefinition,
    attached: boolean
): { state: GameState; abilityId: string } {
    const id = `test-aura-host-${definition.name}`;
    registerTokenDefinition({
        id,
        rarity: "common",
        ...definition,
    } as unknown as CardDefinition);
    const auraInstance = makeInstance(id, {
        id: "aura1",
        controllerId: "p1",
        ownerId: "p1",
        ...(attached ? { attachedTo: "bear1" } : {}),
    });
    const bears = getCardByName("Grizzly Bears").id;
    const bear = makeInstance(bears, {
        id: "bear1",
        controllerId: "p2",
        ownerId: "p2",
    });
    const bystander = makeInstance(bears, {
        id: "bear2",
        controllerId: "p2",
        ownerId: "p2",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [auraInstance] }),
            makePlayer("p2", { battlefield: [bear, bystander] }),
        ],
    });
    return { state, abilityId: definition.activatedAbilities![0]!.id };
}

function activate(state: GameState, abilityId: string): void {
    const source = state.players[0].battlefield.find((c) => c.id === "aura1")!;
    state.stack.push({
        ...source,
        zone: "stack",
        castById: "p1",
        abilityId,
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

const permanent = (state: GameState, id: string) =>
    state.players[1].battlefield.find((c) => c.id === id)!;

describe("enchanted creature — behaviour through the interpreter (CR 303.4b, CR 608.2b)", () => {
    it("pumps the ENCHANTED creature, not its controller's other creatures, and survives the projection", () => {
        const { state, abilityId } = hostBoard(
            compiled(FIREBREATHING).definition,
            true
        );
        activate(state, abilityId);
        expect(getEffectivePower(state, permanent(state, "bear1"))).toBe(3);
        expect(getEffectiveToughness(state, permanent(state, "bear1"))).toBe(2);
        expect(getEffectivePower(state, permanent(state, "bear2"))).toBe(2);

        // The client renders the boosted stats off the slim state.
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[1].battlefield.find(
            (c) => c.id === "bear1"
        )!;
        expect(getEffectivePower(projected, slim)).toBe(3);
    });

    it("a negative toughness applies to the host as printed (Flowstone Embrace)", () => {
        const { state, abilityId } = hostBoard(
            compiled(FLOWSTONE_EMBRACE).definition,
            true
        );
        activate(state, abilityId);
        expect(getEffectivePower(state, permanent(state, "bear1"))).toBe(4);
        expect(getEffectiveToughness(state, permanent(state, "bear1"))).toBe(0);
    });

    it("grants the keyword to the host only, and it survives the projection (Ocular Halo)", () => {
        const { state, abilityId } = hostBoard(
            compiled(OCULAR_HALO).definition,
            true
        );
        activate(state, abilityId);
        expect(permanent(state, "bear1").staticAbilities).toContain(
            "vigilance"
        );
        expect(permanent(state, "bear2").staticAbilities ?? []).not.toContain(
            "vigilance"
        );
        const slim = projectPublicState(
            state,
            1,
            "p1"
        ).players[1].battlefield.find((c) => c.id === "bear1")!;
        expect(slim.staticAbilities).toContain("vigilance");
    });

    // CR 608.2b — the ability does as much as it can: an Aura with no host
    // resolves and its host Op finds nothing.
    it("does nothing while the Aura is unattached", () => {
        const { state, abilityId } = hostBoard(
            compiled(FIREBREATHING).definition,
            false
        );
        expect(() => activate(state, abilityId)).not.toThrow();
        expect(getEffectivePower(state, permanent(state, "bear1"))).toBe(2);
    });
});
