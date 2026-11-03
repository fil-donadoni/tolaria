// `attach` with an explicit `attachment` (issue #3248) — CR 701.3a / 701.3b /
// 301.5c. The Op used to attach only `$source`; Thieving Skydiver's "If that
// artifact is an Equipment, attach it to this creature" attaches a NAMED
// object (the stolen target) onto `$source`. This file is the Op's permanent
// test for that form: the attach happens, moves the Equipment off its old
// host, and the CR 701.3b / 301.5c legality refuses every illegal pairing.

import { describe, it, expect } from "vitest";
import { getCardByName, registerTokenDefinition } from "../../../cards";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { resolveTopOfStack, type GameState } from "../../state";

const SKULLCLAMP = getCardByName("Skullclamp").id;
const MIND_STONE = getCardByName("Mind Stone").id;
const BEARS = getCardByName("Grizzly Bears").id;

// A creature whose ability attaches the announced permanent to ITSELF — the
// Thieving Skydiver shape, isolated from kicker and control change.
const PULLER_ID = "test-op-attach-explicit-puller";
registerTokenDefinition({
    id: PULLER_ID,
    name: PULLER_ID,
    rarity: "common",
    manaCost: { generic: 1 },
    types: ["Creature"],
    subtypes: ["Merfolk"],
    power: 2,
    toughness: 1,
    activatedAbilities: [
        {
            id: "pull-onto-self",
            oracleText: "test: attach target permanent to this creature",
            cost: {},
            useStack: true,
            targetRequirement: { type: "Artifact", count: 1 },
            effects: [
                {
                    op: "attach",
                    attachment: { target: 0 },
                    target: { ref: "$source" },
                },
            ],
        },
        {
            // The reverse direction: attach `$source`'s target artifact onto
            // another announced object (here a noncreature) — must refuse.
            id: "push-onto-target",
            oracleText: "test: attach target artifact to target permanent",
            cost: {},
            useStack: true,
            targetRequirement: { type: "Artifact", count: 2 },
            effects: [
                {
                    op: "attach",
                    attachment: { target: 0 },
                    target: { target: 1 },
                },
            ],
        },
    ],
});

function board(): GameState {
    return makeState({
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(PULLER_ID, {
                        id: "puller",
                        controllerId: "p1",
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(BEARS, { id: "bears", controllerId: "p2" }),
                    makeInstance(SKULLCLAMP, {
                        id: "clamp",
                        controllerId: "p2",
                        attachedTo: "bears",
                    }),
                    makeInstance(MIND_STONE, {
                        id: "stone",
                        controllerId: "p2",
                    }),
                ],
            }),
        ],
    });
}

function activate(
    state: GameState,
    abilityId: string,
    targetIds: string[]
): void {
    const src = state.players[0].battlefield.find((c) => c.id === "puller")!;
    state.stack.push({
        ...src,
        zone: "stack",
        castById: "p1",
        abilityId,
        targets: targetIds.map((id) => ({ type: "permanent" as const, id })),
    });
    resolveTopOfStack(state);
}

function attachedToOf(state: GameState, id: string): string | undefined {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found.attachedTo;
    }
    throw new Error(`${id} not on the battlefield`);
}

describe("attach — explicit attachment (CR 701.3a/701.3b/301.5c, issue #3248)", () => {
    it("attaches the named Equipment to $source, moving it off its previous host (CR 701.3a)", () => {
        const state = board();
        activate(state, "pull-onto-self", ["clamp"]);
        expect(attachedToOf(state, "clamp")).toBe("puller");
    });

    it("an object that is not an Aura, Equipment or Fortification does nothing (CR 701.3b)", () => {
        const state = board();
        activate(state, "pull-onto-self", ["stone"]);
        expect(attachedToOf(state, "stone")).toBeUndefined();
    });

    it("an Equipment never moves onto a noncreature host (CR 701.3b / 301.5c)", () => {
        const state = board();
        activate(state, "push-onto-target", ["clamp", "stone"]);
        expect(attachedToOf(state, "clamp")).toBe("bears");
    });

    it("an Equipment never equips itself (CR 301.5c)", () => {
        const state = board();
        activate(state, "push-onto-target", ["clamp", "clamp"]);
        expect(attachedToOf(state, "clamp")).toBe("bears");
    });

    it("the attach is a no-op once $source has left the battlefield (CR 608.2b)", () => {
        const state = board();
        const src = state.players[0].battlefield.find(
            (c) => c.id === "puller"
        )!;
        state.stack.push({
            ...src,
            zone: "stack",
            castById: "p1",
            abilityId: "pull-onto-self",
            targets: [{ type: "permanent", id: "clamp" }],
        });
        state.players[0].battlefield = [];
        resolveTopOfStack(state);
        expect(attachedToOf(state, "clamp")).toBe("bears");
    });
});
