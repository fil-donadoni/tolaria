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
import {
    makeMutationCtx,
    runMutation,
} from "@convex/__tests__/gameMutationHarness";
import { submit } from "@convex/verdicts";
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

/** The ordinary case, and the one every fixture here used to miss: the human
 *  is holding cards. The projection gives their hand as `null` per card, and
 *  the adapter rebuilds it as opaque placeholders — which is what the lowering
 *  meets in every real game. */
const OPPONENT_HOLDS_CARDS: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "hand" },
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

    it("judges a position where the opponent is holding cards", () => {
        // The hidden hand has no identity to lower, so it is dropped and SAID —
        // never invented, and never a thrown error that would make the quiz
        // refuse every decision in every real game.
        const { state, botId, source } = position(OPPONENT_HOLDS_CARDS);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(
            result.quiz.dropped.some((note) => /hand: 2 card\(s\)/.test(note))
        ).toBe(true);
        expect(evalPairsOf(verdictOf(result.quiz, 0)).error).toBeUndefined();
    });

    it("refuses a decision taken with priority on the opponent's turn", () => {
        // The rebuild has no field for the turn holder, so it would come back
        // as the BOT's turn — a strictly larger, sorcery-speed candidate list.
        // "pass" is in both, so the Bot's own pick would still resolve and the
        // verdict would answer a question nobody asked.
        const state = buildBladeState({
            label: "verdict-quiz opponent-turn fixture",
            spec: OPPONENT_HOLDS_CARDS,
            setup: [{ kind: "pass" }],
            bot: "opp",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const respondingSeat = state.players[1].id;
        const result = buildVerdictQuiz(
            traceFor(
                state,
                respondingSeat,
                candidateMoves(state, respondingSeat)[0]
            ),
            {
                state: projectPublicState(state, SEQ, respondingSeat),
                botId: respondingSeat,
            }
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("opponent's turn");
    });

    it("submits through the REAL mutation, which validates what it stores", async () => {
        // The door the quiz's payload actually has to pass: index bounds,
        // duplicate move keys, and every card name in the position resolving
        // against the engine's own vocabulary. A quiz that produced a name the
        // catalogue cannot place would fail HERE, at the tester's gesture, and
        // this is what says it does not.
        const { state, botId, source } = position(OPPONENT_HOLDS_CARDS);
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            source
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        const { ctx, doc } = makeMutationCtx("u-tester", [
            {
                _id: "u-tester",
                __table: "users",
                nickname: "Tessa",
                isTester: true,
            },
        ]);
        const id = await runMutation<Record<string, unknown>, string>(
            submit,
            ctx,
            {
                spec: quiz.spec,
                seat: "me",
                candidates: quiz.candidates,
                answer: { kind: "right", rightIndexes: [quiz.botPickIndex] },
                botPickIndex: quiz.botPickIndex,
            }
        );
        expect(doc(id).candidates).toEqual(quiz.candidates);
    });

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

    it("refuses a decision taken with a spell on the stack", () => {
        // A decision taken with a SPELL ON THE STACK, on the Bot's own turn —
        // the ordinary "do I hold up anything else?" window. The lowering
        // cannot express a stack, so the rebuild is the same board with the
        // Bolt simply gone: a quiet position where nothing is about to die.
        // Every other guard passes (the Bot's own move is there, the list
        // survives), which is exactly why this one exists.
        const state = buildBladeState({
            label: "verdict-quiz spell-on-stack fixture",
            spec: {
                cards: [
                    { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
                    { name: "Mountain", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "opp", zone: "battlefield" },
                    { name: "Lightning Bolt", owner: "opp", zone: "hand" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                landCount: 0,
                libraryCount: 20,
            },
            // The opponent Bolts the Bot's creature in the Bot's own main
            // phase; priority comes back to the Bot with the spell still on the
            // stack — "do I answer this?", the commonest window there is.
            setup: [
                // The Bot passes with an empty stack, which is what hands the
                // opponent the window to cast into.
                { kind: "pass", seat: "me" },
                {
                    kind: "cast",
                    card: "Lightning Bolt",
                    by: "opp",
                    target: "Grizzly Bears",
                },
            ],
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const botId = state.players[0].id;
        const result = buildVerdictQuiz(
            traceFor(state, botId, candidateMoves(state, botId)[0]),
            { state: projectPublicState(state, SEQ, botId), botId }
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("on the stack");
    });
});
