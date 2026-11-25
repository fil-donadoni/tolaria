// The Verdict Proposal judge on this device (`verdict-judge.ts`, ADR 0183
// Amendment I): the answer is the Brain request handler's own, called directly,
// for the same position, budget and seed; the Bot's Brain is never in its way
// nor it in the Bot's.
//
// The fake Worker runs the handler the real one runs (`brain.worker.ts` →
// `handleBrainRequest`) on a structured clone, so what crosses the message
// boundary is what would cross it in a browser.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import { projectPublicState } from "@convex/gameProjections";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { handleBrainRequest } from "@convex/gre/ai/brainRequest";
import type { BrainRequest } from "@convex/gre/ai/brainRequest";
import { consultBrain, disposeBrain } from "../brain-client";
import type { AiTraceSource } from "../trace-store";
import { VERDICT_PROPOSAL_CONFIG } from "../verdict-proposal-config";
import { openVerdictJudge, type VerdictJudge } from "../verdict-judge";

/** Every Worker spawned, with the requests it was posted. */
const workers: { requests: BrainRequest[]; terminated: boolean }[] = [];
/** Whether a fake Worker answers at all. */
let answers = true;

class SearchingWorker {
    requests: BrainRequest[] = [];
    terminated = false;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: unknown = null;
    constructor() {
        workers.push(this);
    }
    postMessage(message: BrainRequest | { kind: string }) {
        if ("kind" in message) return;
        const request = structuredClone(message);
        this.requests.push(request);
        if (!answers) return;
        setTimeout(() => {
            if (this.terminated) return;
            this.onmessage?.({
                data: structuredClone(handleBrainRequest(request)),
            });
        }, 0);
    }
    terminate() {
        this.terminated = true;
    }
}

/** The human's main phase: one of two equal creatures to cast, so a small
 *  search's pick is its seed's. */
const SPEC: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Forest", owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "me", zone: "hand" },
        { name: "Balduvian Bears", owner: "me", zone: "hand" },
        { name: "Goblin Piker", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

function captured(): AiTraceSource {
    const state = buildBladeState({
        label: "client judge fixture",
        spec: SPEC,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    const human = state.players[0].id;
    return {
        state: projectPublicState(state, 40, human),
        botId: human,
        knowledge: [
            {
                playerId: human,
                cardIds: Array<string>(20).fill(getCardByName("Mountain").id),
            },
        ],
    };
}

/** The reference answer: the shared handler, called in this thread, at the
 *  judge's fixed budget and seed — no Worker, no clock. */
function referenceMove(
    source: AiTraceSource,
    iterations: number,
    seed: number
) {
    return handleBrainRequest({
        id: 0,
        state: source.state,
        botId: source.botId,
        budget: { iterations },
        deckKnowledge: source.knowledge,
        seed,
    }).move;
}

let open: VerdictJudge;

beforeEach(() => {
    workers.length = 0;
    answers = true;
    vi.stubGlobal("Worker", SearchingWorker);
    vi.stubGlobal("navigator", { hardwareConcurrency: 8, userAgent: "" });
    open = openVerdictJudge();
});

afterEach(() => {
    open.close();
    disposeBrain();
    vi.unstubAllGlobals();
});

describe("the client judge — same position, budget and seed, same move", () => {
    // Budgets small enough that the seed decides: an answer that ignored it
    // would not follow the reference's across them.
    const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

    it("answers what the handler answers in this thread, seed by seed", async () => {
        const source = captured();
        const served = SEEDS.map((seed) => referenceMove(source, 6, seed));
        // The fixture discriminates: not every seed answers alike.
        expect(
            new Set(served.map((m) => JSON.stringify(m))).size
        ).toBeGreaterThan(1);
        const answered = await Promise.all(
            SEEDS.map((seed) => open.judge(source, { iterations: 6 }, seed))
        );
        expect(answered).toEqual(served);
    });

    it("answers the same at the review's own budget and seed, asked twice", async () => {
        const source = captured();
        const { iterations, seed } = VERDICT_PROPOSAL_CONFIG;
        const served = referenceMove(source, iterations, seed);
        expect(served).not.toBeNull();
        const twice = [
            await open.judge(source, { iterations }, seed),
            await open.judge(source, { iterations }, seed),
        ];
        expect(twice).toEqual([served, served]);
        // No clock in the budget: it would make the answer the device's.
        for (const r of workers.flatMap((w) => w.requests)) {
            expect(r).toMatchObject({ seed, deckKnowledge: source.knowledge });
            expect(r.budget).toEqual({ iterations });
        }
        expect(open.tally).toEqual({ move: 2 });
        expect(open.timings.searchMs).toHaveLength(2);
        expect(open.timings.waitMs).toHaveLength(2);
    });
});

describe("the client judge and the Bot's Brain never share a Worker", () => {
    it("a judge consult in flight leaves the Bot's Worker with the Bot's consults alone", async () => {
        answers = false;
        const source = captured();
        const judged = open.judge(source, { iterations: 6 }, 1);
        void consultBrain(source.state, "bot", { iterations: 1 });
        void consultBrain(source.state, "bot", { iterations: 1 });
        expect(workers.map((w) => w.requests.map((r) => r.botId))).toEqual([
            [source.botId],
            ["bot", "bot"],
        ]);
        // Tearing the Bot's Brain down — a rematch — leaves the judge alone.
        disposeBrain();
        expect(workers.map((w) => w.terminated)).toEqual([false, true]);
        open.close();
        expect(await judged).toBeNull();
        expect(workers[0].terminated).toBe(true);
        // Leaving is no failure of the judge.
        expect(open.tally).toEqual({});
    });
});
