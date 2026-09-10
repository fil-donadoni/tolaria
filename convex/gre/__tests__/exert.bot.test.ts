// Bot reachability for exert (CR 701.43d / 508.1g) — the three seams the
// mechanic touches, per `.claude/rules/gre-development.md` § Bot reachability.
//
// Seam 1 (enumerateMoves): the paid AND the declined declaration must both be
// offered, or the bot can never choose.
// Seam 2 (the choice surface): exert raises NO PendingChoice — it rides on the
// `declare-attackers` Move itself, so there is nothing for the bot to freeze
// on. That is asserted here rather than assumed.
// Seam 3 (valuation): the payoff is the linked trigger's damage, which the
// search sees because `applyMoveInSearch` applies the exert through the real
// engine. Pinned end-to-end by the `must` blade entry
// ("exerts Glorybringer to kill the blocker it would trade with").

import { describe, it, expect } from "vitest";
import { enumerateAttackerMoves } from "../moves";
import { applyMoveInSearch } from "../search";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { glorybringer } from "../../cards/sets/akh/red";
import { grizzlyBears } from "../../cards/sets/lea/green";
import type { GameState } from "../state";

function declareAttackersState(): GameState {
    return makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", {
                battlefield: [
                    makeInstance(glorybringer.id, {
                        id: "glory",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                    }),
                    makeInstance(grizzlyBears.id, {
                        id: "bears",
                        controllerId: "p1",
                        ownerId: "p1",
                        isSummoningSick: false,
                    }),
                ],
            }),
            makePlayer("p2", {
                battlefield: [
                    makeInstance(grizzlyBears.id, {
                        id: "victim",
                        controllerId: "p2",
                        ownerId: "p2",
                    }),
                ],
            }),
        ],
        combat: {
            attackerIds: [],
            confirmed: false,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
}

describe("exert reachability for the Bot (CR 508.1g / 701.43d)", () => {
    it("enumerates BOTH the declined and the paid declaration for an exert-capable attacker", () => {
        const state = declareAttackersState();
        const moves = enumerateAttackerMoves(state, state.players[0]);
        const withGlory = moves.filter(
            (m) =>
                m.kind === "declare-attackers" &&
                m.attackerIds.includes("glory")
        );
        expect(withGlory.length).toBeGreaterThan(0);
        // CR 508.1d — declining a cost to attack is always legal.
        expect(
            withGlory.some(
                (m) =>
                    m.kind === "declare-attackers" &&
                    (m.exertIds ?? []).length === 0
            )
        ).toBe(true);
        expect(
            withGlory.some(
                (m) =>
                    m.kind === "declare-attackers" &&
                    (m.exertIds ?? []).includes("glory")
            )
        ).toBe(true);
    });

    it("never offers exert for a creature that does not declare the static ability", () => {
        const state = declareAttackersState();
        const moves = enumerateAttackerMoves(state, state.players[0]);
        for (const m of moves) {
            if (m.kind !== "declare-attackers") continue;
            expect(m.exertIds ?? []).not.toContain("bears");
        }
    });

    it("applies the paid declaration through the real engine — flag stamped, linked trigger on the stack, no pending choice", () => {
        const state = declareAttackersState();
        applyMoveInSearch(state, "p1", {
            kind: "declare-attackers",
            attackerIds: ["glory"],
            exertIds: ["glory"],
        });

        const glory = state.players[0].battlefield.find(
            (c) => c.id === "glory"
        );
        expect(glory?.skipNextUntap).toBe(true);
        expect(state.combat?.exertedIds).toEqual(["glory"]);
        // CR 607.2h — the linked trigger reached the stack IN THE SEARCH, which
        // is the whole reason the exert is worth anything to the bot: the
        // payoff is the trigger's damage, not the flag.
        expect(state.stack).toHaveLength(1);
        expect(state.stack[0].triggeredAbilityId).toBe(
            "glorybringer-exert-damage"
        );
        // Seam 2 — exert never parks a choice, so there is nothing the bot
        // could stall on (`.claude/rules/bot-development.md`: ignored and
        // frozen are both unshipped).
        expect(state.pendingChoices ?? []).toHaveLength(0);
    });

    it("applies the DECLINED declaration with no exert and no trigger", () => {
        const state = declareAttackersState();
        applyMoveInSearch(state, "p1", {
            kind: "declare-attackers",
            attackerIds: ["glory"],
        });
        const glory = state.players[0].battlefield.find(
            (c) => c.id === "glory"
        );
        expect(glory?.skipNextUntap).toBeUndefined();
        expect(state.combat?.exertedIds).toBeUndefined();
    });
});
