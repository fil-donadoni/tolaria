// The search's multi-block pricing and its opponent model (issue #5951).
//
// `bun run cr 510.1c`: "If two or more creatures are blocking it, it assigns
// its combat damage to those creatures divided as its controller chooses among
// them." The search used to deal such an attacker's damage as nothing
// (`buildAutoDamageAssignments` omits it), so a multi-block was free for the
// defender. `searchCombatDamageAssignments` deals the driver's split instead,
// and `pruneDominatedBlocks` keeps the defender's node from exploring the
// multi-blocks that only feed the attacker a creature.

import { describe, it, expect } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../../cards/__tests__/setup.helper";
import { hillGiant } from "../../../cards/sets/lea/red.cards";
import {
    crawWurm,
    giantSpider,
    grizzlyBears,
    ironrootTreefolk,
} from "../../../cards/sets/lea/green.cards";
import { hypnoticSpecter } from "../../../cards/sets/lea/black.cards";
import { suChi } from "../../../cards/sets/atq/colorless.cards";
import type { CardInstanceState, GameState } from "../../state";
import { enumerateBlockerMoves, type Move } from "../../moves";
import { resolveCombatDamage } from "../../applyMove";
import { findPermanent } from "../../lookup";
import { searchCombatDamageAssignments } from "../damageSplit";
import { pruneDominatedBlocks } from "../blockDominance";

function permanent(
    defId: string,
    id: string,
    controllerId: string
): CardInstanceState {
    return makeInstance(defId, {
        id,
        controllerId,
        ownerId: controllerId,
        isSummoningSick: false,
    });
}

/** p1 has declared `attacker`; p2 holds `blockers`, blocks not yet declared. */
function declareBlockersStep(
    attacker: CardInstanceState,
    blockers: CardInstanceState[]
): GameState {
    return makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        players: [
            makePlayer("p1", {
                battlefield: [{ ...attacker, isAttacking: true }],
            }),
            makePlayer("p2", { battlefield: blockers }),
        ],
        combat: {
            attackerIds: [attacker.id],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            blockedAttackerIds: [],
        },
    });
}

/** Each declare-blockers move as a sorted "blocker>attacker" key. */
function blockKeys(moves: readonly Move[]): string[] {
    return moves
        .filter(
            (m): m is Extract<Move, { kind: "declare-blockers" }> =>
                m.kind === "declare-blockers"
        )
        .map((m) =>
            m.assignments
                .map((a) => a.blockerId)
                .sort()
                .join("+")
        )
        .sort();
}

function blocksFor(state: GameState): Move[] {
    return enumerateBlockerMoves(state, state.players[1]);
}

/** Applies `blockers` all blocking the lone attacker, as the search does. */
function withBlocks(state: GameState, blockerIds: string[]): GameState {
    const attackerId = state.combat!.attackerIds[0];
    state.combat!.blockerAssignments = Object.fromEntries(
        blockerIds.map((id) => [id, [attackerId]])
    );
    for (const id of blockerIds) findPermanent(state, id)!.isBlocking = true;
    state.combat!.blockersConfirmed = true;
    state.combat!.blockedAttackerIds = [attackerId];
    return state;
}

describe("searchCombatDamageAssignments — CR 510.1c in the search", () => {
    it("deals a double-blocked 6/4 its 3 + 3 split: both 3/3s die with it", () => {
        const state = withBlocks(
            declareBlockersStep(permanent(crawWurm().id, "wurm", "p1"), [
                permanent(hillGiant().id, "g1", "p2"),
                permanent(hillGiant().id, "g2", "p2"),
            ]),
            ["g1", "g2"]
        );
        expect(searchCombatDamageAssignments(state, "regular").wurm).toEqual({
            g1: 3,
            g2: 3,
        });
        resolveCombatDamage(state);
        expect(findPermanent(state, "g1")).toBeUndefined();
        expect(findPermanent(state, "g2")).toBeUndefined();
        expect(findPermanent(state, "wurm")).toBeUndefined();
    });
});

describe("pruneDominatedBlocks — the defender's node", () => {
    it("drops every multi-block that only feeds a 3/5 a creature", () => {
        // Ironroot Treefolk (3/5): no pair of these blockers deals it 5, and
        // its 3 kills the Specter (2/2) whichever pair holds it.
        const state = declareBlockersStep(
            permanent(ironrootTreefolk().id, "tree", "p1"),
            [
                permanent(giantSpider().id, "spider", "p2"),
                permanent(hypnoticSpecter().id, "specter", "p2"),
            ]
        );
        const all = blocksFor(state);
        expect(blockKeys(all)).toEqual([
            "",
            "specter",
            "specter+spider",
            "spider",
        ]);
        expect(blockKeys(pruneDominatedBlocks(state, all))).toEqual([
            "",
            "specter",
            "spider",
        ]);
    });

    it("keeps a double block that kills an attacker no single block kills", () => {
        // Hill Giant (3/3) into two Grizzly Bears (2/2): only the pair deals 3.
        const state = declareBlockersStep(
            permanent(hillGiant().id, "giant", "p1"),
            [
                permanent(grizzlyBears().id, "b1", "p2"),
                permanent(grizzlyBears().id, "b2", "p2"),
            ]
        );
        const all = blocksFor(state);
        expect(blockKeys(pruneDominatedBlocks(state, all))).toEqual(
            blockKeys(all)
        );
    });

    it("keeps a multi-block whose combat damage puts a dies trigger on the stack", () => {
        // Craw Wurm (6/4) into Su-Chi (4/4) + Grizzly Bears: the 6 kills both
        // and the Wurm dies either way, so Su-Chi alone would dominate on the
        // board — but Su-Chi's dies trigger is still on the stack when the
        // probe reads it, so the pair is never judged (fail closed).
        const state = declareBlockersStep(
            permanent(crawWurm().id, "wurm", "p1"),
            [
                permanent(suChi().id, "suchi", "p2"),
                permanent(grizzlyBears().id, "bears", "p2"),
            ]
        );
        const all = blocksFor(state);
        expect(blockKeys(pruneDominatedBlocks(state, all))).toContain(
            "bears+suchi"
        );
    });

    it("leaves a list with no multi-block untouched", () => {
        const state = declareBlockersStep(
            permanent(hillGiant().id, "giant", "p1"),
            [permanent(grizzlyBears().id, "b1", "p2")]
        );
        const all = blocksFor(state);
        expect(pruneDominatedBlocks(state, all)).toEqual(all);
    });
});
