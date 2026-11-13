// Verdict Proposals survive a page reload (issue #8889).
//
// A "reload" here is what a reload does to this path: the tab's module state
// is gone (the board unmounts, `clearHumanCapture` + `clearVerdictProposals`
// empty memory) while client storage is kept — an in-memory fake of the
// IndexedDB seam that clones on every write and read, as IndexedDB does.
//
// Pinned:
//   - decisions captured before a reload and after it are ONE capture: same
//     reservoir sample as a game with no reload, open decision continued;
//   - a list built before a reload is offered again with the game over, and
//     the Brain is not consulted a second time;
//   - a reload after the game ended but before the list was built builds it
//     from the stored decisions;
//   - storage that throws on read and write changes nothing;
//   - a capture for another game drops the previous game's stored decisions.
//
// And where the game-end judge runs (issue #9528): through the server action,
// one call per sampled decision, never a Brain on this device — and a call the
// server refuses or that fails costs that decision, not the game-end path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
    tick: { gameOver: true } as Record<string, unknown> | null,
    /** The server judge action — what the game-end judge must call. */
    action: null as unknown as ReturnType<typeof vi.fn>,
    /** Every export of the client Brain: the judge must reach none. */
    brain: {} as Record<string, ReturnType<typeof vi.fn>>,
    /** Workers constructed: the judge must spawn none. */
    workers: 0,
}));

vi.mock("convex/react", () => {
    const client = {
        mutation: () => Promise.resolve(null),
        action: (...args: unknown[]) => h.action(...args),
    };
    return {
        useConvex: () => client,
        useQuery: () => ({ nickname: "Tessa", isTester: true }),
    };
});
vi.mock("@convex/_generated/api", () => ({
    api: {
        users: { currentUser: "users:currentUser" },
        game: { getPublicState: "game:getPublicState" },
        gameReads: {
            getGameTick: "gameReads:getGameTick",
            getSeatDeckKnowledge: "gameReads:getSeatDeckKnowledge",
            getSeatDeck: "gameReads:getSeatDeck",
        },
        verdictJudge: { judgePosition: "verdictJudge:judgePosition" },
    },
}));
vi.mock("~/hooks/useResilientQuery", () => ({
    useResilientQuery: (ref: string, args: unknown) => ({
        data:
            args === "skip"
                ? undefined
                : ref === "gameReads:getGameTick"
                  ? h.tick
                  : undefined,
    }),
}));
vi.mock("~/lib/ai/brain-client", () => {
    Object.assign(h.brain, {
        consultBrain: vi.fn(),
        warmBrain: vi.fn(),
        primeBrain: vi.fn(),
        disposeBrain: vi.fn(),
    });
    return h.brain;
});

import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { PublicGameState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexError } from "convex/values";
import {
    captureHumanDecision,
    clearHumanCapture,
    humanCaptureReady,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
} from "~/lib/ai/human-decision-capture";
import {
    clearVerdictProposals,
    getVerdictProposals,
    loadVerdictProposals,
    setVerdictProposals,
} from "~/lib/ai/verdict-proposal-store";
import {
    setProposalStorageForTest,
    type ProposalStorage,
    type ProposalStoreName,
} from "~/lib/ai/verdict-proposal-persistence";
import type { VerdictProposalList } from "~/lib/ai/verdict-proposals";
import { VERDICT_PROPOSAL_CONFIG } from "~/lib/ai/verdict-proposal-config";
import VerdictProposalCapture from "~/components/board/verdict-proposal-capture";
import VerdictProposalOffer from "~/components/board/verdict-proposal-offer";

const GAME = "game-8889";
const OTHER = "game-8889-next";

/** The IndexedDB seam, in memory: clones on write and on read. */
function memoryStorage(): ProposalStorage & {
    rows: Map<ProposalStoreName, Map<string, unknown>>;
} {
    const rows = new Map<ProposalStoreName, Map<string, unknown>>([
        ["capture", new Map()],
        ["proposals", new Map()],
    ]);
    return {
        rows,
        readAll: async (store) =>
            structuredClone(Object.fromEntries(rows.get(store)!)),
        write: async (store, entries, clear) => {
            const s = rows.get(store)!;
            if (clear) s.clear();
            for (const [k, v] of Object.entries(entries)) {
                s.set(k, structuredClone(v));
            }
        },
    };
}

/** Storage that throws on everything, synchronously and asynchronously. */
const brokenStorage: ProposalStorage = {
    readAll: () => {
        throw new Error("storage read exploded");
    },
    write: () => Promise.reject(new Error("quota exceeded")),
};

/** What a reload leaves: no module state, storage untouched. */
function reload(): void {
    cleanup();
    clearHumanCapture();
    clearVerdictProposals();
}

/** A minimal own view of `seat` at `seq` — enough for the capture's guards. */
function view(seat: string, seq: number): PublicGameState {
    return {
        seq,
        players: [{ id: seat, hand: [] }],
    } as unknown as PublicGameState;
}

const play = (seat: string, n: number) => ({
    name: "game:passPriority",
    args: { gameId: GAME, playerId: seat, n },
});

/** Decisions `from..to` on `GAME`, each closed by the next one's opening. */
function decide(seat: string, from: number, to: number): void {
    for (let seq = from; seq <= to; seq++) {
        captureHumanDecision(GAME, { state: view(seat, seq), botId: seat });
        recordHumanCall(GAME, play(seat, seq));
    }
}

const seqs = (gameId: string) =>
    takeHumanDecisions(gameId).map((d) => d.source.state.seq);

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

/** A real land drop captured through the store, the way play records it:
 *  the seat's own view, then the mutation playing the land. */
async function captureLandDrop(): Promise<{ human: string; bot: string }> {
    const state = buildBladeState({
        label: "verdict proposal reload fixture",
        spec: HUMAN_MAIN_PHASE,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const human = state.players[0].id;
    const land = state.players[0].hand.find(
        (c) => c.card.id === getCardByName("Mountain").id
    )!;
    startHumanCapture(GAME, human, {
        limit: VERDICT_PROPOSAL_CONFIG.captureLimit,
        seed: VERDICT_PROPOSAL_CONFIG.seed,
    });
    await humanCaptureReady(GAME);
    captureHumanDecision(GAME, {
        state: projectPublicState(state, 314, human),
        botId: human,
    });
    recordHumanCall(GAME, {
        name: "game:playCard",
        args: { gameId: GAME, playerId: human, cardInstanceId: land.id },
    });
    return { human, bot: state.players[1].id };
}

function renderGameOver(human: string, bot: string) {
    return render(
        <>
            <VerdictProposalCapture
                gameId={GAME as Id<"games">}
                botId={bot}
                humanId={human}
            />
            <VerdictProposalOffer gameId={GAME} onOpen={() => {}} />
        </>
    );
}

let storage: ReturnType<typeof memoryStorage>;

/** The server's answer to one position: a pass, as the judge returns it. */
const PASS_ANSWER = {
    move: { kind: "pass" },
    outcome: "move",
    searchMs: 120,
    heapUsedMb: 190,
};

beforeEach(() => {
    storage = memoryStorage();
    setProposalStorageForTest(storage);
    h.tick = { gameOver: true };
    h.action = vi.fn(async () => PASS_ANSWER);
    for (const fn of Object.values(h.brain)) fn.mockClear();
    h.workers = 0;
    vi.stubGlobal(
        "Worker",
        class {
            constructor() {
                h.workers += 1;
            }
        }
    );
});

afterEach(() => {
    reload();
    setProposalStorageForTest(undefined);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

/** The `verdict proposals` counts line the game-end path reported. */
function countsLines(info: ReturnType<typeof vi.spyOn>): unknown[] {
    return info.mock.calls
        .filter((c: unknown[]) => c[0] === "verdict proposals")
        .map((c: unknown[]) => c[1]);
}

describe("issue #8889 — the capture resumes across a reload", () => {
    it("decisions before and after a reload are one capture, sampled as with no reload", async () => {
        const limit = 3;
        // The control: the same game with no reload.
        startHumanCapture(GAME, "me", { limit, seed: 5 });
        await humanCaptureReady(GAME);
        decide("me", 1, 10);
        const unbroken = seqs(GAME);
        expect(unbroken).toHaveLength(limit);

        storage = memoryStorage();
        setProposalStorageForTest(storage);
        reload();
        startHumanCapture(GAME, "me", { limit, seed: 5 });
        await humanCaptureReady(GAME);
        decide("me", 1, 6);
        reload();
        startHumanCapture(GAME, "me", { limit, seed: 5 });
        await humanCaptureReady(GAME);
        decide("me", 7, 10);
        expect(seqs(GAME)).toEqual(unbroken);
    });

    it("the open decision keeps its calls across the reload", async () => {
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        decide("me", 1, 2);
        reload();
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        // Calls arriving while storage is still being read are replayed.
        recordHumanCall(GAME, play("me", 99));
        await humanCaptureReady(GAME);
        const taken = takeHumanDecisions(GAME);
        expect(taken.map((d) => d.source.state.seq)).toEqual([1, 2]);
        expect(taken[1].calls.map((c) => c.args.n)).toEqual([2, 99]);
    });

    it("a capture for another game drops the previous game's stored decisions", async () => {
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        decide("me", 1, 3);
        reload();
        startHumanCapture(OTHER, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(OTHER);
        const rows = storage.rows.get("capture")!;
        expect((rows.get("meta") as { gameId: string }).gameId).toBe(OTHER);
        expect([...rows.keys()].filter((k) => k.startsWith("kept:"))).toEqual(
            []
        );
        reload();
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        expect(seqs(GAME)).toEqual([]);
    });

    it("storage throwing on read and write: capture and the list behave as in memory, nothing thrown", async () => {
        setProposalStorageForTest(brokenStorage);
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        decide("me", 1, 3);
        await humanCaptureReady(GAME);
        decide("me", 4, 4);
        expect(seqs(GAME)).toEqual([1, 2, 3, 4]);

        const list = {
            proposals: [],
            captured: 4,
            unidentified: 0,
            unjudged: 0,
        } as VerdictProposalList;
        setVerdictProposals(GAME, list);
        expect(getVerdictProposals(GAME)).toBe(list);
        clearVerdictProposals();
        await expect(loadVerdictProposals(GAME)).resolves.toBeNull();
    });
});

describe("issue #8889 — the game-over review survives a reload", () => {
    it("a reload after the game ended, before the list was built, builds it from the stored decisions", async () => {
        const { human, bot } = await captureLandDrop();
        reload();

        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        expect(h.action).toHaveBeenCalled();
    });

    it("judges through the server action, never a Brain on this device (issue #9528)", async () => {
        const { human, bot } = await captureLandDrop();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        expect(h.action).toHaveBeenCalledTimes(1);
        expect(h.action).toHaveBeenCalledWith(
            "verdictJudge:judgePosition",
            expect.objectContaining({
                gameId: GAME,
                botId: human,
                iterations: VERDICT_PROPOSAL_CONFIG.iterations,
                seed: VERDICT_PROPOSAL_CONFIG.seed,
            })
        );
        for (const [name, fn] of Object.entries(h.brain)) {
            expect(fn, name).not.toHaveBeenCalled();
        }
        expect(h.workers).toBe(0);
    });

    it.each([
        [
            "judge.server-rejected",
            new ConvexError("This game has no judge positions left."),
        ],
        ["judge.server-error", new Error("network down")],
    ])(
        "a call that throws costs the decision, not the game-end path: %s (issue #9528)",
        async (counter, cause) => {
            const info = vi.spyOn(console, "info").mockImplementation(() => {});
            h.action = vi.fn(async () => {
                throw cause;
            });
            const { human, bot } = await captureLandDrop();
            renderGameOver(human, bot);
            await waitFor(() =>
                expect(getVerdictProposals(GAME)).not.toBeNull()
            );
            expect(h.action).toHaveBeenCalledTimes(1);
            expect(getVerdictProposals(GAME)).toMatchObject({
                proposals: [],
                captured: 1,
                unjudged: 1,
            });
            expect(countsLines(info)).toEqual([
                expect.objectContaining({
                    gameId: GAME,
                    proposals: 0,
                    unjudged: 1,
                    [counter]: 1,
                }),
            ]);
        }
    );

    it("the counts line carries the server's search time and the round trip (issue #9528)", async () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        const { human, bot } = await captureLandDrop();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        await waitFor(() => expect(countsLines(info)).toHaveLength(1));
        const [line] = countsLines(info) as Record<string, number>[];
        expect(line).toMatchObject({
            "judge.move": 1,
            "judge.serverMs.p50": 120,
            "judge.serverMs.max": 120,
            "judge.heapMb.max": 190,
        });
        expect(line["judge.roundTripMs.max"]).toBeGreaterThanOrEqual(0);
    });

    it("a list built before the reload is offered again with the same count, the Brain not consulted again", async () => {
        const { human, bot } = await captureLandDrop();
        reload();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        const consults = h.action.mock.calls.length;
        expect(consults).toBeGreaterThan(0);

        reload();
        expect(getVerdictProposals(GAME)).toBeNull();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        await waitFor(() => expect(h.action.mock.calls.length).toBe(consults));
    });
});
