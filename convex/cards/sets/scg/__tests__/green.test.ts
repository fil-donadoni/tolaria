import { describe, expect, it } from "vitest";

import { getLegalActions } from "../../../../gre/rules";
import { resolveTopOfStack } from "../../../../gre/state";
import type {
    CardInstanceState,
    GameState,
    StackItem,
} from "../../../../gre/state";
import { finalizeCleanup } from "../../../../gre/phases";
import { castProhibitionReason } from "../../../castRestrictions";
import { projectPublicState } from "../../../../gameProjections";
import { lightningBolt } from "../../lea/red";
import { makeInstance, makePlayer, makeState } from "../../../__tests__/setup";
import { xantidSwarm } from "../green";

/** Push Xantid Swarm's attack trigger onto the stack with the firing event and
 *  resolve it (CR 603 — the trigger carries its source's characteristics). */
function resolveAttackTrigger(
    state: GameState,
    source: CardInstanceState
): void {
    state.stack.push({
        ...source,
        zone: "stack",
        castById: source.controllerId,
        triggeredAbilityId: "xantid-swarm-attack-cast-lock",
        triggerSourceId: source.id,
        triggerEvent: {
            type: "ATTACKERS_DECLARED",
            attackingPlayerId: source.controllerId,
            attackerIds: [source.id],
        },
        targets: [],
    } as StackItem);
    resolveTopOfStack(state);
}

/** p1 controls Xantid Swarm; p2 holds a Lightning Bolt and R mana, and it is
 *  p2's turn to respond (priority, instant speed) so the cast affordance is
 *  live unless the lock suppresses it. */
function boardWithSwarm(): { state: GameState; swarm: CardInstanceState } {
    const swarm = makeInstance(xantidSwarm.id, {
        id: "swarm-1",
        controllerId: "p1",
        ownerId: "p1",
        zone: "battlefield",
    });
    const bolt = makeInstance(lightningBolt.id, {
        id: "bolt-1",
        controllerId: "p2",
        ownerId: "p2",
        zone: "hand",
    });
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: [swarm] }),
            makePlayer("p2", {
                hand: [bolt],
                manaPool: { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 },
            }),
        ],
        activePlayerId: "p1",
        priorityPlayerId: "p2",
    });
    return { state, swarm };
}

describe("Xantid Swarm (SCG, CR 601.3a — defending player can't cast spells this turn)", () => {
    it("is a {G} 0/1 flyer", () => {
        expect(xantidSwarm.manaCost).toEqual({ G: 1 });
        expect(xantidSwarm.power).toBe(0);
        expect(xantidSwarm.toughness).toBe(1);
        expect(xantidSwarm.staticAbilities).toContain("flying");
    });

    it("locks the defending player out of casting when it attacks", () => {
        const { state, swarm } = boardWithSwarm();
        expect(state.cannotCastSpellsThisTurn).toBeUndefined();
        resolveAttackTrigger(state, swarm);
        // "opponent" = the non-controller of the trigger (the defending
        // player), CR 102.2.
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
    });

    it("the shared cast gate rejects the defending player's spell (GRE + client agree)", () => {
        const { state, swarm } = boardWithSwarm();
        const bolt = state.players[1].hand[0];
        expect(castProhibitionReason("p2", bolt, state)).toBeUndefined();
        resolveAttackTrigger(state, swarm);
        expect(castProhibitionReason("p2", bolt, state)).toBeDefined();
        // The attacking player is unaffected.
        expect(castProhibitionReason("p1", bolt, state)).toBeUndefined();
    });

    it("removes the defending player's `cast` legal action (GRE → UI full path)", () => {
        const { state, swarm } = boardWithSwarm();
        const p2 = state.players[1];
        const bolt = p2.hand[0];
        // Before the attack: p2 could cast the instant in response.
        expect(getLegalActions(state, p2, bolt)).toContain("cast");
        resolveAttackTrigger(state, swarm);
        // After the lock: the server drops "cast", so the client offers none.
        expect(getLegalActions(state, state.players[1], bolt)).not.toContain(
            "cast"
        );
    });

    it("the lock and the suppressed cast affordance survive the wire projection", () => {
        const { state, swarm } = boardWithSwarm();
        resolveAttackTrigger(state, swarm);
        const projected = projectPublicState(state, 1, "p2");
        expect(projected.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
        // The projected hand card p2 sees carries no "cast" affordance.
        const projectedBolt = projected.players[1].hand.find(
            (c) => c?.id === "bolt-1"
        )!;
        expect(projectedBolt.legalActions).not.toContain("cast");
    });

    it("the lock survives END_OF_COMBAT but expires at CLEANUP (CR 511.3 / 514.2)", () => {
        const { state, swarm } = boardWithSwarm();
        resolveAttackTrigger(state, swarm);
        state.stack = [];
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
        // The duration tick also runs at END_OF_COMBAT (CR 511.3) — the lock
        // must NOT clear there, or the defending player could cast in the
        // postcombat main phase.
        state.phase = "END_OF_COMBAT";
        finalizeCleanup(state);
        expect(state.cannotCastSpellsThisTurn).toEqual([
            { playerId: "p2", cardTypes: undefined },
        ]);
        // At the CLEANUP boundary the lock finally lifts (CR 514.2).
        state.phase = "CLEANUP";
        finalizeCleanup(state);
        expect(state.cannotCastSpellsThisTurn).toBeUndefined();
    });
});
