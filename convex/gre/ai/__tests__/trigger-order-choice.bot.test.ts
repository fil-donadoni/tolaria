// Simultaneous-trigger ordering as an in-tree ISMCTS node (CR 603.3b, ADR
// 0058, issue #3222).
//
// `trigger-order` had no candidate generator, and an UNREGISTERED kind is not
// "answered by a default" — it is a wall. `choiceCandidates` returns `[]`,
// `decidingPlayer` returns null, and both the descent and the rollout stop and
// leaf-score the position where they stand.
//
// That was harmless while nothing raised a batch mid-search. It stopped being
// harmless when `applyMoveInSearch` started emitting ATTACKERS_DECLARED (the
// same issue): two DIFFERENT attack triggers under one controller — a
// battle-cry creature swinging beside a Sentinel of the Nameless City — raise
// exactly this choice at declare-attackers, so the attack
// branch was scored with its attackers tapped and NO combat damage while
// `pass` rolled out in full. Attacking, undervalued precisely where the
// emission was meant to make it visible.
//
// What this file pins: the batch is raised through the REAL path, the search
// can name a decider for it, the generator's single canonical answer is a
// permutation of the batch (never a subset — `applyPendingChoiceSubmit`
// rejects anything else), and applying it through the real resolver clears the
// choice and lands both triggers on the stack.
import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup";
import type { GameState } from "../../state";
import { emitAttackersDeclaredEvents } from "../../phases";
import { markAttacking } from "../../combat";
import { applyMoveInSearch, decidingPlayer } from "../../search";
import {
    choiceCandidates,
    hasChoiceCandidateGenerator,
} from "../choiceCandidates";
import { getDefinition } from "../../../cards";

const SANGUINE_EVANGELIST_ID = "269ddd84-fdc4-4c94-b183-32ecec56967c";
/** Sentinel of the Nameless City — "whenever this creature enters or attacks,
 *  create a Map token" (`sets/lci/green.ts`), the second attack trigger. */
const SENTINEL_ID = "eeeffc0b-dc92-458e-ad58-86ff6077a508";

/** p1 attacks with `attackers`, declared the way the phase machine declares
 *  them, then emits the CR 508.1m batch through the real emitter. */
function attackWith(cardIds: string[]): GameState {
    const creatures = cardIds.map((cardId, i) =>
        makeInstance(cardId, {
            id: `atk${i}`,
            controllerId: "p1",
            ownerId: "p1",
            zone: "battlefield",
        })
    );
    const state = makeState({
        players: [
            makePlayer("p1", { battlefield: creatures }),
            makePlayer("p2"),
        ],
        phase: "DECLARE_ATTACKERS",
    });
    state.combat = {
        attackerIds: creatures.map((c) => c.id),
        confirmed: true,
        blockerAssignments: {},
        blockersConfirmed: false,
    };
    for (const c of state.players[0].battlefield) markAttacking(state, c);
    emitAttackersDeclaredEvents(state);
    return state;
}

describe("trigger-order as a search node (CR 603.3b, issue #3222)", () => {
    it("is a registered choice kind", () => {
        expect(hasChoiceCandidateGenerator("trigger-order")).toBe(true);
    });

    it("one attack trigger raises no ordering choice at all", () => {
        // The control: nothing to order, so the trigger goes straight on the
        // stack and the search never sees a choice.
        const state = attackWith([SANGUINE_EVANGELIST_ID]);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(1);
    });

    it("two DIFFERENT attack triggers raise one the search can descend past", () => {
        const state = attackWith([SANGUINE_EVANGELIST_ID, SENTINEL_ID]);
        const choice = (state.pendingChoices ?? [])[0];
        expect(choice?.kind).toBe("trigger-order");
        // The wall this closes: with no generator, `decidingPlayer` is null
        // and every playout crossing the batch halts here.
        expect(decidingPlayer(state)).toBe(choice.playerId);

        const candidates = choiceCandidates(state, choice);
        expect(candidates).toHaveLength(1);
        const move = candidates[0].move;
        expect(move.kind).toBe("resolution-choice");
        // A PERMUTATION of the batch, never a subset — the resolver rejects
        // anything else, and a rejected submission is a stuck search.
        expect(
            [...(move as { cardInstanceIds: string[] }).cardInstanceIds].sort()
        ).toEqual([...(choice.candidateIds ?? [])].sort());

        // Round trip through the real applier: the choice clears and the whole
        // batch reaches the stack.
        const batchSize = choice.candidateIds!.length;
        applyMoveInSearch(state, choice.playerId, move);
        expect(state.pendingChoices ?? []).toHaveLength(0);
        expect(state.stack).toHaveLength(batchSize);
    });

    it("the battle cry trigger is one of the abilities that batch", () => {
        // Guards the premise rather than restating it: the Evangelist's
        // keyword must actually produce an ATTACKERS_DECLARED ability, or the
        // position above would be an exalted-only test wearing its name.
        const def = getDefinition(SANGUINE_EVANGELIST_ID);
        const battleCry = def.triggeredAbilities?.find(
            (t) => t.id === "battle-cry"
        );
        expect(battleCry?.event).toBe("ATTACKERS_DECLARED");
    });
});
