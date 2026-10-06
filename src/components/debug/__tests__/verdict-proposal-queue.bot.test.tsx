// The post-game review queue (issue #3986, PRD #3980): a finished vs-Bot
// game's Verdict Proposals, answered through the SAME quiz the debug ring
// opens, submitted through `verdicts.submit` unchanged.
//
// Full path, nothing hand-built in between: a captured human decision on a real
// position → `proposeVerdicts` at game end → the store → the game-over dialog's
// offer → the quiz → the REAL `verdicts.submit` handler (the Convex client is
// mocked only at its boundary, routing the call into the handler over an
// in-memory ctx) → the stored row, read back the way the corpus reads it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import {
    makeMutationCtx,
    runMutation,
    type MutationStub,
    type Row,
} from "@convex/__tests__/gameMutationHarness.fixture";
import { submit } from "@convex/verdicts";

let stub: MutationStub;
const submitVerdict = vi.fn(async (args: Record<string, unknown>) =>
    runMutation<Record<string, unknown>, string>(submit, stub.ctx, args)
);
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
    getStoredSession: () => ({ gameId: GAME, playerId: "p1" }),
    clearSession: () => {},
}));
vi.mock("~/components/board/sideboarding-dialog", () => ({
    default: () => null,
}));

import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { candidateMoves } from "@convex/gre/ai/verdicts/candidates";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { DecisionTrace, Move } from "@convex/gre";
import type { GameState } from "@convex/gre/state";
import { judgementOfRow, type OutboxRow } from "@convex/verdictsOutbox";
import type { GameOver, Player } from "~/types/game";
import type { CapturedDecision } from "~/lib/ai/human-decision-capture";
import { proposeVerdicts, type BrainJudge } from "~/lib/ai/verdict-proposals";
import {
    clearVerdictProposals,
    setVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import { clearAiTraces, pushAiTrace } from "~/lib/ai/trace-store";
import GameOverDialog from "~/components/board/game-over-dialog";
import AiDecisionTrace from "../ai-decision-trace";

const GAME = "game-3986";
const SEQ = 314;

/** The human ("me") on their own main phase, a land in hand. */
const HUMAN_MAIN_PHASE: ScenarioSpec = {
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

function board(): { state: GameState; human: string } {
    const state = buildBladeState({
        label: "post-game review queue fixture",
        spec: HUMAN_MAIN_PHASE,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    return { state, human: state.players[0].id };
}

/** The decision as the capture records it during play: the seat's own view,
 *  and the mutation the player sent — playing the land. */
function landDrop(seq: number): {
    decision: CapturedDecision;
    state: GameState;
    human: string;
} {
    const { state, human } = board();
    const land = state.players[0].hand.find(
        (c) => c.card.id === getCardByName("Mountain").id
    )!;
    return {
        state,
        human,
        decision: {
            source: {
                state: projectPublicState(state, seq, human),
                botId: human,
            },
            calls: [
                {
                    name: "game:playCard",
                    args: {
                        gameId: GAME,
                        playerId: human,
                        cardInstanceId: land.id,
                    },
                },
            ],
        },
    };
}

/** The game-end Brain consult, fixed: it would have passed. */
const passingJudge: BrainJudge = async () => ({ kind: "pass" }) as Move;

/** Game end: the captured decisions become the game's proposal list, landed in
 *  the store the way `useVerdictProposalCapture` lands it. */
async function endGame(decisions: CapturedDecision[]) {
    const list = await proposeVerdicts(
        decisions,
        {
            captureLimit: 50,
            perClassQuota: 3,
            agreeingPerClass: 3,
            iterations: 1,
            seed: 1,
        },
        passingJudge
    );
    setVerdictProposals(GAME, list);
    return list;
}

const PLAYERS = [
    { id: "me", name: "Me", life: 20 },
    { id: "opp", name: "Bot", life: 0 },
] as unknown as Player[];

function renderGameOver() {
    return render(
        <GameOverDialog
            gameOver={
                { winnerId: "me", loserId: "opp", reason: "life" } as GameOver
            }
            allPlayers={PLAYERS}
            match={null}
            viewerId="me"
            gameId={GAME}
        />
    );
}

async function openReview(count: number) {
    fireEvent.click(
        await screen.findByRole("button", {
            name: `Review your decisions (${count})`,
        })
    );
}

/** Every `verdicts` row the handler stored. */
function storedVerdicts(): Row[] {
    return stub.writes
        .filter((w) => w.table === "verdicts")
        .map((w) => stub.doc(w.id));
}

const previousUrl = process.env.CONVEX_CLOUD_URL;

beforeEach(() => {
    cleanup();
    clearVerdictProposals();
    clearAiTraces();
    submitVerdict.mockClear();
    currentUser = { nickname: "Tessa", isTester: true };
    stub = makeMutationCtx("u-tester", [
        {
            _id: "u-tester",
            __table: "users",
            nickname: "Tessa",
            isTester: true,
        },
    ]);
    // `submit` attributes the row to the deployment it runs on (issue #3580).
    process.env.CONVEX_CLOUD_URL = "https://jovial-guineapig-250.convex.cloud";
});

afterEach(() => {
    if (previousUrl === undefined) delete process.env.CONVEX_CLOUD_URL;
    else process.env.CONVEX_CLOUD_URL = previousUrl;
});

describe("the post-game review queue (issue #3986)", () => {
    it("game end → proposal → quiz answer → verdicts.submit → the Verdict, read back", async () => {
        const { decision } = landDrop(SEQ);
        const list = await endGame([decision]);
        expect(list.proposals).toHaveLength(1);
        expect(list.proposals[0].agrees).toBe(false);

        renderGameOver();
        await openReview(1);
        await screen.findByText("Which move was right here?");
        // The player's move and the Bot's are both marked, apart.
        expect(screen.getByText("You played this")).toBeTruthy();
        expect(screen.getByText("Bot's pick")).toBeTruthy();
        // The deciding seat is the reader: named "You", its own hand shown
        // with no debugging consent, the Bot's hand a count.
        expect(
            screen.getByTestId("scenario-board-seat-me").textContent
        ).toMatch(/^You/);
        expect(
            screen.getByTestId("scenario-board-seat-opp").textContent
        ).toMatch(/^Bot/);
        expect(screen.getByTestId("scenario-board-hand-me").dataset.hand).toBe(
            "cards"
        );
        expect(screen.getByTestId("scenario-board-hand-opp").dataset.hand).toBe(
            "count"
        );
        expect(screen.queryByText("Reveal the Bot's hand")).toBeNull();

        fireEvent.click(
            screen.getByRole("button", { name: "My move was right" })
        );
        await waitFor(() => expect(storedVerdicts()).toHaveLength(1));

        const [row] = storedVerdicts();
        const judgement = judgementOfRow(row as unknown as OutboxRow)!;
        const right =
            judgement.candidates[
                (judgement.answer as { rightIndexes: number[] }).rightIndexes[0]
            ];
        // The player's land drop, as the rebuilt position names it.
        expect(right.description.toLowerCase()).toContain("mountain");
        expect(right.description).not.toBe("pass");
        // The Bot pick is the Brain's own move on the player's view.
        expect(
            judgement.candidates[row.botPickIndex as number].description
        ).toBe("pass");
        expect(row.seat).toBe("me");
        expect(row.gameId).toBe(GAME);
        expect(row.seq).toBe(SEQ);
        expect(row.author).toBe("Tessa");
        // Answered: the queue moves past it.
        await screen.findByText("1 decision judged.");
    });

    it("stores the same Verdict the debug quiz stores for the same decision", async () => {
        // One position, judged twice with the same answer: once as a Bot
        // decision in the ring, once as a proposal after the game.
        const { decision, state, human } = landDrop(SEQ);

        const trace: DecisionTrace = {
            botId: human,
            chosen: "pass",
            iterationsCompleted: 1,
            iterationsRequested: 1,
            elapsedMs: 1,
            stoppedBy: "iterations",
            mechanism: "mean-reward",
            candidates: [],
        };
        expect(
            candidateMoves(state, human).some((m) => m.kind === "pass")
        ).toBe(true);
        pushAiTrace(trace, "worker", decision.source);
        const ring = render(<AiDecisionTrace />);
        fireEvent.click(
            screen.getByRole("button", { name: "Judge this move" })
        );
        await screen.findByText("Which move was right here?");
        fireEvent.click(
            screen.getByRole("button", { name: "The Bot was right" })
        );
        await waitFor(() => expect(storedVerdicts()).toHaveLength(1));
        ring.unmount();

        await endGame([decision]);
        renderGameOver();
        await openReview(1);
        await screen.findByText("Which move was right here?");
        fireEvent.click(
            screen.getByRole("button", { name: "The Bot was right" })
        );
        await waitFor(() => expect(storedVerdicts()).toHaveLength(2));

        const [fromRing, fromQueue] = storedVerdicts();
        // Everything but the row's own identity and time.
        const corpusView = (row: Row) => ({
            ...row,
            _id: undefined,
            createdAt: undefined,
        });
        expect(corpusView(fromQueue)).toEqual(corpusView(fromRing));
        expect(judgementOfRow(fromQueue as unknown as OutboxRow)).toEqual(
            judgementOfRow(fromRing as unknown as OutboxRow)
        );
    });

    it("skipping every proposal and leaving records nothing", async () => {
        await endGame([landDrop(SEQ).decision, landDrop(SEQ + 1).decision]);
        renderGameOver();
        await openReview(2);

        await screen.findByText("Which move was right here?");
        fireEvent.click(screen.getByRole("button", { name: "Skip" }));
        await screen.findByText("2 / 2");
        fireEvent.click(screen.getByRole("button", { name: "Skip" }));
        await screen.findByText("No decision judged.");
        fireEvent.click(screen.getByRole("button", { name: "Done" }));

        // Back on the result, with nothing written anywhere.
        await screen.findByRole("button", { name: "Back to Lobby" });
        expect(submitVerdict).not.toHaveBeenCalled();
        expect(stub.writes).toHaveLength(0);
    });

    it("is not offered to an account that may not give a Verdict", async () => {
        currentUser = { nickname: "Plain" };
        await endGame([landDrop(SEQ).decision]);
        renderGameOver();
        await screen.findByRole("button", { name: "Back to Lobby" });
        expect(
            screen.queryByRole("button", { name: /Review your decisions/ })
        ).toBeNull();
    });

    it("is not offered while the game has no proposals", async () => {
        renderGameOver();
        await screen.findByRole("button", { name: "Back to Lobby" });
        expect(
            screen.queryByRole("button", { name: /Review your decisions/ })
        ).toBeNull();
    });
});

describe("a proposal's sentences, voiced for the player (issue #3986)", () => {
    it("swaps the lowering's role names, possessives included, both ways at once", async () => {
        const { candidateSentence } = await import("../ai-decision-quiz-copy");
        expect(
            candidateSentence(
                "Lightning Bolt → the opponent, then the Bot's Bears attack the Bot",
                "player"
            )
        ).toBe("Lightning Bolt → the Bot, then your Bears attack you");
        expect(candidateSentence("attack the opponent", "bot")).toBe(
            "attack the opponent"
        );
    });
});
