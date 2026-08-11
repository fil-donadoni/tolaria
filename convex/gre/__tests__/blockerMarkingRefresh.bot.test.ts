// The BOT's two block-simulation paths must see an `isBlocking`-conditioned
// keyword grant (issue #1826 review, finding 2).
//
// Same defect as the server side (see the sibling
// `blockerMarkingRefresh.test.ts` header for the full mechanism): a
// `keyword-grant` with a `condition` is MATERIALIZED into `staticAbilities`,
// so a condition reading `isBlocking` is stale from the flag write until the
// next refresh. Both bot sims used to write the flag by hand:
//
//   - `applyMoveInSearch` (`gre/search.ts`, the ISMCTS `declare-blockers`
//     case) marked blockers and then called `drainAutoPasses` BEFORE its
//     `checkStateBasedActions` — the same mark → drain → refresh order the
//     `confirmBlockers` mutation had, so the search mis-simulated the CR 510.4
//     first-strike-step skip;
//   - `applyBlockAssignments` (`gre/applyMove.ts`, the 1-ply greedy probe)
//     marked blockers and handed the state straight to `resolveCombatDamage` /
//     `evaluate` with NO refresh at all — this path never runs an SBA pass
//     before the damage it is valuing, so the bot valued every block against
//     a blocker that could not have first strike.
//
// Both now route through `markDeclaredBlockers` (`gre/combat.ts`).
//
// Fixture is the 2/2-vs-2/2 symmetry the server suite uses: the attacker dies
// alone iff the granted first strike is visible, and both trade if it is not.
import { describe, it, expect } from "vitest";
import { applyMoveInSearch } from "../search";
import { applyMoveForSearch } from "../applyMove";
import type { Move } from "../moves";
import { applySourceStaticEffects } from "../state";
import type { CardInstanceState, GameState } from "../state";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { vanilla, snowLand } from "../../cards/sets/ice/__tests__/helpers";
import { snowDevil, snowCoveredIsland } from "../../cards/sets/ice";
import { island } from "../../cards/sets/lea";

function libraryFor(playerId: string): CardInstanceState[] {
    return [1, 2].map((n) =>
        makeInstance(island.id, {
            id: `${playerId}-lib-${n}`,
            controllerId: playerId,
            ownerId: playerId,
            zone: "library",
        })
    );
}

/** p1 (active) attacks with a 2/2; p2's 2/2 wears Snow Devil and p2 controls a
 *  Snow-Covered Island, so the blocker gains first strike the instant it is
 *  marked as blocking. `blockerAssignments` is left EMPTY — the move under
 *  test is what declares the block. */
function makeCombatState(): {
    state: GameState;
    blocker: CardInstanceState;
} {
    const attacker = vanilla("bear", 2, 2, {
        controllerId: "p1",
        ownerId: "p1",
        isAttacking: true,
    });
    const blocker = vanilla("wall", 2, 2, {
        controllerId: "p2",
        ownerId: "p2",
    });
    const aura = makeInstance(snowDevil.id, {
        id: "devil",
        controllerId: "p2",
        ownerId: "p2",
        attachedTo: "wall",
    });
    const state = makeState({
        phase: "DECLARE_BLOCKERS",
        activePlayerId: "p1",
        priorityPlayerId: "p2",
        combat: {
            attackerIds: ["bear"],
            confirmed: true,
            blockerAssignments: {},
            blockersConfirmed: false,
            damageConfirmed: false,
        },
        players: [
            makePlayer("p1", {
                battlefield: [attacker],
                library: libraryFor("p1"),
            }),
            makePlayer("p2", {
                battlefield: [
                    blocker,
                    aura,
                    snowLand(snowCoveredIsland.id, "snow-isle", "p2"),
                ],
                library: libraryFor("p2"),
            }),
        ],
    });
    applySourceStaticEffects(state, aura);
    expect(blocker.staticAbilities).not.toContain("first strike");
    return { state, blocker };
}

const BLOCK_MOVE: Move = {
    kind: "declare-blockers",
    assignments: [{ blockerId: "wall", attackerId: "bear" }],
} as Move;

describe("ISMCTS block simulation sees an isBlocking-conditioned grant (CR 611.2c / 510.4, issue #1826)", () => {
    it("applyMoveInSearch materializes the grant before draining auto-passes, so the simulated combat runs the first-strike step", () => {
        const { state } = makeCombatState();
        state.autoPassPlayers = ["p1", "p2"];

        // The drain runs the rest of the turn, so `isBlocking` is already
        // cleared (END_OF_COMBAT) by the time this returns — the surviving
        // board is the observable.
        applyMoveInSearch(state, "p2", BLOCK_MOVE);

        const p1 = state.players.find((p) => p.id === "p1")!;
        const p2 = state.players.find((p) => p.id === "p2")!;
        // Pre-fix the drain reached the CR 510.4 skip check with stale
        // `staticAbilities`, FIRST_STRIKE_DAMAGE was skipped, and both 2/2s
        // traded — so the search scored a blocker-loss line that cannot happen.
        expect(p2.battlefield.map((c) => c.id).sort()).toEqual([
            "devil",
            "snow-isle",
            "wall",
        ]);
        expect(p1.battlefield.map((c) => c.id)).toEqual([]);
        expect(p1.graveyard.map((c) => c.id)).toContain("bear");
    });
});

describe("1-ply greedy block probe sees an isBlocking-conditioned grant (CR 611.2c / 510.4, issue #1826)", () => {
    it("applyMoveForSearch materializes the grant before resolveCombatDamage, so the probe values the block with first strike", () => {
        const { state } = makeCombatState();

        // No auto-pass here: this path resolves combat damage directly, with
        // no `advancePhase` and no SBA pass before the first-strike step it
        // builds assignments for — so the marking is the ONLY chance to
        // refresh.
        const next = applyMoveForSearch(state, "p2", BLOCK_MOVE);

        const p1 = next.players.find((p) => p.id === "p1")!;
        const p2 = next.players.find((p) => p.id === "p2")!;
        expect(p2.battlefield.map((c) => c.id).sort()).toEqual([
            "devil",
            "snow-isle",
            "wall",
        ]);
        expect(p1.battlefield.map((c) => c.id)).toEqual([]);
        expect(p1.graveyard.map((c) => c.id)).toContain("bear");

        // Pure: the caller's state is untouched (the probe clones).
        expect(
            state.players.find((p) => p.id === "p1")!.battlefield
        ).toHaveLength(1);
    });
});
