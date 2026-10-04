// The missing-halves queue, from the box to the mutation (issue #4801, PRD
// #4792, ADR 0148, user stories 10, 11, 12).
//
// Driven through the SURFACE a tester uses — the queue, its buttons, the
// Convex client mocked at the boundary — over a REAL position: the anchor's
// candidates come from the engine's own enumerator, and the right-hand half is
// built by the production blade builder, so "the half builds" is not assumed.
//
// A `.bot.test.tsx` because it loads the engine graph.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
    render,
    cleanup,
    screen,
    fireEvent,
    waitFor,
} from "@testing-library/react";

const submitVerdict = vi.fn(async () => "verdict-2");
const loadQueue = vi.fn();
let currentUser: {
    nickname: string;
    isAdmin?: boolean;
    isTester?: boolean;
} | null = { nickname: "Bob", isTester: true };

vi.mock("convex/react", () => ({
    useMutation: () => submitVerdict,
    useQuery: () => currentUser,
    useAction: (fn: string) =>
        fn === "verdictReviewActions:missingHalves" ? loadQueue : vi.fn(),
}));
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: "users:currentUser" },
        verdicts: { submit: "verdicts:submit" },
        verdictReviewActions: {
            missingHalves: "verdictReviewActions:missingHalves",
        },
    },
}));

import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { candidateMoves } from "@convex/gre/ai/verdicts/candidates";
import { describeMove } from "@convex/gre/describeMove";
import { moveKey } from "@convex/gre/search";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { VerdictJudgement } from "@convex/gre/ai/verdicts/identity";
import type { MissingHalf } from "@convex/verdictReview";
import MissingHalvesQueue from "../missing-halves-queue";

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

const ANCHOR_ID = "v1-" + "a".repeat(64);
const DISCRIMINANT = { kind: "life" as const, detail: "opp life 5" };

/** A real Conditional Verdict: "pass" is wrong NOW, the position as enumerated. */
function anchorOf(overrides: Partial<VerdictJudgement> = {}): MissingHalf {
    const state = buildBladeState({
        label: "missing-half fixture",
        spec: MAIN_PHASE,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const moves = candidateMoves(state, state.players[0].id);
    const candidates = moves.map((move) => ({
        key: moveKey(move),
        description: describeMove(move, state),
    }));
    const wrong = candidates.findIndex((c) => c.description === "pass");
    return {
        anchorId: ANCHOR_ID,
        positionKey: "v1-" + "b".repeat(64),
        judgement: {
            spec: MAIN_PHASE,
            seat: "me",
            candidates,
            answer: { kind: "forbidden", forbiddenIndexes: [wrong] },
            classification: { kind: "conditional", discriminant: DISCRIMINANT },
            ...overrides,
        },
    };
}

beforeEach(() => {
    cleanup();
    submitVerdict.mockClear();
    loadQueue.mockReset();
    currentUser = { nickname: "Bob", isTester: true };
});

describe("the missing-halves queue", () => {
    it("lists a deferred Conditional Verdict by the move it ruled out and its Discriminant", async () => {
        loadQueue.mockResolvedValue([anchorOf()]);
        render(<MissingHalvesQueue />);
        const row = await screen.findByTestId("missing-half-row");
        expect(row.textContent).toContain("Wrong now: pass");
        expect(row.textContent).toContain("Because of life: opp life 5");
        expect(screen.getByText("Missing halves (1)")).toBeTruthy();
    });

    it("says so when no half is owed", async () => {
        loadQueue.mockResolvedValue([]);
        render(<MissingHalvesQueue />);
        expect(
            await screen.findByText("No right-hand half is owed.")
        ).toBeTruthy();
    });

    it("renders nothing, and reads nothing, for an account that is no tester", () => {
        currentUser = { nickname: "Pat" };
        const { container } = render(<MissingHalvesQueue />);
        expect(container.textContent).toBe("");
        expect(loadQueue).not.toHaveBeenCalled();
    });

    it("lets another tester write the half: one submission, the anchor's Discriminant verbatim, the anchor untouched", async () => {
        loadQueue.mockResolvedValueOnce([anchorOf()]).mockResolvedValueOnce([]);
        render(<MissingHalvesQueue />);
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Write the right-hand half",
            })
        );
        // The Discriminant is the anchor's, shown, not asked for again.
        expect(screen.getByTestId("pair-discriminant").textContent).toBe(
            "life: opp life 5"
        );
        fireEvent.change(screen.getByLabelText("Seat"), {
            target: { value: "opp" },
        });
        fireEvent.change(screen.getByLabelText("Life total"), {
            target: { value: "5" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Show the right-hand position" })
        );
        const confirm = await screen.findByRole("button", {
            name: "The move is right here",
        });
        await waitFor(() =>
            expect((confirm as HTMLButtonElement).disabled).toBe(false)
        );
        fireEvent.click(confirm);
        await waitFor(() => expect(submitVerdict).toHaveBeenCalledTimes(1));

        const [sent] = submitVerdict.mock.calls[0] as unknown as [
            {
                spec: ScenarioSpec;
                answer: { kind: string; rightIndexes: number[] };
                candidates: { description: string }[];
                pairOf: { anchorId: string; discriminant: unknown };
                classification?: unknown;
            },
        ];
        expect(sent.answer.kind).toBe("right");
        expect(sent.candidates[sent.answer.rightIndexes[0]].description).toBe(
            "pass"
        );
        expect(sent.spec.life?.opp).toBe(5);
        expect(sent.classification).toBeUndefined();
        expect(sent.pairOf).toEqual({
            anchorId: ANCHOR_ID,
            discriminant: DISCRIMINANT,
        });
        // The queue reloads, and the completed anchor is gone.
        expect(
            await screen.findByText("No right-hand half is owed.")
        ).toBeTruthy();
        expect(loadQueue).toHaveBeenCalledTimes(2);
    });

    it("leaves the half in the queue when the writer walks away", async () => {
        loadQueue.mockResolvedValue([anchorOf()]);
        render(<MissingHalvesQueue />);
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Write the right-hand half",
            })
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Back to the queue" })
        );
        expect(await screen.findByTestId("missing-half-row")).toBeTruthy();
        expect(submitVerdict).not.toHaveBeenCalled();
    });

    it("leaves the half in the queue from the right-hand position too, storing nothing", async () => {
        loadQueue.mockResolvedValue([anchorOf()]);
        render(<MissingHalvesQueue />);
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Write the right-hand half",
            })
        );
        fireEvent.change(screen.getByLabelText("Seat"), {
            target: { value: "opp" },
        });
        fireEvent.change(screen.getByLabelText("Life total"), {
            target: { value: "5" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "Show the right-hand position" })
        );
        const confirm = await screen.findByRole("button", {
            name: "The move is right here",
        });
        await waitFor(() =>
            expect((confirm as HTMLButtonElement).disabled).toBe(false)
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Leave it in the queue" })
        );
        expect(await screen.findByTestId("missing-half-row")).toBeTruthy();
        expect(submitVerdict).not.toHaveBeenCalled();
    });

    it("refuses an anchor that carries setup steps, saying why", async () => {
        loadQueue.mockResolvedValue([
            anchorOf({ setup: [{ kind: "pass" }] as never }),
        ]);
        render(<MissingHalvesQueue />);
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Write the right-hand half",
            })
        );
        expect((await screen.findByRole("alert")).textContent).toContain(
            "setup steps"
        );
    });

    it("shows a half that changes nothing as a refusal, never a submission", async () => {
        // `other` prefills nothing beyond the copy: left as it is, the half IS
        // the anchor's position, which is no pair.
        const anchor = anchorOf({
            classification: {
                kind: "conditional",
                discriminant: { kind: "other", detail: "the opponent bluffs" },
            },
        });
        loadQueue.mockResolvedValue([anchor]);
        render(<MissingHalvesQueue />);
        fireEvent.click(
            await screen.findByRole("button", {
                name: "Write the right-hand half",
            })
        );
        fireEvent.click(
            screen.getByRole("button", { name: "Show the right-hand position" })
        );
        const refusal = await screen.findByTestId("pair-refusal");
        expect(refusal.getAttribute("data-refusal-reason")).toBe("no-change");
        expect(
            (
                screen.getByRole("button", {
                    name: "The move is right here",
                }) as HTMLButtonElement
            ).disabled
        ).toBe(true);
        expect(submitVerdict).not.toHaveBeenCalled();
    });
});
