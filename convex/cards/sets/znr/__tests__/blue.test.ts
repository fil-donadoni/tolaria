// ZNR — blue card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    resolveTriggerOrder,
} from "../../../__tests__/setup.helper";
import {
    getPlayer,
    resolveTopOfStack,
    type GameState,
    type PendingTarget,
} from "../../../../gre/state";
import { raiseTriggerTargetSelection } from "../../../../gre/rules";
import { finalizeTargetSelection } from "../../../../game";
import { assertKickerMinX, paidKickersMinX } from "../../../../gre/kicker";
import { compactState, expandState } from "../../../../gre/serialize";
import { projectPublicState } from "../../../../gameProjections";
import { getDefinition } from "../../../index";
import { preloadDefinitions } from "../../../registry";
import { thievingSkydiver } from "../blue.cards";

// Registered from its module, not looked up through `data/catalogue/*`: the
// catalogue bytes are base-owned (ADR 0157), so a branch's tests must not
// depend on them carrying a card the branch adds.
preloadDefinitions([thievingSkydiver()]);

const SKULLCLAMP = getDefinition("55318397-de3c-47ea-a088-72a24df5c8fa").id; // {1} Equipment
const MIND_STONE = getDefinition("162e81d3-6cd4-4cb8-8ed8-cfbd8d34ca71").id; // {2} Artifact
const GREAVES = getDefinition("61a28870-cf78-4323-9d82-cee764067764").id; // {2} Equipment
const BEARS = getDefinition("ce2d603a-3231-4a8c-bf39-1617586ea870").id;

// Thieving Skydiver — {1}{U} 2/1 Merfolk Rogue, flying. "Kicker {X}. X can't
// be 0. / When this creature enters, if it was kicked, gain control of target
// artifact with mana value X or less. If that artifact is an Equipment,
// attach it to this creature." (issue #3248)

/** p2 controls Grizzly Bears wearing a Skullclamp, a Mind Stone and an
 *  unattached Lightning Greaves; p1 casts Thieving Skydiver with exactly the
 *  blue mana the announcement costs. */
function castSkydiver(
    announce: Pick<PendingTarget, "kickerPayments" | "chosenX">
): GameState {
    const kickedFor = announce.kickerPayments ? (announce.chosenX ?? 0) : 0;
    const state = makeState({
        players: [
            makePlayer("p1", {
                hand: [
                    makeInstance(thievingSkydiver().id, {
                        id: "skydiver",
                        zone: "hand",
                        controllerId: "p1",
                        ownerId: "p1",
                    }),
                ],
                manaPool: { W: 0, U: 2 + kickedFor, B: 0, R: 0, G: 0, C: 0 },
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(BEARS, { id: "bears", controllerId: "p2" }),
                    makeInstance(SKULLCLAMP, {
                        id: "clamp",
                        controllerId: "p2",
                        ownerId: "p2",
                        attachedTo: "bears",
                    }),
                    makeInstance(MIND_STONE, {
                        id: "stone",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                    makeInstance(GREAVES, {
                        id: "greaves",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        phase: "PRECOMBAT_MAIN",
    });
    finalizeTargetSelection(
        state,
        {
            playerId: "p1",
            cardInstanceId: "skydiver",
            targetType: "any",
            count: 0,
            selected: [],
            ...announce,
        },
        "p1"
    );
    return state;
}

/** Resolve the creature spell, put its ETB on the stack and raise its target
 *  announcement (CR 603.3d), with a save/load in between like a mutation. */
function enterBattlefield(state: GameState): GameState {
    resolveTopOfStack(state);
    resolveTriggerOrder(state);
    const loaded = expandState(compactState(state));
    raiseTriggerTargetSelection(loaded);
    return loaded;
}

function controllerOf(state: GameState, id: string): string | undefined {
    for (const p of state.players) {
        if (p.battlefield.some((c) => c.id === id)) return p.id;
    }
    return undefined;
}

function permanent(state: GameState, id: string) {
    for (const p of state.players) {
        const found = p.battlefield.find((c) => c.id === id);
        if (found) return found;
    }
    throw new Error(`${id} not on the battlefield`);
}

describe("Thieving Skydiver — Kicker {X}, X can't be 0 (CR 107.3 / 601.2b)", () => {
    it("kicking for X = 0 is an illegal announcement; not kicking is legal", () => {
        const def = thievingSkydiver();
        expect(() => assertKickerMinX(def, { kicker: 1 }, 0)).toThrow(
            /X can't be less than 1/
        );
        expect(() => assertKickerMinX(def, { kicker: 1 }, 1)).not.toThrow();
        expect(() => assertKickerMinX(def, undefined, undefined)).not.toThrow();
        expect(paidKickersMinX(def, undefined)).toBe(0);
    });
});

describe("Thieving Skydiver — kicked ETB (CR 603.4 / 701.3a / 107.3m)", () => {
    it("kicked for X = 1: steals the only artifact with MV ≤ 1, an Equipment, and attaches it", () => {
        const state = enterBattlefield(
            castSkydiver({ kickerPayments: { kicker: 1 }, chosenX: 1 })
        );
        // Skullclamp is the sole legal target (Mind Stone / Greaves are MV 2):
        // auto-selected (CR 603.3d).
        const trigger = state.stack[state.stack.length - 1];
        expect(trigger?.targets).toEqual([{ type: "permanent", id: "clamp" }]);
        resolveTopOfStack(state);
        expect(controllerOf(state, "clamp")).toBe("p1");
        expect(permanent(state, "clamp").attachedTo).toBe("skydiver");
        // Wire format: the client sees the new controller and host.
        const view = projectPublicState(state, 1, "p1");
        const wire = view.players
            .flatMap((p) => p.battlefield)
            .find((c) => c.id === "clamp");
        expect(wire?.attachedTo).toBe("skydiver");
        expect(
            view.players
                .find((p) => p.id === "p1")
                ?.battlefield.map((c) => c.id)
        ).toContain("clamp");
    });

    it("kicked for X = 2: Mind Stone, Greaves and Skullclamp are all legal; a non-Equipment is stolen without an attach", () => {
        const state = enterBattlefield(
            castSkydiver({ kickerPayments: { kicker: 1 }, chosenX: 2 })
        );
        expect(state.pendingTarget?.kind).toBe("trigger");
        // CR 107.3m — the carried filter `selectTarget` re-validates against
        // is the cast's X, not 0.
        expect(state.pendingTarget?.mvFilter).toEqual({ max: 2 });
        const trigger = state.stack[state.stack.length - 1]!;
        trigger.targets = [{ type: "permanent", id: "stone" }];
        state.pendingTarget = undefined;
        resolveTopOfStack(state);
        expect(controllerOf(state, "stone")).toBe("p1");
        expect(permanent(state, "stone").attachedTo).toBeUndefined();
    });

    it("the control change outlives the Skydiver; the attach does not happen without it (CR 608.2b)", () => {
        const state = enterBattlefield(
            castSkydiver({ kickerPayments: { kicker: 1 }, chosenX: 1 })
        );
        const p1 = getPlayer(state, "p1");
        p1.battlefield = p1.battlefield.filter((c) => c.id !== "skydiver");
        resolveTopOfStack(state);
        expect(controllerOf(state, "clamp")).toBe("p1");
        expect(permanent(state, "clamp").attachedTo).not.toBe("skydiver");
    });

    it("unkicked: the ETB never goes on the stack (CR 603.4)", () => {
        const state = enterBattlefield(castSkydiver({}));
        expect(state.stack).toHaveLength(0);
        expect(controllerOf(state, "clamp")).toBe("p2");
        expect(controllerOf(state, "skydiver")).toBe("p1");
    });
});
