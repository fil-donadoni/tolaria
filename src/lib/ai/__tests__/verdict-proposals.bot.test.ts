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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildBladeState } from "@convex/gre/ai/blade/runner";
import { getCardByName } from "@convex/cards";
import { setRootDecisionSink } from "@convex/gre/ai/decisionTelemetry";
import { searchWithTrace } from "@convex/gre/search";
import { projectPublicState } from "@convex/gameProjections";
import type { ScenarioSpec } from "@convex/debugScenarioSpec";
import type { GameState } from "@convex/gre/state";
import type { Move } from "@convex/gre";
import {
    captureHumanDecision,
    clearHumanCapture,
    recordHumanCall,
    startHumanCapture,
    takeHumanDecisions,
    type CapturedDecision,
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
