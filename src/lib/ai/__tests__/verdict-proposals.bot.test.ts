// Verdict Proposals (issue #3984, GLOSSARY.md § Verdict Proposal, PRD #3980):
// the human seat's decisions are RECORDED during a vs-Bot game and JUDGED only
// at its end.
//
// Each block guards one acceptance line of the issue:
//   - the play-time path never consults the Brain — watched through the
//     search's OWN root-decision sink, not a mock: every search the engine
//     runs reports there, whoever calls it;
//   - a captured source is the deciding seat's view only;
//   - the player's move is recovered from what they submitted, or not at all;
//   - the per-class quotas come from config and an all-agreeing game stops at
//     the agreeing quota;
//   - nothing is written anywhere: an unanswered list just goes away.
//
// And the player's own words (issue #10088): a commented decision is always
// proposed whatever the quota, survives the capture's reservoir, and every
// proposal carries the Plan in force at its seq; a solo game captures both
// seats.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { setRootDecisionSink } from "@convex/gre/ai/decisionTelemetry";
import { searchWithTrace } from "@convex/gre/search";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { Move } from "@convex/gre";
import {
    annotateHumanDecision,
    captureHumanDecision,
    clearHumanCapture,
    humanCaptureView,
    humanPlans,
    recordHumanCall,
    stateHumanPlan,
    startHumanCapture,
    takeHumanDecisions,
    type CapturedDecision,
    type PlanStatement,
} from "../human-decision-capture";
import { observeHumanWindow } from "../human-decision-start";
import { foldDecisionCalls, identifyHumanMove } from "../human-move-match";
import { projectedToGameState } from "../state-adapter";
import {
    proposeVerdicts,
    selectProposals,
    type BrainJudge,
    type VerdictProposal,
} from "../verdict-proposals";
import {
    parseVerdictProposalConfig,
    VERDICT_PROPOSAL_CONFIG,
    type VerdictProposalConfig,
} from "../verdict-proposal-config";
import {
    clearVerdictProposals,
    getVerdictProposals,
    setVerdictProposals,
} from "../verdict-proposal-store";
import type { TappedMutation } from "../mutation-tap";

const GAME = "game-3984";

/** The human ("me") on their own main phase: a land to play, a Bolt to cast
 *  at the opponent's Bears, and an opponent holding two cards nobody at this
 *  table may see. */
const HUMAN_MAIN_PHASE: ScenarioSpec = {
    cards: [
        { name: "Mountain", owner: "me", zone: "battlefield" },
        { name: "Mountain", owner: "me", zone: "hand" },
        { name: "Lightning Bolt", owner: "me", zone: "hand" },
        { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        { name: "Giant Growth", owner: "opp", zone: "hand" },
        { name: "Llanowar Elves", owner: "opp", zone: "hand" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

function board(spec: ScenarioSpec = HUMAN_MAIN_PHASE): {
    state: GameState;
    human: string;
    bot: string;
} {
    const state = buildBladeState({
        label: "verdict-proposals fixture",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
    return {
        state,
        human: state.players[0].id,
        bot: state.players[1].id,
    };
}

function handCard(state: GameState, seat: string, name: string) {
    const card = state.players
        .find((p) => p.id === seat)!
        .hand.find((c) => c.card.id === getCardByName(name).id);
    if (!card) throw new Error(`fixture: no ${name} in ${seat}'s hand`);
    return card;
}

const call = (
    name: string,
    seat: string,
    args: Record<string, unknown> = {}
): TappedMutation => ({
    name: `game:${name}`,
    args: { gameId: GAME, playerId: seat, ...args },
});

const CONFIG: VerdictProposalConfig = {
    captureLimit: 50,
    perClassQuota: 3,
    agreeingPerClass: 2,
    iterations: 8,
    seed: 7,
};

afterEach(() => {
    setRootDecisionSink(null);
    clearHumanCapture();
    clearVerdictProposals();
});

describe("issue #3984 — no Brain consult on the human seat during play", () => {
    it("observing and recording the human's windows runs no search; judging at game end does", async () => {
        const { state, human } = board();
        let searches = 0;
        setRootDecisionSink(() => {
            searches++;
        });

        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        const view = projectPublicState(state, 10, human);
        expect(observeHumanWindow(GAME, view, human, ["mountain"])).toBe(true);
        recordHumanCall(
            GAME,
            call("playCard", human, {
                cardInstanceId: handCard(state, human, "Mountain").id,
            })
        );
        // Stating a Plan and commenting the decision ask nothing of the
        // Brain either (issue #10088): its pick is computed after the game.
        expect(stateHumanPlan(GAME, human, 10, "Bolt their Bears")).toBe(true);
        expect(
            annotateHumanDecision(GAME, human, 10, {
                kind: "comment",
                text: "land first, keep Bolt up",
            })
        ).toBe(true);
        const decisions = takeHumanDecisions(GAME);
        expect(decisions).toHaveLength(1);
        expect(searches).toBe(0);

        // The control: the sink DOES see a search — the zero above is a
        // measurement, not a sink that never fires.
        await proposeVerdicts(decisions, CONFIG, searchJudge);
        expect(searches).toBeGreaterThan(0);
    });
});

/** The game-end judge, as the real search: what the Brain's Worker runs. */
const searchJudge: BrainJudge = (source, budget, seed) => {
    const position = projectedToGameState(
        source.state,
        source.knowledge,
        source.botId
    );
    const { move } = searchWithTrace(
        position,
        source.botId,
        budget,
        seed,
        source.knowledge
    );
    return Promise.resolve(move);
};

describe("issue #3984 — a captured source is the deciding seat's view only", () => {
    it("never carries the opponent's hand, and knows only the seat's own decklist", () => {
        const { state, human, bot } = board();
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        observeHumanWindow(GAME, projectPublicState(state, 10, human), human, [
            "mountain",
            "lightning-bolt",
        ]);
        recordHumanCall(GAME, call("passPriority", human));
        const [captured] = takeHumanDecisions(GAME);
        const wire = JSON.stringify(captured.source);
        for (const name of ["Giant Growth", "Llanowar Elves"]) {
            const hidden = handCard(state, bot, name);
            expect(wire).not.toContain(`"${hidden.id}"`);
            expect(wire).not.toContain(hidden.card.id);
        }
        expect(captured.source.knowledge).toEqual([
            { playerId: human, cardIds: ["mountain", "lightning-bolt"] },
        ]);
    });

    it("refuses a projection made for the OTHER seat", () => {
        const { state, human, bot } = board();
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        const botsView = projectPublicState(state, 10, bot);
        expect(
            captureHumanDecision(GAME, { state: botsView, botId: human })
        ).toBe(false);
        expect(takeHumanDecisions(GAME)).toEqual([]);
    });

    it("refuses deck knowledge of any seat but the deciding one", () => {
        const { state, human, bot } = board();
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        expect(
            captureHumanDecision(GAME, {
                state: projectPublicState(state, 10, human),
                botId: human,
                knowledge: [
                    { playerId: human, cardIds: ["mountain"] },
                    { playerId: bot, cardIds: ["giant-growth"] },
                ],
            })
        ).toBe(false);
    });
});

describe("issue #3984 — the player's move, recovered from what they submitted", () => {
    it("names the land the player played", async () => {
        const { state, human } = board();
        const land = handCard(state, human, "Mountain");
        const move = await identifyHumanMove(
            projectedToGameState(projectPublicState(state, 10, human)),
            human,
            [call("playCard", human, { cardInstanceId: land.id })]
        );
        expect(move).toEqual({ kind: "play-land", cardInstanceId: land.id });
    });

    it("names a cast by its card and target, whatever the player tapped to pay", async () => {
        const { state, human, bot } = board();
        const bolt = handCard(state, human, "Lightning Bolt");
        const bears = state.players.find((p) => p.id === bot)!.battlefield[0];
        const mountain = state.players.find((p) => p.id === human)!
            .battlefield[0];
        const move = await identifyHumanMove(
            projectedToGameState(projectPublicState(state, 10, human)),
            human,
            [
                // The fields `useHandCardCommit` sends, as it sends them — on
                // the hold-priority click, the one the executor never makes.
                call("announceCast", human, {
                    cardInstanceId: bolt.id,
                    keepPriority: true,
                    chosenX: undefined,
                    chosenModeIds: undefined,
                    alternativeCostId: undefined,
                    kickerPayments: undefined,
                    buyback: undefined,
                    payFlashSurcharge: false,
                    phyrexianLifePips: undefined,
                    additionalCostLegId: undefined,
                    chosenXColors: undefined,
                }),
                call("selectTarget", human, {
                    targetType: "permanent",
                    targetId: bears.id,
                }),
                call("tapUntap", human, { cardInstanceId: mountain.id }),
            ]
        );
        expect(move?.kind).toBe("cast-spell");
        expect(JSON.stringify(move)).toContain(bolt.id);
        expect(JSON.stringify(move)).toContain(bears.id);
    });

    it("names nothing when no legal move realises the window", async () => {
        const { state, human } = board();
        const bolt = handCard(state, human, "Lightning Bolt");
        const move = await identifyHumanMove(
            projectedToGameState(projectPublicState(state, 10, human)),
            human,
            [
                call("announceCast", human, { cardInstanceId: bolt.id }),
                call("cancelCast", human),
            ]
        );
        expect(move).toBeNull();
    });

    it("folds one-by-one attack clicks and a batched declaration alike", () => {
        const seats = new Set(["p1", "p2"]);
        const clicks = foldDecisionCalls(
            [
                call("toggleAttacker", "p1", { cardInstanceId: "b" }),
                call("toggleAttacker", "p1", { cardInstanceId: "a" }),
                call("toggleAttacker", "p1", { cardInstanceId: "c" }),
                call("toggleAttacker", "p1", { cardInstanceId: "c" }),
                call("confirmAttackers", "p1"),
            ],
            seats
        );
        const batch = foldDecisionCalls(
            [
                call("declareAttackers", "p1", {
                    attackerIds: ["a", "b"],
                    attackTargets: { a: "p2", b: "p2" },
                }),
                call("confirmAttackers", "p1"),
            ],
            seats
        );
        expect(clicks).toBe(batch);
    });

    // CR 508.1g / 702.154a — the Brain's candidate carries the cost on the batch;
    // the player's clicks reach it through `toggleEnlist`.
    it("folds an enlist click and a batched enlist alike, and apart from no enlist", () => {
        const seats = new Set(["p1", "p2"]);
        const pair = { attackerId: "a", enlistedId: "w" };
        const attack = call("toggleAttacker", "p1", { cardInstanceId: "a" });
        const confirm = call("confirmAttackers", "p1");
        const clicks = foldDecisionCalls(
            [attack, call("toggleEnlist", "p1", pair), confirm],
            seats
        );
        const batch = foldDecisionCalls(
            [
                call("declareAttackers", "p1", {
                    attackerIds: ["a"],
                    enlists: [pair],
                }),
                confirm,
            ],
            seats
        );
        const plain = foldDecisionCalls([attack, confirm], seats);
        expect(clicks).toBe(batch);
        expect(clicks).not.toBe(plain);
    });

    it("the same enlist click twice withdraws the choice", () => {
        const seats = new Set(["p1", "p2"]);
        const pair = { attackerId: "a", enlistedId: "w" };
        const attack = call("toggleAttacker", "p1", { cardInstanceId: "a" });
        const confirm = call("confirmAttackers", "p1");
        expect(
            foldDecisionCalls(
                [
                    attack,
                    call("toggleEnlist", "p1", pair),
                    call("toggleEnlist", "p1", pair),
                    confirm,
                ],
                seats
            )
        ).toBe(foldDecisionCalls([attack, confirm], seats));
    });
});

/** The human attacking: two Bears able to attack, the declaration owed. */
const HUMAN_DECLARES_ATTACKERS: ScenarioSpec = {
    cards: [
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Grizzly Bears", owner: "me", zone: "battlefield" },
        { name: "Llanowar Elves", owner: "opp", zone: "hand" },
    ],
    phase: "DECLARE_ATTACKERS",
    turn: 3,
    landCount: 0,
    libraryCount: 20,
};

describe("issue #3984 — decision windows follow the decision, not the save", () => {
    it("one attack clicked creature by creature is ONE decision, identified as that attack", async () => {
        const { state, human } = board(HUMAN_DECLARES_ATTACKERS);
        const [a, b] = state.players[0].battlefield.map((c) => c.id);
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        // Every click is a save, and the engine still owes the declaration
        // after each — the views the subscription delivers in between.
        observeHumanWindow(
            GAME,
            projectPublicState(state, 20, human),
            human,
            undefined
        );
        recordHumanCall(
            GAME,
            call("toggleAttacker", human, { cardInstanceId: a })
        );
        observeHumanWindow(
            GAME,
            projectPublicState(state, 21, human),
            human,
            undefined
        );
        recordHumanCall(
            GAME,
            call("toggleAttacker", human, { cardInstanceId: b })
        );
        observeHumanWindow(
            GAME,
            projectPublicState(state, 22, human),
            human,
            undefined
        );
        recordHumanCall(GAME, call("confirmAttackers", human));
        const decisions = takeHumanDecisions(GAME);
        expect(decisions).toHaveLength(1);
        const move = await identifyHumanMove(
            projectedToGameState(decisions[0].source.state),
            human,
            decisions[0].calls
        );
        expect(move?.kind).toBe("declare-attackers");
        expect(JSON.stringify(move)).toContain(`"${a}"`);
        expect(JSON.stringify(move)).toContain(`"${b}"`);
    });

    it("a window that is no decision closes the open one: an auto-pass there joins nothing", () => {
        const { state, human } = board();
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        observeHumanWindow(
            GAME,
            projectPublicState(state, 30, human),
            human,
            undefined
        );
        const land = handCard(state, human, "Mountain");
        recordHumanCall(
            GAME,
            call("playCard", human, { cardInstanceId: land.id })
        );
        // The Bot's end step, the human holding nothing castable: a trivial
        // pass the Bot's own gate would not think about.
        const endStep = structuredClone(state);
        endStep.phase = "END_STEP";
        endStep.activePlayerId = endStep.players[1].id;
        endStep.priorityPlayerId = human;
        endStep.players[0].hand = endStep.players[0].hand.filter(
            (c) => c.id === land.id
        );
        expect(
            observeHumanWindow(
                GAME,
                projectPublicState(endStep, 31, human),
                human,
                undefined
            )
        ).toBe(false);
        recordHumanCall(GAME, call("passPriority", human));
        const decisions = takeHumanDecisions(GAME);
        expect(decisions).toHaveLength(1);
        expect(decisions[0].calls.map((c) => c.name)).toEqual([
            "game:playCard",
        ]);
    });
});

/** `n` copies of one decision, each its own seq — a game that offered the
 *  same land drop over and over. */
function landDrops(n: number): CapturedDecision[] {
    const { state, human } = board();
    const land = handCard(state, human, "Mountain");
    return Array.from({ length: n }, (_, i) => ({
        source: {
            state: projectPublicState(state, 100 + i, human),
            botId: human,
        },
        calls: [call("playCard", human, { cardInstanceId: land.id })],
    }));
}

/** The land every `landDrops` decision plays. */
function landDropMove(): Move {
    const { state, human } = board();
    return {
        kind: "play-land",
        cardInstanceId: handCard(state, human, "Mountain").id,
    } as Move;
}

/** A judge that always picks the player's own move (or always a pass). */
function fixedJudge(answer: "agree" | "disagree"): {
    judge: BrainJudge;
    consults: () => number;
} {
    let consults = 0;
    const judge: BrainJudge = async () => {
        consults++;
        return answer === "agree" ? landDropMove() : { kind: "pass" };
    };
    return { judge, consults: () => consults };
}

describe("issue #3984 — quotas per Decision Class, from config", () => {
    it("a game of only agreeing decisions yields the agreeing quota per class, and stops there", async () => {
        const { judge, consults } = fixedJudge("agree");
        const list = await proposeVerdicts(landDrops(6), CONFIG, judge);
        expect(consults()).toBe(CONFIG.perClassQuota);
        expect(list.proposals).toHaveLength(CONFIG.agreeingPerClass);
        expect(list.proposals.every((p) => p.agrees)).toBe(true);
        expect(
            list.proposals.every((p) => p.decisionClass === "land-drop")
        ).toBe(true);
    });

    it("disagreements fill the class up to its quota", async () => {
        const { judge } = fixedJudge("disagree");
        const list = await proposeVerdicts(landDrops(6), CONFIG, judge);
        expect(list.proposals).toHaveLength(CONFIG.perClassQuota);
        expect(list.proposals.some((p) => p.agrees)).toBe(false);
    });

    it("asks about every sampled decision at once, and keeps each answer with its decision whichever ends first", async () => {
        const answer: ((move: Move | null) => void)[] = [];
        const progress: [number, number][] = [];
        const listed = proposeVerdicts(
            landDrops(6),
            { ...CONFIG, perClassQuota: 3 },
            () => new Promise((resolve) => answer.push(resolve)),
            (done, total) => progress.push([done, total])
        );
        await vi.waitFor(() => expect(answer).toHaveLength(3));
        expect(progress).toEqual([[0, 3]]);
        answer[2](landDropMove());
        answer[1]({ kind: "pass" });
        await vi.waitFor(() =>
            expect(progress).toEqual([
                [0, 3],
                [1, 3],
                [2, 3],
            ])
        );
        answer[0](null);
        const list = await listed;
        expect(progress[progress.length - 1]).toEqual([3, 3]);
        expect(list.unjudged).toBe(1);
        // Each answer stays with the decision it was asked about: the first
        // has none, the second disagreed, the last agreed.
        const [disagreed, agreed] = list.proposals;
        expect(list.proposals.map((p) => p.agrees)).toEqual([false, true]);
        expect(disagreed.source.state.seq).toBeLessThan(
            agreed.source.state.seq
        );
    });

    it("puts disagreements first, then the agreeing share", () => {
        const p = (agrees: boolean, seq: number) =>
            ({
                agrees,
                decisionClass: "cast",
                source: { botId: "x", state: { seq } },
            }) as unknown as VerdictProposal;
        const picked = selectProposals(
            [p(true, 1), p(false, 2), p(true, 3), p(false, 4), p(true, 5)],
            1
        );
        expect(picked.map((x) => [x.agrees, x.source.state.seq])).toEqual([
            [false, 2],
            [false, 4],
            [true, 1],
        ]);
    });

    it("counts a decision no move realises as unidentified, never as a proposal", async () => {
        const [decision] = landDrops(1);
        const { judge, consults } = fixedJudge("agree");
        const list = await proposeVerdicts(
            [{ ...decision, calls: [call("endTurn", decision.source.botId)] }],
            CONFIG,
            judge
        );
        expect(list).toMatchObject({ captured: 1, unidentified: 1 });
        expect(list.proposals).toEqual([]);
        expect(consults()).toBe(0);
    });

    it("the shipped quotas are tolaria.config.json § verdictProposals, read as written", () => {
        const raw = JSON.parse(
            readFileSync(
                join(__dirname, "../../../../tolaria.config.json"),
                "utf8"
            )
        ).verdictProposals;
        expect(VERDICT_PROPOSAL_CONFIG).toEqual(raw);
    });

    it("refuses a block that does not read, naming the field", () => {
        expect(() =>
            parseVerdictProposalConfig({ ...CONFIG, perClassQuota: 0 })
        ).toThrow(/perClassQuota/);
        expect(() =>
            parseVerdictProposalConfig({
                ...CONFIG,
                agreeingPerClass: CONFIG.perClassQuota + 1,
            })
        ).toThrow(/agreeingPerClass/);
        expect(() => parseVerdictProposalConfig(undefined)).toThrow(
            /verdictProposals/
        );
    });
});

describe("issue #3984 — the capture is bounded", () => {
    it("keeps at most captureLimit decisions, in game order", () => {
        const { state, human } = board();
        startHumanCapture(GAME, human, { limit: 3, seed: 1 });
        for (let seq = 1; seq <= 9; seq++) {
            captureHumanDecision(GAME, {
                state: projectPublicState(state, seq, human),
                botId: human,
            });
            recordHumanCall(GAME, call("passPriority", human));
        }
        const kept = takeHumanDecisions(GAME).map((d) => d.source.state.seq);
        expect(kept).toHaveLength(3);
        expect(kept).toEqual([...kept].sort((a, b) => a - b));
    });
});

describe("issue #3984 — nothing is written; an unanswered list disappears", () => {
    it("the list lives in client memory and is gone once cleared", async () => {
        const { judge } = fixedJudge("disagree");
        const list = await proposeVerdicts(landDrops(2), CONFIG, judge);
        setVerdictProposals(GAME, list);
        expect(getVerdictProposals(GAME)?.proposals).toHaveLength(2);
        clearVerdictProposals();
        expect(getVerdictProposals(GAME)).toBeNull();
    });

    it("no module on the proposal path can reach the Verdict Store", () => {
        for (const file of [
            "../verdict-proposals.ts",
            "../verdict-proposal-store.ts",
            "../human-decision-capture.ts",
            "../human-decision-start.ts",
            "../human-move-match.ts",
            "../../../hooks/useVerdictProposalCapture.ts",
        ]) {
            const source = readFileSync(join(__dirname, file), "utf8");
            expect(source, file).not.toMatch(/api\.verdicts\b/);
            expect(source, file).not.toMatch(/convex\/verdicts/);
        }
    });
});

/** `landDrops` with the decisions at `indexes` commented. */
function commentedLandDrops(n: number, indexes: number[]): CapturedDecision[] {
    return landDrops(n).map((d, i) =>
        indexes.includes(i)
            ? { ...d, annotation: { kind: "comment", text: `why ${i}` } }
            : d
    );
}

describe("issue #10088 — a commented decision is always proposed, whatever the quota says", () => {
    it("every commented decision is judged and proposed, past the class quota and the agreeing share", async () => {
        const { judge, consults } = fixedJudge("agree");
        const list = await proposeVerdicts(
            commentedLandDrops(6, [0, 2, 4, 5]),
            CONFIG,
            judge
        );
        // Four commented land drops, one class whose quota is three and
        // whose agreeing share is two: all four, and nothing else.
        expect(consults()).toBe(4);
        expect(
            list.proposals.map((p) => [p.source.state.seq, p.rationale])
        ).toEqual([
            [100, "why 0"],
            [102, "why 2"],
            [104, "why 4"],
            [105, "why 5"],
        ]);
    });

    it("sampling fills the rest of the class around the commented ones", async () => {
        const { judge, consults } = fixedJudge("agree");
        const list = await proposeVerdicts(
            commentedLandDrops(6, [3]),
            CONFIG,
            judge
        );
        expect(consults()).toBe(CONFIG.perClassQuota);
        expect(list.proposals).toHaveLength(CONFIG.agreeingPerClass);
        expect(list.proposals.filter((p) => p.rationale)).toEqual([
            expect.objectContaining({ rationale: "why 3" }),
        ]);
    });

    it("an obvious mark is carried, but never bypasses the sample", async () => {
        const { judge, consults } = fixedJudge("agree");
        const obvious = landDrops(6).map(
            (d): CapturedDecision => ({ ...d, annotation: { kind: "obvious" } })
        );
        const list = await proposeVerdicts(obvious, CONFIG, judge);
        expect(consults()).toBe(CONFIG.perClassQuota);
        expect(list.proposals).toHaveLength(CONFIG.agreeingPerClass);
        expect(list.proposals.every((p) => p.obvious === true)).toBe(true);
        expect(list.proposals.some((p) => p.rationale !== undefined)).toBe(
            false
        );
    });

    it("the capture's reservoir never drops a commented decision", () => {
        const { state, human } = board();
        startHumanCapture(GAME, human, { limit: 3, seed: 1 });
        for (let seq = 1; seq <= 9; seq++) {
            captureHumanDecision(GAME, {
                state: projectPublicState(state, seq, human),
                botId: human,
            });
            recordHumanCall(GAME, call("passPriority", human));
            if (seq === 1 || seq === 2) {
                annotateHumanDecision(GAME, human, seq, {
                    kind: "comment",
                    text: `seq ${seq}`,
                });
            }
        }
        const kept = takeHumanDecisions(GAME);
        // Three from the reservoir, plus the two pinned by their comment.
        expect(kept).toHaveLength(5);
        expect(
            kept
                .filter((d) => d.annotation?.kind === "comment")
                .map((d) => d.source.state.seq)
        ).toEqual([1, 2]);
    });

    it("a comment made after the decision closed still pins it", () => {
        const { state, human } = board();
        startHumanCapture(GAME, human, { limit: 1, seed: 1 });
        for (let seq = 1; seq <= 3; seq++) {
            captureHumanDecision(GAME, {
                state: projectPublicState(state, seq, human),
                botId: human,
            });
            recordHumanCall(GAME, call("passPriority", human));
        }
        // On seq 3 now; seq 1 filled the one-slot reservoir — comment it.
        expect(
            annotateHumanDecision(GAME, human, 1, {
                kind: "comment",
                text: "the first one",
            })
        ).toBe(true);
        expect(humanCaptureView(GAME, human).decision?.seq).toBe(3);
        const seqs = takeHumanDecisions(GAME).map((d) => d.source.state.seq);
        expect(seqs).toContain(1);
    });
});

describe("issue #10088 — each proposal carries the Plan in force at its seq", () => {
    it("a Plan stands until another is stated, and a mid-turn change governs only what follows it", async () => {
        const decisions = landDrops(6);
        const seat = decisions[0].source.botId;
        const plans: PlanStatement[] = [
            { seatId: seat, text: "A: develop", seq: 100 },
            { seatId: "someone-else", text: "not mine", seq: 101 },
            // Changed mid-turn, on the state of the fourth decision.
            { seatId: seat, text: "B: hold up Bolt", seq: 103 },
        ];
        const { judge } = fixedJudge("disagree");
        const list = await proposeVerdicts(
            decisions,
            { ...CONFIG, perClassQuota: 6, agreeingPerClass: 6 },
            judge,
            undefined,
            plans
        );
        expect(
            list.proposals.map((p) => [p.source.state.seq, p.plan?.text])
        ).toEqual([
            [100, "A: develop"],
            [101, "A: develop"],
            [102, "A: develop"],
            [103, "B: hold up Bolt"],
            [104, "B: hold up Bolt"],
            [105, "B: hold up Bolt"],
        ]);
        expect(list.proposals[4].plan).toEqual({
            text: "B: hold up Bolt",
            seq: 103,
        });
    });

    it("a decision before any Plan carries none", async () => {
        const decisions = landDrops(2);
        const seat = decisions[0].source.botId;
        const { judge } = fixedJudge("disagree");
        const list = await proposeVerdicts(
            decisions,
            CONFIG,
            judge,
            undefined,
            [{ seatId: seat, text: "later", seq: 101 }]
        );
        expect(list.proposals.map((p) => p.plan?.text)).toEqual([
            undefined,
            "later",
        ]);
    });

    it("the capture keeps every statement, refusing blank words and other seats", () => {
        const { human, bot } = board();
        startHumanCapture(GAME, human, { limit: 3, seed: 1 });
        expect(stateHumanPlan(GAME, human, 4, "  race  ")).toBe(true);
        expect(stateHumanPlan(GAME, human, 5, "   ")).toBe(false);
        expect(stateHumanPlan(GAME, bot, 5, "the Bot's plan")).toBe(false);
        expect(stateHumanPlan(GAME, human, 9, "stabilise")).toBe(true);
        expect(humanPlans(GAME)).toEqual([
            { seatId: human, text: "race", seq: 4 },
            { seatId: human, text: "stabilise", seq: 9 },
        ]);
        expect(humanCaptureView(GAME, human).plan?.text).toBe("stabilise");
    });
});

describe("issue #10088 — a solo game captures both seats", () => {
    it("decisions of either seat are kept, each call attributed to its own seat's decision", () => {
        const { state, human, bot } = board();
        startHumanCapture(GAME, [human, bot], { limit: 10, seed: 1 });
        expect(
            captureHumanDecision(GAME, {
                state: projectPublicState(state, 1, human),
                botId: human,
            })
        ).toBe(true);
        recordHumanCall(GAME, call("passPriority", human));
        // The other seat's call while the first seat's decision is open
        // belongs to no decision.
        recordHumanCall(GAME, call("passPriority", bot));
        expect(
            captureHumanDecision(GAME, {
                state: projectPublicState(state, 2, bot),
                botId: bot,
            })
        ).toBe(true);
        recordHumanCall(GAME, call("passPriority", bot));
        expect(stateHumanPlan(GAME, bot, 2, "second seat plan")).toBe(true);
        expect(
            annotateHumanDecision(GAME, bot, 2, {
                kind: "comment",
                text: "second seat words",
            })
        ).toBe(true);
        const kept = takeHumanDecisions(GAME);
        expect(
            kept.map((d) => [d.source.botId, d.calls.length, d.annotation])
        ).toEqual([
            [human, 1, undefined],
            [bot, 1, { kind: "comment", text: "second seat words" }],
        ]);
    });

    it("still refuses a seat the capture does not hold", () => {
        const { state, human, bot } = board();
        startHumanCapture(GAME, human, { limit: 10, seed: 1 });
        expect(
            captureHumanDecision(GAME, {
                state: projectPublicState(state, 1, bot),
                botId: bot,
            })
        ).toBe(false);
    });
});
