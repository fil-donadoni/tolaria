/**
 * The tree walk and the rollout answer an own-hand put-back onto the library
 * (issue #10882).
 *
 * A Brainstorm-shaped put-back ("put two cards from your hand on top of your
 * library in any order", CR 401.4) is a MANDATORY `choose-hand-card` out of
 * the chooser's own hand with `putOnTop`. `handPickCandidates` makes no node
 * of it and `forcedChoiceAnswer` used to answer only discards, so
 * `advanceToDecision` stopped there and the line was scored mid-resolution,
 * on the root's turn with every drawn card still in hand, while every other
 * candidate's line was scored at the horizon. It is now answered with the
 * shed order: the least valuable cards go back.
 */

import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import { resolveTopOfStack } from "../../state";
import { enumerateMoves } from "../../moves";
import { advanceToDecision, applyMoveInSearch, rollout } from "../../search";
import { makeRng } from "../../rng";
import { buildPositionFromSpec } from "../blade/build";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import { forcedChoiceAnswer } from "../choiceCandidates";

/** Jace's 0 (Brainstorm) activated and resolved up to its put-back, with a
 *  Serra Angel already in hand: the state the walk used to score as a leaf. */
function midBrainstorm(): GameState {
    const s = buildPositionFromSpec({
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        cards: [
            {
                name: "Jace, the Mind Sculptor",
                owner: "me",
                zone: "battlefield",
                counters: { loyalty: 3 },
            },
            { name: "Serra Angel", owner: "me", zone: "hand" },
        ],
    });
    const me = s.activePlayerId;
    const zero = enumerateMoves(s, me).find(
        (m) =>
            m.kind === "activate-ability" &&
            m.abilityId === "jace-the-mind-sculptor-zero"
    );
    if (!zero) throw new Error("no Jace 0 activation");
    applyMoveInSearch(s, me, zero);
    resolveTopOfStack(s);
    return s;
}

describe("forcedChoiceAnswer — an own-hand library-top put-back (issue #10882)", () => {
    it("the put-back is pending and now has a forced answer", () => {
        const mid = midBrainstorm();
        const head = mid.pendingChoices?.[0];
        expect(head?.kind).toBe("choose-hand-card");
        expect(head?.putOnTop).toBe(true);
        const answer = forcedChoiceAnswer(mid, head!);
        expect(answer?.kind).toBe("resolution-choice");
    });

    it("a life-priced put-back (Sylvan Library's `ranged-topdeck`) stays unanswered", () => {
        const mid = midBrainstorm();
        const head = { ...mid.pendingChoices![0]!, choiceId: "ranged-topdeck" };
        expect(forcedChoiceAnswer(mid, head)).toBeNull();
    });

    it("the walk finishes the resolution: the answered cards go on top", () => {
        const mid = midBrainstorm();
        const me = mid.activePlayerId;
        const answer = forcedChoiceAnswer(mid, mid.pendingChoices![0]!);
        const back =
            answer?.kind === "resolution-choice"
                ? (answer.cardInstanceIds ?? [])
                : [];
        expect(back).toHaveLength(2);
        const handBefore = mid.players.find((p) => p.id === me)!.hand.length;
        expect(advanceToDecision(mid)).toBe(me);
        expect(mid.pendingChoices?.length ?? 0).toBe(0);
        expect(mid.stack).toHaveLength(0);
        const player = mid.players.find((p) => p.id === me)!;
        expect(player.hand).toHaveLength(handBefore - 2);
        expect(
            player.library
                .slice(0, 2)
                .map((c) => c.id)
                .sort()
        ).toEqual([...back].sort());
    });

    it("a rollout started mid-Brainstorm reaches the horizon, no choice pending", () => {
        const mid = midBrainstorm();
        const me = mid.activePlayerId;
        const turn = mid.turn;
        rollout(mid, me, makeRng(1), DEFAULT_EVAL_WEIGHTS);
        expect(mid.pendingChoices?.length ?? 0).toBe(0);
        expect(mid.turn).toBeGreaterThan(turn);
    });
});
