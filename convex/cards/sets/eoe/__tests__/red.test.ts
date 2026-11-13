// eoe (Edge of Eternities) — red behavior tests (ADR 0043 colour split).
//
// Weapons Manufacturing (issue #8646): the nontoken-artifact enter trigger
// (CR 603.6a, CR 111.1), the Munitions token's own leaves-the-battlefield
// trigger (CR 603.6c, CR 707.2) with its announced "any target" (CR 603.3d),
// and the wire path through `projectPublicState` / a cold token-id decode.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../__tests__/setup.helper";
import {
    getPlayer,
    processPendingActionTriggers,
    removePermanentTo,
    resolveTopOfStack,
    type GameState,
} from "../../../../gre/state";
import { collectTriggers } from "../../../../gre/triggers";
import type { PermanentEnteredEvent } from "../../../types";
import { getDefinition, preloadDefinitions } from "../../../index";
import { projectPublicState } from "../../../../gameProjections";
import { weaponsManufacturing } from "../red.cards";

preloadDefinitions([weaponsManufacturing()]);

const MUNITIONS_TRIGGER = "munitions-leaves-damage";

function board() {
    const wm = makeInstance(weaponsManufacturing().id, {
        id: "wm",
        controllerId: "p1",
        ownerId: "p1",
    });
    return makeState({
        activePlayerId: "p1",
        players: [makePlayer("p1", { battlefield: [wm] }), makePlayer("p2")],
    });
}

function entered(
    controllerId: string,
    types: string[],
    isToken?: boolean
): PermanentEnteredEvent {
    return {
        type: "PERMANENT_ENTERED",
        instanceId: "artifact-x",
        controllerId,
        types,
        ...(isToken ? { isToken: true } : {}),
    } as PermanentEnteredEvent;
}

const makers = (state: GameState, event: PermanentEnteredEvent) =>
    collectTriggers(state, [event]).filter(
        (t) => t.triggeredAbilityId === "weapons-manufacturing-munitions"
    );

/** Resolves the enter trigger and returns the new Munitions token. */
function makeMunitions(state: GameState) {
    const [trigger] = makers(state, entered("p1", ["Artifact"]));
    state.stack.push(trigger);
    resolveTopOfStack(state);
    return state.players[0].battlefield.find((c) => c.isToken)!;
}

describe("Weapons Manufacturing — enter trigger (CR 603.6a, CR 111.1)", () => {
    it("fires for your nontoken artifact only", () => {
        const state = board();
        expect(makers(state, entered("p1", ["Artifact"]))).toHaveLength(1);
        expect(
            makers(state, entered("p1", ["Artifact", "Creature"]))
        ).toHaveLength(1);
        expect(makers(state, entered("p1", ["Artifact"], true))).toHaveLength(
            0
        );
        expect(makers(state, entered("p2", ["Artifact"]))).toHaveLength(0);
        expect(makers(state, entered("p1", ["Creature"]))).toHaveLength(0);
    });

    it("creates one colorless artifact token named Munitions", () => {
        const state = board();
        const token = makeMunitions(state);
        expect(token.types).toEqual(["Artifact"]);
        expect(getDefinition((token.card as { id: string }).id).name).toBe(
            "Munitions"
        );
    });
});

describe("Munitions — leaves-the-battlefield trigger (CR 603.6c, CR 603.3d)", () => {
    it("deals 2 damage to the announced target when it leaves", () => {
        const state = board();
        const token = makeMunitions(state);
        const lifeBefore = getPlayer(state, "p2").life;

        removePermanentTo(state, token.id, "graveyard", "sacrifice");
        processPendingActionTriggers(state);
        const item = state.stack.find(
            (s) => s.triggeredAbilityId === MUNITIONS_TRIGGER
        )!;
        expect(item).toBeDefined();
        item.targets = [{ type: "player", id: "p2" }];
        resolveTopOfStack(state);

        expect(getPlayer(state, "p2").life).toBe(lifeBefore - 2);
    });

    it("survives projectPublicState and a cold decode with its target requirement", () => {
        const state = board();
        const token = makeMunitions(state);
        const projected = projectPublicState(state, 1, "p1");
        const slim = projected.players[0].battlefield.find(
            (c) => c.id === token.id
        )!;
        const ability = getDefinition((slim.card as { id: string }).id)
            .triggeredAbilities![0];
        expect(ability.id).toBe(MUNITIONS_TRIGGER);
        expect(ability.event).toBe("PERMANENT_LEFT");
        expect(ability.targetRequirement).toEqual({ type: "any", count: 1 });
    });
});
