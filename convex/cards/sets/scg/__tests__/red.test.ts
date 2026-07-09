// Per-card behavior tests for red cards in `convex/cards/sets/scg/red.ts`
// (Scourge, split by colour per ADR 0043). Fixtures come from
// convex/cards/__tests__/setup.ts; stack/resolve shims are inlined here (this
// is the first behavioral card in the SCG red module).

import { describe, it, expect } from "vitest";

import {
    type CardInstanceState,
    type GameState,
    type StackItem,
    gainLifeEmitting,
    resolveTopOfStack,
} from "../../../../gre/state";
import { projectPublicState } from "../../../../gameProjections";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { sulfuricVortex } from "../red";

/** Push a triggered ability onto the stack with its firing event, then resolve
 *  (CR 603 — the trigger carries the source's characteristics). */
function resolveTrigger(
    state: GameState,
    source: CardInstanceState,
    triggeredAbilityId: string,
    activePlayerId: string
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId,
        triggerSourceId: source.id,
        triggerEvent: {
            type: "PHASE_BEGIN",
            phase: "UPKEEP",
            activePlayerId,
        } as StackItem["triggerEvent"],
        targets: [],
    });
    resolveTopOfStack(state);
}

function makeVortexState(): { state: GameState; vortex: CardInstanceState } {
    const vortex = makeInstance(sulfuricVortex.id, {
        id: "vortex",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        activePlayerId: "p1",
        phase: "UPKEEP",
        players: [
            makePlayer("p1", { life: 20, battlefield: [vortex] }),
            makePlayer("p2", { life: 20 }),
        ],
    });
    return { state, vortex };
}

describe("Sulfuric Vortex — each-upkeep 2 damage (CR 603.6a)", () => {
    it("deals 2 to the controller on the controller's upkeep", () => {
        const { state, vortex } = makeVortexState();
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p1");
        expect(state.players[0].life).toBe(18);
        expect(state.players[1].life).toBe(20);
    });

    it("deals 2 to the OPPONENT on the opponent's upkeep (scope: each)", () => {
        const { state, vortex } = makeVortexState();
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p2");
        expect(state.players[1].life).toBe(18);
        expect(state.players[0].life).toBe(20);
    });

    it("pings each player across successive upkeeps", () => {
        const { state, vortex } = makeVortexState();
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p1");
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p2");
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p1");
        expect(state.players[0].life).toBe(16); // pinged twice
        expect(state.players[1].life).toBe(18); // pinged once
    });

    it("the reduced life survives the wire projection", () => {
        const { state, vortex } = makeVortexState();
        resolveTrigger(state, vortex, "sulfuric-vortex-upkeep-ping", "p2");
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[1].life).toBe(18);
    });
});

describe("Sulfuric Vortex — life-gain lock (CR 614 / 118.6)", () => {
    it("blocks life gain for the controller while on the battlefield", () => {
        const { state } = makeVortexState();
        gainLifeEmitting(state, "p1", 5);
        expect(state.players[0].life).toBe(20); // no life gained
    });

    it("blocks life gain for EVERY player, not just the controller", () => {
        const { state } = makeVortexState();
        gainLifeEmitting(state, "p2", 7);
        expect(state.players[1].life).toBe(20); // no life gained
    });

    it("life gain resumes once Sulfuric Vortex leaves the battlefield", () => {
        const { state } = makeVortexState();
        gainLifeEmitting(state, "p1", 5);
        expect(state.players[0].life).toBe(20);
        // Vortex leaves play — the continuous replacement lifts.
        state.players[0].battlefield = [];
        gainLifeEmitting(state, "p1", 5);
        expect(state.players[0].life).toBe(25);
    });

    it("the locked (unchanged) life survives the wire projection", () => {
        const { state } = makeVortexState();
        gainLifeEmitting(state, "p1", 5);
        const projected = projectPublicState(state, 1, "p1");
        expect(projected.players[0].life).toBe(20);
    });
});

describe("Sulfuric Vortex — definition snapshot", () => {
    it("is a {1}{R}{R} red Enchantment with both effects declared", () => {
        expect(sulfuricVortex.manaCost).toEqual({ X: 1, R: 2 });
        expect(sulfuricVortex.types).toEqual(["Enchantment"]);
        expect(sulfuricVortex.triggeredAbilities).toHaveLength(1);
        expect(sulfuricVortex.replacementEffects).toHaveLength(1);
        expect(sulfuricVortex.replacementEffects?.[0].eventKind).toBe(
            "lifegain"
        );
    });
});
