// The verdict quiz, from the box to the mutation (issue #3405, PRD #3397).
//
// Driven through the SURFACE a tester uses: the decision ring the driver
// pushes into, the box that renders it, the buttons, and the Convex mutation
// mocked at the client boundary — nothing hand-built in between. The positions
// are real (the blade builder), and they reach the store the way they reach it
// in play: as the WIRE PROJECTION (`projectPublicState`), because that is all
// the main thread ever holds and a quiz built from a hand-made `GameState`
// would prove nothing about the path that exists.
//
// Two decisions, because PRD #3397 names both: an ordinary main-phase pass and
// a combat declaration.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";

const submitVerdict = vi.fn(async () => "verdict-1");
let currentUser: {
    nickname: string;
    isAdmin?: boolean;
    isTester?: boolean;
} | null = { nickname: "Tessa", isTester: true };

vi.mock("convex/react", () => ({
    useMutation: () => submitVerdict,
    useQuery: () => currentUser,
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: "users:currentUser" },
        verdicts: { submit: "verdicts:submit" },
    },
}));
vi.mock("~/lib/session", () => ({
    getStoredSession: () => ({ gameId: "game-7", playerId: "p1" }),
}));

import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { candidateMoves } from "@convex/gre/ai/verdicts/candidates";
import { describeMove } from "@convex/gre/describeMove";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type {
    CandidateTrace,
    DecisionTrace,
    EvalTerms,
    Move,
} from "@convex/gre";
import type { GameState } from "@convex/gre/state";
import { pushAiTrace, clearAiTraces } from "~/lib/ai/trace-store";
import AiDecisionTrace from "../ai-decision-trace";

const SEQ = 4242;

const ZERO_TERMS: EvalTerms = {
    life: 0,
    hand: 0,
    creatures: 0,
    permanents: 0,
    mana: 0,
    manaDevelopment: 0,
    flexibility: 0,
    library: 0,
    graveyard: 0,
    graveyardReach: 0,
};

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

function candidateTrace(label: string, move: Move): CandidateTrace {
    return {
        label,
        move,
        visits: 10,
        meanReward: 0.5,
        meanMargin: 0,
        avail: 10,
        eval: {
            self: ZERO_TERMS,
            opp: ZERO_TERMS,
            margin: 0,
            danger: 0,
            total: 0,
        },
    };
}

/** Push one decision on a real position, exactly as the driver does: the trace
 *  plus the consult's own inputs. Returns what the decision was, in words. */
function pushDecision(
    spec: ScenarioSpec,
    pick: (moves: Move[]) => Move
): { state: GameState; botId: string; chosen: string } {
    const state = buildBladeState({
        label: "verdict-quiz surface fixture",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const botId = state.players[0].id;
    const moves = candidateMoves(state, botId);
    const chosenMove = pick(moves);
    const chosen = describeMove(chosenMove, state);
    const trace: DecisionTrace = {
        botId,
        chosen,
        iterationsCompleted: 10,
        iterationsRequested: 10,
        elapsedMs: 5,
        stoppedBy: "iterations",
        mechanism: "mean-reward",
        candidates: moves.map((move) =>
            candidateTrace(describeMove(move, state), move)
        ),
    };
    pushAiTrace(trace, "worker", {
        state: projectPublicState(state, SEQ, botId),
        botId,
    });
    return { state, botId, chosen };
}

async function openQuiz() {
    fireEvent.click(screen.getByRole("button", { name: "Judge this move" }));
    await screen.findByText("Which move was right here?");
}

function lastSubmission() {
    const call = submitVerdict.mock.calls.at(-1) as unknown as [
        {
            spec: ScenarioSpec;
            seat: string;
            candidates: { key: string; description: string }[];
            answer: { kind: string; rightIndexes: number[] };
            botPickIndex: number;
            gameId?: string;
            seq?: number;
        },
    ];
    return call[0];
}

beforeEach(() => {
    cleanup();
    clearAiTraces();
    submitVerdict.mockClear();
    currentUser = { nickname: "Tessa", isTester: true };
});

describe("the verdict quiz, from the decision box (issue #3405)", () => {
    it("submits a pass decision as a Verdict naming the Bot's own candidate", async () => {
        const { chosen } = pushDecision(
            MAIN_PHASE,
            (moves) => moves.find((m) => m.kind === "pass") ?? moves[0]
        );
        expect(chosen).toBe("pass");
        render(<AiDecisionTrace />);
        await openQuiz();

        fireEvent.click(
            screen.getByRole("button", { name: "The Bot was right" })
        );
        await waitFor(() => expect(submitVerdict).toHaveBeenCalledTimes(1));

        const args = lastSubmission();
        expect(args.seat).toBe("me");
        expect(args.answer.kind).toBe("right");
        // The index names the move that was played — through the candidate
        // list as SUBMITTED, which is the only list the fit will ever see.
        expect(args.answer.rightIndexes).toEqual([args.botPickIndex]);
        expect(args.candidates[args.botPickIndex].description).toBe(chosen);
        expect(args.candidates.length).toBeGreaterThan(1);
        // Provenance: the game it was given in and the version it was given at.
        expect(args.gameId).toBe("game-7");
        expect(args.seq).toBe(SEQ);
        expect(args.spec.cards.length).toBeGreaterThan(0);
    });

    it("submits a declare-attackers decision the same way", async () => {
        const { chosen } = pushDecision(
            DECLARE_ATTACKERS,
            (moves) =>
                moves.find(
                    (m) =>
                        m.kind === "declare-attackers" &&
                        m.attackerIds.length > 0
                ) ?? moves[0]
        );
        render(<AiDecisionTrace />);
        await openQuiz();

        fireEvent.click(
            screen.getByRole("button", { name: "The Bot was right" })
        );
        await waitFor(() => expect(submitVerdict).toHaveBeenCalledTimes(1));

        const args = lastSubmission();
        expect(args.candidates[args.botPickIndex].description).toBe(chosen);
        expect(args.answer.rightIndexes).toEqual([args.botPickIndex]);
    });

    it("submits ANOTHER candidate as the right move, keeping the Bot's pick beside it", async () => {
        pushDecision(
            MAIN_PHASE,
            (moves) => moves.find((m) => m.kind === "pass") ?? moves[0]
        );
        render(<AiDecisionTrace />);
        await openQuiz();

        // The tester picks a move the Bot did not play, then submits it.
        const rows = screen
            .getAllByRole("button")
            .filter((button) => button.getAttribute("aria-pressed") !== null);
        const other = rows.find(
            (button) => !button.textContent?.startsWith("pass")
        );
        expect(other).toBeDefined();
        const otherText = other!.textContent?.replace("Bot played this", "");
        fireEvent.click(other!);
        fireEvent.click(
            screen.getByRole("button", { name: "Submit as the right move" })
        );
        await waitFor(() => expect(submitVerdict).toHaveBeenCalledTimes(1));

        const args = lastSubmission();
        const rightIndex = args.answer.rightIndexes[0];
        expect(rightIndex).not.toBe(args.botPickIndex);
        expect(args.candidates[rightIndex].description).toBe(otherText);
        // The Bot's own answer still travels: a pair needs both sides.
        expect(args.candidates[args.botPickIndex].description).toBe("pass");
    });

    it("marks the decision judged, and names the judge for an admin", async () => {
        currentUser = { nickname: "Ada", isAdmin: true };
        pushDecision(
            MAIN_PHASE,
            (moves) => moves.find((m) => m.kind === "pass") ?? moves[0]
        );
        render(<AiDecisionTrace />);
        await openQuiz();
        fireEvent.click(
            screen.getByRole("button", { name: "The Bot was right" })
        );

        // The judged state is the box's own receipt: the quiz closes and the
        // decision stops offering to be judged for the rest of the session.
        await screen.findByText("Judged by Ada");
        expect(screen.queryByRole("button", { name: "Judge this move" })).toBe(
            null
        );
    });

    it("refuses, in words, a decision whose position it cannot hold", async () => {
        // Pushed WITHOUT the consult's inputs — the shape of an entry from
        // before the position travelled, and of any pusher that has none.
        pushAiTrace(
            {
                botId: "p1",
                chosen: "pass",
                iterationsCompleted: 1,
                iterationsRequested: 1,
                elapsedMs: 1,
                stoppedBy: "iterations",
                mechanism: "mean-reward",
                candidates: [candidateTrace("pass", { kind: "pass" })],
            },
            "worker"
        );
        render(<AiDecisionTrace />);
        fireEvent.click(
            screen.getByRole("button", { name: "Judge this move" })
        );

        await screen.findByText(/no longer held/);
        expect(submitVerdict).not.toHaveBeenCalled();
    });
});
