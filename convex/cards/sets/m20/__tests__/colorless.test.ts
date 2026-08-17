// M20 — colorless card behavior tests (ADR 0043 colour split).

import { describe, it, expect } from "vitest";
import { manifoldKey } from "../colorless";
import { balduvianBears } from "../../ice";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";

/** Push an activated ability onto the stack with its cost assumed already
 *  paid, then resolve it (mirrors post-activateAbility state). */
function resolveActivated(
    state: GameState,
    source: CardInstanceState,
    abilityId: string,
    targets: StackItem["targets"] = []
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        abilityId,
        targets,
    });
    resolveTopOfStack(state);
}

// Manifold Key — {1} Artifact (CR 701.26 untap; "can't be blocked" via the
// engine's `unblockable` keyword grant, CR 613.1f temporary keyword grant).
describe("Manifold Key (CR 701.26 untap-another; CR 613.1f unblockable grant)", () => {
    function setup() {
        const key = makeInstance(manifoldKey.id, {
            id: "key",
            controllerId: "p1",
            ownerId: "p1",
        });
        const otherArtifact = makeInstance(manifoldKey.id, {
            id: "other-key",
            controllerId: "p1",
            ownerId: "p1",
            isTapped: true,
        });
        const creature = makeInstance(balduvianBears.id, {
            id: "bears",
            controllerId: "p1",
            ownerId: "p1",
        });
        const state = makeState({
            players: [
                makePlayer("p1", {
                    battlefield: [key, otherArtifact, creature],
                }),
                makePlayer("p2"),
            ],
        });
        return { state, key, otherArtifact, creature };
    }

    it("untaps another target artifact", () => {
        const { state, key } = setup();
        resolveActivated(state, key, "manifold-key-untap", [
            { type: "permanent", id: "other-key" },
        ]);
        const other = state.players[0].battlefield.find(
            (c) => c.id === "other-key"
        )!;
        expect(other.isTapped).toBe(false);
    });

    it("excludes itself from the untap target ('another target artifact')", () => {
        const { state, key } = setup();
        const ability = manifoldKey.activatedAbilities![0];
        const dynamicReq = ability.getTargetRequirement!(
            key as never,
            state as never
        );
        expect(dynamicReq.excludeInstanceIds).toEqual([key.id]);
    });

    it("grants a target creature unblockable until end of turn", () => {
        const { state, key } = setup();
        resolveActivated(state, key, "manifold-key-unblockable", [
            { type: "permanent", id: "bears" },
        ]);
        const bears = state.players[0].battlefield.find(
            (c) => c.id === "bears"
        )!;
        expect(bears.staticAbilities).toContain("unblockable");
    });
});
