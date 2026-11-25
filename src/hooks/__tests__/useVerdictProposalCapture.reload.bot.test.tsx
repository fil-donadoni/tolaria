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
//   - a capture for another game drops the previous game's stored decisions;
//   - Plan statements, comments and "obvious" marks made mid-game are there
//     after a reload, and a commented decision reaches the game-end list with
//     its words and the Plan in force.
//
// And where the game-end judge runs: on a Worker of its own, primed with the
// game's Manifest, every sampled decision asked at once — never the server,
// never the Bot's Brain — and a Worker that dies or a position it cannot search
// costs that decision, not the game-end path. Leaving the game stops it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
    tick: { gameOver: true } as Record<string, unknown> | null,
    /** The Convex client's `action` — the judge must call none. */
    action: vi.fn(() => Promise.reject(new Error("no server judge"))),
    /** Every export of the client Brain: the judge must reach none. */
    brain: {} as Record<string, ReturnType<typeof vi.fn>>,
    /** Each seat's Definition Manifest row. */
    manifests: {} as Record<string, unknown>,
    /** When set, what identifying a decision's move waits for. */
    identifying: null as Promise<void> | null,
    /** The signed-in account — a tester unless a test says otherwise. */
    user: { nickname: "Tessa", isTester: true } as Record<string, unknown>,
}));

vi.mock("convex/react", () => {
    const client = {
        mutation: () => Promise.resolve(null),
        action: h.action,
    };
    return {
        useConvex: () => client,
        useQuery: () => h.user,
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
            getDefinitionManifest: "gameReads:getDefinitionManifest",
        },
    },
}));
vi.mock("~/hooks/useResilientQuery", () => ({
    useResilientQuery: (ref: string, args: { playerId?: string } | "skip") => ({
        data:
            args === "skip"
                ? undefined
                : ref === "gameReads:getGameTick"
                  ? h.tick
                  : ref === "gameReads:getDefinitionManifest"
                    ? h.manifests[args.playerId!]
                    : undefined,
    }),
}));
vi.mock("~/lib/ai/brain-client", () => {
    Object.assign(h.brain, {
        consultBrain: vi.fn(),
        calibrateBrain: vi.fn(() => Promise.resolve(null)),
        warmBrain: vi.fn(),
        primeBrain: vi.fn(),
        disposeBrain: vi.fn(),
        isBrainBusy: vi.fn(() => false),
        onBrainBusyChange: vi.fn(() => () => {}),
    });
    return h.brain;
});

vi.mock("~/lib/ai/human-move-match", async (importOriginal) => {
    const actual =
        await importOriginal<typeof import("~/lib/ai/human-move-match")>();
    return {
        ...actual,
        identifyHumanMove: async (
            ...args: Parameters<typeof actual.identifyHumanMove>
        ) => {
            await h.identifying;
            return actual.identifyHumanMove(...args);
        },
    };
});

import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { projectPublicState } from "@convex/gameProjections";
import type { PublicGameState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { Id } from "@convex/_generated/dataModel";
import {
    annotateHumanDecision,
    captureHumanDecision,
    clearHumanCapture,
    humanCaptureReady,
    humanCaptureView,
    humanPlans,
    stateHumanPlan,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
} from "~/lib/ai/human-decision-capture";
import {
    clearVerdictProposals,
    getVerdictJudging,
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
async function captureLandDrop(
    solo = false
): Promise<{ human: string; bot: string }> {
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
    const seats = solo ? [human, state.players[1].id] : human;
    startHumanCapture(GAME, seats, {
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

function gameOver(gameId: string, seatIds: readonly string[]) {
    return (
        <>
            <VerdictProposalCapture
                gameId={gameId as Id<"games">}
                seatIds={seatIds}
                viewerId={seatIds[0]}
                seq={undefined}
            />
            <VerdictProposalOffer gameId={gameId} onOpen={() => {}} />
        </>
    );
}

function renderGameOver(human: string, bot: string) {
    return render(gameOver(GAME, human === bot ? [] : [human]));
}

let storage: ReturnType<typeof memoryStorage>;

/** The judge's Workers, faked at the message boundary. */
class JudgeWorker {
    static all: JudgeWorker[] = [];
    /** What a Worker does with a request: answer a pass, unless a test says
     *  otherwise. */
    static serve: (w: JudgeWorker, id: number) => void;
    posted: Record<string, unknown>[] = [];
    terminated = false;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
        JudgeWorker.all.push(this);
    }
    postMessage(message: Record<string, unknown>) {
        this.posted.push(structuredClone(message));
        if (message.kind === "prime") return;
        queueMicrotask(() => JudgeWorker.serve(this, message.id as number));
    }
    terminate() {
        this.terminated = true;
    }
    reply(id: number, extra: Record<string, unknown> = {}) {
        this.onmessage?.({
            data: {
                id,
                move: { kind: "pass" },
                trace: { elapsedMs: 120 },
                ...extra,
            },
        });
    }
}

/** Every request the judge posted, in order. */
const consults = () =>
    JudgeWorker.all.flatMap((w) => w.posted.filter((p) => p.kind !== "prime"));

/** Hold every request; `answer()` replies to the first one held. */
function holdConsults(): { answer: () => void } {
    const held: (() => void)[] = [];
    JudgeWorker.serve = (w, id) => held.push(() => w.reply(id));
    return { answer: () => held.shift()!() };
}

beforeEach(() => {
    storage = memoryStorage();
    setProposalStorageForTest(storage);
    h.tick = { gameOver: true };
    h.user = { nickname: "Tessa", isTester: true };
    h.manifests = {};
    h.identifying = null;
    h.action.mockClear();
    for (const fn of Object.values(h.brain)) fn.mockClear();
    JudgeWorker.all = [];
    JudgeWorker.serve = (w, id) => w.reply(id);
    vi.stubGlobal("Worker", JudgeWorker);
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

describe("issue #10088 — the player's words survive a reload mid-game", () => {
    it("Plan statements, comments and obvious marks are all there after a reload", async () => {
        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        stateHumanPlan(GAME, "me", 1, "race them");
        decide("me", 1, 2);
        annotateHumanDecision(GAME, "me", 1, { kind: "obvious" });
        annotateHumanDecision(GAME, "me", 2, {
            kind: "comment",
            text: "kept Bolt for the blocker",
        });
        stateHumanPlan(GAME, "me", 2, "stabilise first");
        reload();

        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        expect(humanPlans(GAME)).toEqual([
            { seatId: "me", text: "race them", seq: 1 },
            { seatId: "me", text: "stabilise first", seq: 2 },
        ]);
        // The open decision kept its comment.
        expect(humanCaptureView(GAME, "me").decision).toEqual({
            seq: 2,
            annotation: { kind: "comment", text: "kept Bolt for the blocker" },
        });
        decide("me", 3, 3);
        reload();

        startHumanCapture(GAME, "me", { limit: 10, seed: 1 });
        await humanCaptureReady(GAME);
        expect(
            takeHumanDecisions(GAME).map((d) => [
                d.source.state.seq,
                d.annotation,
            ])
        ).toEqual([
            [1, { kind: "obvious" }],
            [2, { kind: "comment", text: "kept Bolt for the blocker" }],
            [3, undefined],
        ]);
    });

    it("a commented decision reaches the game-end list with its words and its Plan, after a reload", async () => {
        const { human, bot } = await captureLandDrop();
        stateHumanPlan(GAME, human, 300, "ramp into Bears");
        annotateHumanDecision(GAME, human, 314, {
            kind: "comment",
            text: "land before anything",
        });
        reload();

        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        const [proposal] = getVerdictProposals(GAME)!.proposals;
        expect(proposal.rationale).toBe("land before anything");
        expect(proposal.plan).toEqual({ text: "ramp into Bears", seq: 300 });
    });
});

describe("issue #10229 — the game-end judge: testers only, visible, never waited on", () => {
    it("shows the judge running, then offers the review once the list lands", async () => {
        const held = holdConsults();
        const { human, bot } = await captureLandDrop();
        renderGameOver(human, bot);
        const busy = await screen.findByRole("button", {
            name: "Judging your decisions… (0/1)",
        });
        expect((busy as HTMLButtonElement).disabled).toBe(true);
        held.answer();
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        expect(
            screen.queryByRole("button", { name: /Judging your decisions/ })
        ).toBeNull();
    });

    it("never consults the judge for an account that may not give a Verdict", async () => {
        h.user = { nickname: "Pat", isTester: false };
        const { human, bot } = await captureLandDrop();
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        renderGameOver(human, bot);
        // Give the game-end path every chance to run before asserting nothing did.
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(JudgeWorker.all).toHaveLength(0);
        expect(countsLines(info)).toEqual([]);
        expect(
            screen.queryByRole("button", { name: /your decisions/ })
        ).toBeNull();
    });

    it("leaving the game mid-judge drops the progress line and lands no list", async () => {
        const held = holdConsults();
        const { human, bot } = await captureLandDrop();
        const view = renderGameOver(human, bot);
        await screen.findByRole("button", { name: /Judging your decisions/ });
        await waitFor(() => expect(consults()).toHaveLength(1));
        expect(JudgeWorker.all[0].terminated).toBe(false);
        view.unmount();
        expect(getVerdictJudging(GAME)).toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(JudgeWorker.all.map((w) => w.terminated)).toEqual([true]);
        held.answer();
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(getVerdictJudging(GAME)).toBeNull();
        expect(getVerdictProposals(GAME)).toBeNull();
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
        expect(consults()).toHaveLength(1);
    });

    it("judges on a Worker of its own, primed with the seat's Manifest — never the server, never the Bot's Brain (issue #10241)", async () => {
        const { human, bot } = await captureLandDrop();
        h.manifests[human] = {
            entries: [{ definitionId: "mountain", set: "lea" }],
        };
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        expect(JudgeWorker.all).toHaveLength(1);
        const [prime, consult] = JudgeWorker.all[0].posted;
        expect(prime).toEqual({
            kind: "prime",
            entries: [{ definitionId: "mountain", set: "lea" }],
        });
        expect(consult).toMatchObject({
            botId: human,
            budget: { iterations: VERDICT_PROPOSAL_CONFIG.iterations },
            seed: VERDICT_PROPOSAL_CONFIG.seed,
        });
        expect(consults()).toHaveLength(1);
        expect(h.action).not.toHaveBeenCalled();
        for (const [name, fn] of Object.entries(h.brain)) {
            expect(fn, name).not.toHaveBeenCalled();
        }
        // The list landed: the Workers are gone.
        await waitFor(() => expect(JudgeWorker.all[0].terminated).toBe(true));
    });

    it("every captured seat's Manifest primes the judge, one that arrives later too", async () => {
        holdConsults();
        const { human, bot } = await captureLandDrop(true);
        const row = (definitionId: string) => ({
            entries: [{ definitionId, set: "lea" }],
        });
        h.manifests[human] = row("mountain");
        const seats = [human, bot];
        const view = render(gameOver(GAME, seats));
        await waitFor(() => expect(consults()).toHaveLength(1));
        h.manifests[bot] = row("forest");
        view.rerender(gameOver(GAME, [...seats]));
        const primes = JudgeWorker.all[0].posted.filter(
            (p) => p.kind === "prime"
        );
        expect(primes.map((p) => p.entries)).toEqual([
            row("mountain").entries,
            row("forest").entries,
        ]);
    });

    it("a rematch on the same board stops the judge: the next game's Bot has the device to itself", async () => {
        holdConsults();
        const { human } = await captureLandDrop();
        const view = render(gameOver(GAME, [human]));
        await waitFor(() => expect(consults()).toHaveLength(1));
        h.tick = { gameOver: false, owedPlayerIds: [] };
        view.rerender(gameOver(OTHER, [human]));
        await waitFor(() =>
            expect(JudgeWorker.all.map((w) => w.terminated)).toEqual([true])
        );
        expect(getVerdictProposals(OTHER)).toBeNull();
    });

    it("a review whose every consult failed is asked again after a reload", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        JudgeWorker.serve = (w) => w.onerror!({});
        const { human, bot } = await captureLandDrop();
        renderGameOver(human, bot);
        await waitFor(() => expect(getVerdictProposals(GAME)).not.toBeNull());
        reload();
        JudgeWorker.serve = (w, id) => w.reply(id);
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
    });

    it("a game re-opened while its judge was still at work builds its own list, unspoilt by the one it left", async () => {
        const held = holdConsults();
        const { human, bot } = await captureLandDrop();
        const left = renderGameOver(human, bot);
        await waitFor(() => expect(consults()).toHaveLength(1));
        left.unmount();
        await new Promise((resolve) => setTimeout(resolve, 5));
        renderGameOver(human, bot);
        await waitFor(() => expect(consults()).toHaveLength(2));
        // The one left behind ended with no answer, and landed nothing.
        expect(getVerdictProposals(GAME)).toBeNull();
        expect(JudgeWorker.all.map((w) => w.terminated)).toEqual([true, false]);
        held.answer();
        held.answer();
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
    });

    it("a game left while its decisions are still being identified lands no list of its own when re-opened", async () => {
        const { human, bot } = await captureLandDrop();
        let identified: () => void = () => {};
        h.identifying = new Promise((resolve) => {
            identified = resolve;
        });
        const left = renderGameOver(human, bot);
        await screen.findByRole("button", { name: /Judging your decisions/ });
        left.unmount();
        await new Promise((resolve) => setTimeout(resolve, 5));
        const held = holdConsults();
        renderGameOver(human, bot);
        await screen.findByRole("button", { name: /Judging your decisions/ });
        identified();
        await waitFor(() => expect(consults()).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 20));
        // The one left behind had no answer and must not say so for the game.
        expect(getVerdictProposals(GAME)).toBeNull();
        expect(getVerdictJudging(GAME)).toEqual({
            gameId: GAME,
            done: 0,
            total: 1,
        });
        held.answer();
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
    });

    it.each([
        [
            "judge.worker-error",
            (w: JudgeWorker) => w.onerror!({ message: "boom" }),
        ],
        [
            "judge.search-error",
            (w: JudgeWorker, id: number) =>
                w.reply(id, {
                    move: null,
                    trace: null,
                    error: { name: "Error", message: "bad position" },
                }),
        ],
    ])(
        "a consult that fails costs the decision, not the game-end path: %s",
        async (counter, serve) => {
            const info = vi.spyOn(console, "info").mockImplementation(() => {});
            vi.spyOn(console, "warn").mockImplementation(() => {});
            JudgeWorker.serve = serve;
            const { human, bot } = await captureLandDrop();
            renderGameOver(human, bot);
            await waitFor(() =>
                expect(getVerdictProposals(GAME)).not.toBeNull()
            );
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

    it("the counts line carries the search's time and the wait for it", async () => {
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
            "judge.searchMs.p50": 120,
            "judge.searchMs.max": 120,
        });
        expect(line["judge.waitMs.max"]).toBeGreaterThanOrEqual(0);
    });

    it("a list built before the reload is offered again with the same count, the Brain not consulted again", async () => {
        const { human, bot } = await captureLandDrop();
        reload();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        expect(consults()).toHaveLength(1);

        reload();
        expect(getVerdictProposals(GAME)).toBeNull();
        renderGameOver(human, bot);
        await screen.findByRole("button", {
            name: "Review your decisions (1)",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(consults()).toHaveLength(1);
    });
});
