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

/** CR 307.1 (issue #3454) — the judged seat holding priority on the OPPONENT's
 *  turn, with one instant it can actually pay for and one creature it cannot
 *  cast. The class the quiz used to refuse outright, and the one PRD #3397
 *  exists for: holding up removal instead of acting. */
const RESPONDING_ON_OPPONENTS_TURN: ScenarioSpec = {
    cards: [
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "opp", zone: "battlefield" },
        { name: "Lightning Bolt", owner: "opp", zone: "hand" },
        // The sorcery-speed half the rebuild must NOT be able to offer: a land
        // to play (CR 305.1) and a creature to cast (CR 302.1). Without them
        // the two candidate lists coincide and the comparison below proves
        // nothing — a rebuild that lost the turn holder passes for free.
        { name: "Mountain", owner: "opp", zone: "hand" },
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

    it("judges a decision taken with priority on the opponent's turn (CR 307.1, issue #3454)", () => {
        // This used to be a REFUSAL: the spec had no field for the turn holder,
        // so the rebuild came back as the Bot's own turn — a strictly larger,
        // sorcery-speed candidate list — and "pass" being in both lists meant
        // the pick still resolved and the verdict answered a question nobody
        // asked. `activePlayer` / `priority` / `passCount` (issue #3454) carry
        // the fact, and the candidate-list comparison inside the quiz is what
        // proves it: a turn holder that failed to survive the lowering shows up
        // there as sorcery-speed moves the live list never had.
        const state = buildBladeState({
            label: "verdict-quiz opponent-turn fixture",
            spec: RESPONDING_ON_OPPONENTS_TURN,
            setup: [{ kind: "pass" }],
            bot: "opp",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [] },
        });
        const respondingSeat = state.players[1].id;
        // The position really is the one under test: the opponent holds the
        // turn, the judged seat holds priority with a pass already banked.
        expect(state.activePlayerId).toBe(state.players[0].id);
        expect(state.priorityPlayerId).toBe(respondingSeat);
        expect(state.passCount).toBe(1);

        const moves = candidateMoves(state, respondingSeat);
        expect(moves.length).toBeGreaterThan(1);
        const chosen = moves.find((m) => m.kind === "pass") ?? moves[0];

        const result = buildVerdictQuiz(
            traceFor(state, respondingSeat, chosen),
            {
                state: projectPublicState(state, SEQ, respondingSeat),
                botId: respondingSeat,
            }
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { quiz } = result;

        // Lowered in the judged seat's own frame: it is "me", the turn holder
        // is "opp", and the banked pass came with it.
        expect(quiz.spec.activePlayer).toBe("opp");
        expect(quiz.spec.priority).toBe("me");
        expect(quiz.spec.passCount).toBe(1);
        // Neither fact is reported as a loss any more.
        expect(
            quiz.dropped.some((note) => /^(active player|priority:)/.test(note))
        ).toBe(false);

        // THE claim: the fit rebuilds this position and resolves every
        // candidate the quiz named.
        expect(quiz.candidates[quiz.botPickIndex].description).toBe(
            describeMove(chosen, state)
        );
        const pairs = evalPairsOf(verdictOf(quiz, quiz.botPickIndex));
        expect(pairs.error).toBeUndefined();
        expect(pairs.pairs.length).toBe(quiz.candidates.length - 1);
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
