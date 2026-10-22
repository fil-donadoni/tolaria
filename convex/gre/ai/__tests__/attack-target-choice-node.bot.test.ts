// Bot reachability for the CR 508.4 as-enters attack-target choice (issue
// #1865). The prompt reuses the `option-pick` shape (ADR 0100 D3), so the
// question is not a new dispatch arm but whether the in-tree search can see
// BOTH answers — attacking the defending player and attacking the planeswalker
// — as submittable moves, so the search's evaluator (combat damage to
// loyalty, CR 120.3c) CAN choose between them rather than a fixed default.
// Reachability only: which answer it prefers is not asserted here.
import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
    pushSpell,
} from "../../../cards/__tests__/setup.helper";
import { registerTokenDefinition } from "../../../cards";
import { resolveTopOfStack, type GameState } from "../../state";
import { applyPendingChoiceSubmit } from "../../pendingChoiceSubmit";
import { choiceCandidates, isSearchableChoiceNode } from "../choiceCandidates";
import { grizzlyBears } from "../../../cards/sets/lea/green.cards";
import { wrennAndSix } from "../../../cards/sets/mh1/multicolor.cards";

const SCRIPT = "test-1865-bot-attacking-token";
registerTokenDefinition({
    id: SCRIPT,
    name: SCRIPT,
    rarity: "common",
    manaCost: { W: 1 },
    types: ["Instant"],
    effects: [
        {
            op: "createToken",
            token: {
                name: "Soldier",
                types: ["Creature"],
                power: 1,
                toughness: 1,
                entersTapped: true,
                entersAttacking: true,
            },
            controller: "controller",
        },
    ],
});

/** The bot (p1) is attacking p2, who controls a planeswalker; the token
 *  script resolved and stopped on the attack-target choice. */
function stoppedOnAttackTarget(): GameState {
    const attacker = makeInstance(grizzlyBears().id, {
        id: "atk1",
        controllerId: "p1",
        ownerId: "p1",
    });
    attacker.isAttacking = true;
    const walker = makeInstance(wrennAndSix().id, {
        id: "pw-1",
        controllerId: "p2",
        ownerId: "p2",
        counters: { loyalty: 3 },
    });
    const state = makeState({
        phase: "DECLARE_ATTACKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [attacker] }),
            makePlayer("p2", { battlefield: [walker] }),
        ],
        combat: {
            attackerIds: ["atk1"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
        },
    });
    pushSpell(state, SCRIPT, "p1");
    resolveTopOfStack(state);
    return state;
}

describe("CR 508.4 attack-target choice is an in-tree decision node (issue #1865)", () => {
    it("the search opens both the defending player and the planeswalker", () => {
        const state = stoppedOnAttackTarget();
        const head = state.pendingChoices![0];
        expect(head.asEntersKind).toBe("attack-target");
        expect(isSearchableChoiceNode(head)).toBe(true);
        const opened = choiceCandidates(state, head).map((c) =>
            c.move.kind === "resolution-choice" ? c.move.cardInstanceIds : []
        );
        expect(opened).toEqual(expect.arrayContaining([["p2"], ["pw-1"]]));
    });

    it("each opened answer is a legal submission that puts the token into combat", () => {
        for (const pick of ["p2", "pw-1"]) {
            const state = stoppedOnAttackTarget();
            const head = state.pendingChoices![0];
            const move = choiceCandidates(state, head).find(
                (c) =>
                    c.move.kind === "resolution-choice" &&
                    c.move.cardInstanceIds[0] === pick
            )!.move;
            if (move.kind !== "resolution-choice") throw new Error("kind");
            applyPendingChoiceSubmit(state, {
                playerId: head.playerId,
                stackItemId: move.stackItemId,
                step: move.step,
                choiceId: move.choiceId,
                cardInstanceIds: move.cardInstanceIds,
            });
            const token = state.players[0].battlefield.find((c) => c.isToken)!;
            expect(token.isAttacking).toBe(true);
            expect(state.combat!.attackTargets?.[token.id]).toBe(
                pick === "pw-1" ? "pw-1" : undefined
            );
        }
    });
});
