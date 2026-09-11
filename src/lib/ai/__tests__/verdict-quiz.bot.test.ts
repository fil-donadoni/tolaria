// The quiz's lowering, judged by the ONE consumer that matters: the fit
// (issue #3405, PRD #3397, ADR 0124 §1).
//
// A verdict given in play is worth exactly as much as `evalPairsOf` can do with
// it months later, and that function rebuilds the position from the spec,
// re-enumerates, and matches the stored candidates BY KEY. Every plausible way
// of building this quiz — reading the candidates off the DecisionTrace, keying
// them by the live game's instance ids, lowering the wire projection instead of
// the bot's own reconstruction — produces a payload that renders perfectly and
// then fails at fit time as "candidate no longer enumerated", where nobody can
// still say what the judge meant.
//
// So these tests do not assert on the quiz's shape. They take what the quiz
// would submit, make the Verdict the mutation would store, and run the REAL
// pair builder over it.

import { describe, it, expect } from "vitest";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { candidateMoves } from "@convex/gre/ai/verdicts/candidates";
import { evalPairsOf } from "@convex/gre/ai/verdicts/evalPairs";
import type { Verdict } from "@convex/gre/ai/verdicts/types";
import { describeMove } from "@convex/gre/describeMove";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { Move } from "@convex/gre";
import { buildVerdictQuiz } from "../verdict-quiz";
import type { AiTraceSource } from "../trace-store";

const SEQ = 42;

/** The board a decision is taken on, and the wire projection of it the consult
 *  is handed — the two halves the trace store keeps. */
function position(spec: ScenarioSpec): {
    state: GameState;
    botId: string;
    source: AiTraceSource;
} {
    const state = buildBladeState({
        label: "verdict-quiz fixture",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const botId = state.players[0].id;
    return {
        state,
        botId,
        source: { state: projectPublicState(state, SEQ, botId), botId },
    };
}

/** A trace naming `chosen` as the move the search took. Only two of its fields
 *  are read by the lowering — `botId` and `chosen` — so the rest is the
 *  cheapest well-formed filling rather than a fake search result. */
function traceFor(state: GameState, botId: string, chosen: Move) {
    return {
        botId,
        chosen: describeMove(chosen, state),
        iterationsCompleted: 1,
        iterationsRequested: 1,
        elapsedMs: 1,
        stoppedBy: "iterations" as const,
        mechanism: "mean-reward" as const,
        candidates: [],
    };
}

const MAIN_PHASE: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

const DECLARE_ATTACKERS: ScenarioSpec = {
    cards: [
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "DECLARE_ATTACKERS",
    turn: 5,
    landCount: 0,
    libraryCount: 20,
};

/** The Verdict `verdicts.submit` would store from this quiz. */
function verdictOf(
    quiz: {
        spec: ScenarioSpec;
        candidates: { key: string; description: string }[];
    },
    rightIndex: number
): Verdict {
    return {
        id: "in-play-test",
        spec: quiz.spec,
        seat: "me",
        candidates: quiz.candidates,
        answer: { kind: "right", rightIndexes: [rightIndex] },
        author: "Tessa",
        createdAt: new Date(0).toISOString(),
        source: "in-play",
    };
}

describe("buildVerdictQuiz — a judgement the fit can still read (issue #3405)", () => {
    for (const [name, spec] of [
        ["a main-phase decision", MAIN_PHASE],
        ["a declare-attackers decision", DECLARE_ATTACKERS],
    ] as const) {
        it(`lowers ${name} into candidates the pair builder resolves`, () => {
            const { state, botId, source } = position(spec);
            const moves = candidateMoves(state, botId);
            expect(moves.length).toBeGreaterThan(1);
            const chosen = moves.find((m) => m.kind === "pass") ?? moves[0];

            const result = buildVerdictQuiz(
                traceFor(state, botId, chosen),
                source
            );
            expect(result.ok).toBe(true);
            if (!result.ok) return;
            const { quiz } = result;

            // The Bot's own move is one of the offered candidates, found
            // through the describer rather than through an id the rebuild
            // cannot have.
            expect(quiz.candidates[quiz.botPickIndex].description).toBe(
                describeMove(chosen, state)
            );

            // THE claim: the fit rebuilds this position and finds every
            // candidate the quiz named.
            const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
            expect(pairs.error).toBeUndefined();
            expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
        });
    }

    it("names a candidate list the mutation's own bounds accept", () => {
        // `verdicts.submit` refuses two candidates sharing a move key — a pair
        // built from them is permanently unsatisfiable. The enumerator cannot
        // produce one, and this is what says so about the list the quiz builds
        // rather than about the enumerator in the abstract.
        const { state, botId, source } = position(DECLARE_ATTACKERS);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const keys = result.quiz.candidates.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.every((key) => key.length > 0)).toBe(true);
    });

    it("refuses to build a quiz on a decision the lowering cannot preserve", () => {
        // A BLOCKING decision: attackers are already declared, and
        // `specFromState` can express combat only as an EMPTY
        // declare-attackers seed. The rebuilt board is therefore a different
        // position — it offers the defender "pass" and nothing else, and the
        // block the Bot actually declared is not in the list.
        //
        // This is the one failure of the whole flow that nothing downstream
        // could detect: the verdict it would produce rebuilds cleanly, its
        // candidate resolves, and the fit would happily learn from an answer
        // about a board the tester never saw. So it is refused HERE, where the
        // panel can still say why.
        const state = buildBladeState({
            label: "verdict-quiz mid-combat fixture",
            spec: DECLARE_ATTACKERS,
            setup: [{ kind: "declare-attackers", cards: ["Grizzly Bears"] }],
            bot: "opp",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const defenderId = state.players[1].id;
        const result = buildVerdictQuiz(
            traceFor(state, defenderId, candidateMoves(state, defenderId)[0]),
            {
                state: projectPublicState(state, SEQ, defenderId),
                botId: defenderId,
            }
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        // The rebuilt board leaves the defender "pass" and nothing else, which
        // the unconstraining guard catches first — the same refusal one step
        // earlier, and the reason both guards exist: either way no verdict is
        // written about a position nobody judged.
        expect(result.error).toContain("offers only one move");
    });
});
