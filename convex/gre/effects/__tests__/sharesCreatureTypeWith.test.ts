// `EffectCardFilter.sharesCreatureTypeWith` (CR 205.3m, 608.2h, issue #6618) —
// "a creature that shares a creature type with that creature". The filter reads
// the LAST-KNOWN creature types of a referenced object, so a snapshot taken
// before the referent died still answers; every unresolvable edge fails CLOSED.
//
// Exercised through the real `resolveTopOfStack` (battlefield matcher via
// `toPermanentFilter`, hidden-zone matcher via `matchesCardFilter`), the
// validator's ref pass, and one `projectPublicState` read of the result.

import { describe, it, expect } from "vitest";
import type { EffectOp } from "../../../cards/types";
import { registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack } from "../../state";
import { projectPublicState } from "../../../gameProjections";
import { validateEffectScript, type EffectScriptHost } from "../validate";

function creature(id: string, subtypes: string[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { G: 1 },
        types: ["Creature"],
        subtypes,
        power: 2,
        toughness: 2,
    });
    return id;
}

const GOBLIN_WARRIOR = creature("test-sctw-goblin-warrior", [
    "Goblin",
    "Warrior",
]);
const GOBLIN_SHAMAN = creature("test-sctw-goblin-shaman", ["Goblin", "Shaman"]);
const ELF_WARRIOR = creature("test-sctw-elf-warrior", ["Elf", "Warrior"]);
const ELF_DRUID = creature("test-sctw-elf-druid", ["Elf", "Druid"]);

function registerScript(id: string, effects: EffectOp[]): string {
    registerTokenDefinition({
        id,
        name: id,
        rarity: "common",
        manaCost: { R: 1 },
        types: ["Sorcery"],
        effects,
    });
    return id;
}

/** Kill the announced creature (binding its snapshot), then sweep p2's
 *  creatures sharing a creature type with it. */
const sweepSharing = (ref: string): EffectOp[] => [
    { op: "destroy", target: { target: 0 }, bind: "$dead" },
    {
        op: "forEach",
        select: {
            set: "permanents",
            zone: "battlefield",
            controller: { target: 1 },
            filter: { type: "Creature", sharesCreatureTypeWith: { ref } },
        },
        effects: [{ op: "destroy", target: { ref: "$each" } }],
    },
];

function setup(
    effects: EffectOp[],
    p1Graveyard: ReturnType<typeof makeInstance>[] = []
) {
    const id = registerScript(`test-sctw-${Math.random()}`, effects);
    const state = makeState({
        players: [
            makePlayer("p1", {
                graveyard: p1Graveyard,
                battlefield: [
                    makeInstance(GOBLIN_WARRIOR, {
                        id: "dead",
                        controllerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(GOBLIN_SHAMAN, {
                        id: "shaman",
                        controllerId: "p2",
                    }),
                    makeInstance(ELF_WARRIOR, {
                        id: "elf-warrior",
                        controllerId: "p2",
                    }),
                    makeInstance(ELF_DRUID, {
                        id: "druid",
                        controllerId: "p2",
                    }),
                ],
            }),
        ],
    });
    pushSpell(state, id, "p1", [
        { type: "permanent", id: "dead" },
        { type: "player", id: "p2" },
    ]);
    resolveTopOfStack(state);
    return state;
}

describe("EffectCardFilter.sharesCreatureTypeWith (CR 205.3m, 608.2h)", () => {
    it("battlefield matcher: ANY shared creature type, read from the pre-death snapshot (CR 608.2h)", () => {
        const state = setup(sweepSharing("$dead"));
        // The referent is gone from the battlefield by the time the sweep
        // runs — only the snapshot knows it was a Goblin Warrior.
        expect(state.players[0].battlefield).toHaveLength(0);
        // Shaman shares Goblin, Elf Warrior shares Warrior, Druid shares nothing.
        expect(state.players[1].battlefield.map((c) => c.id)).toEqual([
            "druid",
        ]);
        // Wire format: the survivor projects with its creature types intact.
        const wire = projectPublicState(state, 1, "p1");
        expect(wire.players[1].battlefield.map((c) => c.subtypes)).toEqual([
            ["Elf", "Druid"],
        ]);
    });

    it("hidden-zone matcher (graveyard sweep) honours the same predicate", () => {
        const state = setup(
            [
                { op: "destroy", target: { target: 0 }, bind: "$dead" },
                {
                    op: "forEach",
                    select: {
                        set: "graveyard",
                        controller: "controller",
                        filter: {
                            type: "Creature",
                            sharesCreatureTypeWith: { ref: "$dead" },
                        },
                    },
                    effects: [
                        {
                            op: "moveZone",
                            target: { ref: "$each" },
                            to: "battlefield",
                        },
                    ],
                },
            ],
            [
                makeInstance(ELF_WARRIOR, {
                    id: "gy-elf-warrior",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
                makeInstance(ELF_DRUID, {
                    id: "gy-druid",
                    controllerId: "p1",
                    ownerId: "p1",
                    zone: "graveyard",
                }),
            ]
        );
        // The Elf Druid shares nothing with the dead Goblin Warrior and stays
        // put; the Elf Warrior (Warrior) and the destroyed card itself return.
        expect(state.players[0].battlefield.map((c) => c.id).sort()).toEqual([
            "dead",
            "gy-elf-warrior",
        ]);
        const graveyardIds = state.players[0].graveyard.map((c) => c.id);
        expect(graveyardIds).toContain("gy-druid");
        expect(graveyardIds).not.toContain("gy-elf-warrior");
    });

    it("fails CLOSED on a binding that was never captured — matches nothing, not everything", () => {
        const state = setup(sweepSharing("$unbound"));
        expect(state.players[1].battlefield).toHaveLength(3);
    });
});

describe("sharesCreatureTypeWith in the validator", () => {
    const host = (effects: EffectOp[]): EffectScriptHost => ({
        id: "test-host",
        name: "Test Host",
        effects,
    });

    it("accepts a declared snapshot binding", () => {
        expect(validateEffectScript(host(sweepSharing("$dead")))).toEqual([]);
    });

    it("rejects a non-selector value", () => {
        const bad = sweepSharing("$dead");
        (
            (
                bad[1] as unknown as {
                    select: { filter: Record<string, unknown> };
                }
            ).select.filter as Record<string, unknown>
        ).sharesCreatureTypeWith = "Goblin";
        expect(validateEffectScript(host(bad)).length).toBeGreaterThan(0);
    });

    it("rejects a literal subtype in the same clause (one subtype slot)", () => {
        const both = sweepSharing("$dead");
        (
            (
                both[1] as unknown as {
                    select: { filter: Record<string, unknown> };
                }
            ).select.filter as Record<string, unknown>
        ).subtype = "Elf";
        expect(validateEffectScript(host(both)).length).toBeGreaterThan(0);
    });
});
