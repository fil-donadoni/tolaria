// Bot reachability for Level Up (CR 702.87, issue #2386) — the three seams a
// new mechanic owes (`.claude/rules/gre-development.md` § Bot reachability):
//
//   1. REACHABLE?  `enumerateMoves` must offer the activation, and must offer
//      it ONLY at CR 307.5 sorcery timing (`sorcerySpeedOnly`). Nothing
//      catalogue-wide guards this seam — a mechanic missing from the
//      enumerator reds no suite, the Bot simply never plays the card.
//   2. ANSWERABLE?  Level up raises no choice at all (no targets, no modes),
//      so there is nothing for `CHOICE_CANDIDATE_GENERATORS` to answer and no
//      freeze to guard against. Asserted here as the enumerated move's own
//      empty `targets`, so the claim is checked rather than declared.
//   3. WANTED?  The `counters` Op valuer must not score the activation at
//      zero — a `"neutral"` sign is what makes a reachable move one the search
//      never prefers.
//
// Plus the full-path row: the enumerated move, executed through the REAL
// `activateAbilityOnState` (`convex/game.ts`), actually puts the counter on.

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

const HEXDRINKER = "89f5cc05-5d9d-4709-b3c5-a6249c294acc";
const FOREST = getCardByName("Forest").id;

/** Hexdrinker plus one untapped Forest under p1, at `phase`. */
function board(phase: GameState["phase"] = "PRECOMBAT_MAIN"): {
    state: GameState;
    hex: CardInstanceState;
} {
    const hex = makeInstance(HEXDRINKER, {
        id: "hex",
        controllerId: "p1",
        ownerId: "p1",
    });
    const forest = makeInstance(FOREST, {
        id: "forest",
        controllerId: "p1",
        ownerId: "p1",
    });
    const state = makeState({
        phase,
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [
            makePlayer("p1", { battlefield: [hex, forest] }),
            makePlayer("p2"),
        ],
    });
    for (const card of state.players[0].battlefield) {
        beginApplyingStaticEffects(state, card);
    }
    return { state, hex: state.players[0].battlefield[0] };
}

function levelUpMoves(
    state: GameState
): Extract<Move, { kind: "activate-ability" }>[] {
    return enumerateMoves(state, "p1").filter(
        (m): m is Extract<Move, { kind: "activate-ability" }> =>
            m.kind === "activate-ability" && m.abilityId === "level-up"
    );
}

describe("Level Up — Bot reachability (CR 702.87)", () => {
    it("seam 1 — the activation is enumerated at sorcery timing", () => {
        const moves = levelUpMoves(board().state);
        expect(moves).toHaveLength(1);
        expect(moves[0].cardInstanceId).toBe("hex");
    });

    it("seam 1 — CR 602.5d / 307.5: it is NOT enumerated outside sorcery timing", () => {
        expect(levelUpMoves(board("DECLARE_ATTACKERS").state)).toHaveLength(0);
        // A non-empty stack is the other half of the CR 307.5 template.
        const { state, hex } = board();
        state.stack.push({
            ...hex,
            zone: "stack",
            castById: "p1",
            abilityId: "level-up",
            targets: [],
        });
        expect(levelUpMoves(state)).toHaveLength(0);
    });

    it("seam 2 — the move raises no choice for the Bot to answer", () => {
        const [move] = levelUpMoves(board().state);
        expect(move.targets).toEqual([]);
        expect(move.chosenModeId).toBeUndefined();
    });

    it("seam 3 — the script value is positive, not a neutral score", () => {
        expect(
            dslAbilityScriptValue(getDefinition(HEXDRINKER))
        ).toBeGreaterThan(0);
    });

    it("full path — the enumerated move, run through activateAbilityOnState, lands the counter", () => {
        const { state, hex } = board();
        const [move] = levelUpMoves(state);
        const ability = getDefinition(HEXDRINKER).activatedAbilities![0];
        // The exact helper the `activateAbility` mutation calls to compute the
        // cost it then checks against the activator's pool: {1} generic.
        expect(resolveAbilityManaCost(state, hex, ability)).toEqual({ X: 1 });

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
            state.players[0].battlefield.find((c) => c.id === "hex")?.counters
                ?.level
        ).toBe(1);
    });
});
