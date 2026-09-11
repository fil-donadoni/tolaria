// Bot reachability for Class cards (CR 716, issue #3234) — the three seams a
// new mechanic owes (`.claude/rules/gre-development.md` § Bot reachability):
//
//   1. REACHABLE?  `enumerateMoves` must offer the class level bar, must offer
//      ONLY the one CR 716.2a admits (the bar for level+1), and must stop
//      offering it outside CR 307.5 sorcery timing. This is the seam the whole
//      mechanic was shaped around: `enumerateAbilityMoves` SKIPS any ability
//      carrying a `canActivate` closure, so a closure-gated level bar would be
//      a move the Bot could never make — and nothing catalogue-wide would say
//      so. The gate is declarative (`classLevelBar`) precisely so this test
//      can be green.
//   2. ANSWERABLE?  The bar itself raises no choice (no targets, no modes), so
//      there is nothing for `CHOICE_CANDIDATE_GENERATORS` to answer. Its
//      "becomes level 2" trigger DOES target, through the shipped CR 603.3d
//      trigger-target machinery — the same path every other targeted trigger
//      uses, with no new PendingChoice kind.
//   3. WANTED?  The `setLevel` Op valuer must not score the activation at zero:
//      a zero ties the level-up against passing inside the outcome epsilon and
//      the pick falls to rollout noise.
//
// Plus the full-path row: the enumerated move, executed through the REAL
// `activateAbilityOnState` (`convex/game.ts`), actually raises the level.

import { describe, expect, it } from "vitest";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup";
import { getCardByName } from "../../cards";
import { getDefinition } from "../../cards/index";
import type { CardInstanceState, GameState } from "../state";
import {
    beginApplyingStaticEffects,
    getBasicLandMana,
    resolveTopOfStack,
} from "../state";
import { enumerateMoves, type Move } from "../moves";
import { dslAbilityScriptValue } from "../ai/cardScriptValue";
import { activateAbilityOnState, resolveAbilityManaCost } from "../../game";

const TALENT = "a36e682d-b43d-4e08-bf5b-70d7e924dbe5";
const ISLAND = getCardByName("Island").id;

/** Stormchaser's Talent at `classLevel`, plus `islands` untapped Islands under
 *  p1, at `phase`. */
function board(opts: {
    classLevel?: number;
    islands?: number;
    phase?: GameState["phase"];
}): { state: GameState; talent: CardInstanceState } {
    const talent = makeInstance(TALENT, {
        id: "talent",
        controllerId: "p1",
        ownerId: "p1",
        ...(opts.classLevel === undefined
            ? {}
            : { classLevel: opts.classLevel }),
    });
    const lands = Array.from({ length: opts.islands ?? 0 }, (_, i) =>
        makeInstance(ISLAND, {
            id: `island-${i}`,
            controllerId: "p1",
            ownerId: "p1",
        })
    );
    const state = makeState({
        phase: opts.phase ?? "PRECOMBAT_MAIN",
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [talent, ...lands] }),
            makePlayer("p2"),
        ],
    });
    for (const card of state.players[0].battlefield) {
        beginApplyingStaticEffects(state, card);
    }
    return { state, talent: state.players[0].battlefield[0] };
}

function barMoves(
    state: GameState
): Extract<Move, { kind: "activate-ability" }>[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" &&
            m.abilityId.startsWith("class-level-")
    );
}

describe("Class level bars — Bot reachability (CR 716.2a)", () => {
    it("seam 1 — at level 1 the level-2 bar is enumerated, and it is the ONLY one", () => {
        const moves = barMoves(board({ islands: 4 }).state);
        expect(moves.map((m) => m.abilityId)).toEqual(["class-level-2"]);
        expect(moves[0].cardInstanceId).toBe("talent");
    });

    it("seam 1 — at level 2 the level-2 bar is gone and the level-3 bar opens", () => {
        const moves = barMoves(board({ classLevel: 2, islands: 6 }).state);
        expect(moves.map((m) => m.abilityId)).toEqual(["class-level-3"]);
    });

    it("seam 1 — at the top level no bar is offered at all", () => {
        expect(barMoves(board({ classLevel: 3, islands: 6 }).state)).toEqual(
            []
        );
    });

    it("seam 1 — CR 602.5d / 307.5: not enumerated outside sorcery timing", () => {
        expect(
            barMoves(board({ islands: 4, phase: "DECLARE_ATTACKERS" }).state)
        ).toHaveLength(0);
        // A non-empty stack is the other half of the CR 307.5 template.
        const { state, talent } = board({ islands: 4 });
        state.stack.push({
            ...talent,
            zone: "stack",
            castById: "p1",
            abilityId: "class-level-2",
            targets: [],
        });
        expect(barMoves(state)).toHaveLength(0);
    });

    it("seam 2 — the bar raises no choice for the Bot to answer", () => {
        const [move] = barMoves(board({ islands: 4 }).state);
        expect(move.targets).toEqual([]);
        expect(move.chosenModeId).toBeUndefined();
    });

    it("seam 3 — the card's ability script values above zero, not neutral", () => {
        expect(dslAbilityScriptValue(getDefinition(TALENT))).toBeGreaterThan(0);
    });

    it("full path — the enumerated move, run through activateAbilityOnState, raises the level", () => {
        const { state, talent } = board({ islands: 4 });
        const [move] = barMoves(state);
        const ability = getDefinition(TALENT).activatedAbilities!.find(
            (a) => a.id === "class-level-2"
        )!;
        // The exact helper the `activateAbility` mutation calls to compute the
        // cost it then checks against the activator's pool: {3}{U}.
        expect(resolveAbilityManaCost(state, talent, ability)).toEqual({
            X: 3,
            U: 1,
        });

        // Execute the move's own tapPlan, exactly as the executor does.
        const player = state.players[0];
        for (const tap of move.tapPlan) {
            const source = player.battlefield.find(
                (c) => c.id === tap.cardInstanceId
            )!;
            const color = getBasicLandMana(source)!;
            source.isTapped = true;
            player.manaPool[color] = (player.manaPool[color] ?? 0) + 1;
        }
        activateAbilityOnState(state, {
            playerId: "p1",
            cardInstanceId: move.cardInstanceId,
            abilityId: move.abilityId,
            keepPriority: true,
        });
        expect(state.stack).toHaveLength(1);
        resolveTopOfStack(state);
        expect(
            state.players[0].battlefield.find((c) => c.id === "talent")
                ?.classLevel
        ).toBe(2);
    });
});
