// The two-step kill behind a graveyard play permission (issue #10401).
//
// CR 601.2b: "A player can't apply two alternative methods of casting or two
// alternative costs to a single spell." Yawgmoth's Will states no cost, so a
// graveyard card keeps its own alternative one: at 1 life against 2, the Bot
// casts the Will and then Fireblast out of the graveyard for two Mountains.
//
// The sacrifice cast is dropped below the root because the root weighs it
// itself (`isManaBaseSacrificeCast`); the root cannot weigh a cast only one
// of its moves makes castable, so that move's subtree keeps it
// (`rootUnlockedSacrificeCasts`).
import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { applyMoveForSearch } from "../applyMove";
import { findBladeScenario } from "../ai/blade/registry";
import { buildBladeState, runBladeScenario } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import { DEFAULT_EVAL_WEIGHTS } from "../ai/evalWeights";
import { enumerateMoves, type Move } from "../moves";
import {
    makeRootScorer,
    outrewardedByWinningSibling,
    rootUnlockedSacrificeCasts,
    searchWithTrace,
    selectRootMove,
    type Edge,
    type Node,
} from "../search";
import type { RootDecisionMechanism } from "../ai/decisionTelemetry";
import {
    makeInstance,
    makePlayer,
    makeState,
} from "../../cards/__tests__/setup.helper";
import type { GameState } from "../state";

const LABEL =
    "graveyard: casts Yawgmoth's Will for the Fireblast it unlocks at lethal";
const FIREBLAST = getCardByName("Fireblast").id;
const WILL = getCardByName("Yawgmoth's Will").id;

type CastMove = Extract<Move, { kind: "cast-spell" }>;

function entry(): BladeScenario {
    const scenario = findBladeScenario(LABEL);
    if (!scenario) throw new Error(`missing blade entry: ${LABEL}`);
    return scenario;
}

const idOf = (state: GameState, cardId: string) =>
    state.players[0].hand
        .concat(state.players[0].graveyard)
        .find((c) => (c.card as { id?: string }).id === cardId)!.id;

const castsOf = (state: GameState, instanceId: string) =>
    enumerateMoves(state, state.players[0].id).filter(
        (m): m is CastMove =>
            m.kind === "cast-spell" && m.cardInstanceId === instanceId
    );

describe("the kill a graveyard play permission unlocks (CR 601.2b / 118.9)", () => {
    it("casts Yawgmoth's Will, then Fireblast from the graveyard for its sacrifice, and wins", () => {
        const scenario = entry();
        for (const seed of [0xb1ade, 1, 2]) {
            const root = buildBladeState(scenario);
            const botId = root.players[0].id;
            const oppId = root.players[1].id;
            const fireblast = idOf(root, FIREBLAST);

            const first = searchWithTrace(
                root,
                botId,
                scenario.budget,
                seed
            ).move;
            expect(first).toMatchObject({
                kind: "cast-spell",
                cardInstanceId: idOf(root, WILL),
            });

            const permitted = applyMoveForSearch(root, botId, first!);
            const second = searchWithTrace(
                permitted,
                botId,
                scenario.budget,
                seed
            ).move;
            expect(second).toMatchObject({
                kind: "cast-spell",
                cardInstanceId: fireblast,
                castFromZone: "graveyard",
                alternativeCostId: "sacrifice-two-mountains",
                targets: [{ type: "player", id: oppId }],
            });
            // The sacrifice paid for it: no land tapped.
            expect((second as CastMove).tapPlan).toEqual([]);

            const over = applyMoveForSearch(permitted, botId, second!);
            expect(over.gameOver?.winnerId).toBe(botId);
        }
    });

    it("the blade entry holds on every seed", () => {
        expect(runBladeScenario(entry()).failureMessage).toBe("");
    });
});

describe("rootUnlockedSacrificeCasts — the sacrifice casts a root move makes castable", () => {
    const position = () => {
        const state = buildBladeState(entry());
        const botId = state.players[0].id;
        return { state, botId, moves: enumerateMoves(state, botId) };
    };

    it("names the graveyard Fireblast under the Will's root edge, and under no other", () => {
        const { state, botId, moves } = position();
        // Not castable at the root: no permission yet.
        expect(castsOf(state, idOf(state, FIREBLAST))).toEqual([]);
        const unlocked = rootUnlockedSacrificeCasts(state, botId, moves)!;
        expect(unlocked.size).toBe(1);
        const [[, casts]] = [...unlocked];
        expect([...casts]).toEqual([
            `${idOf(state, FIREBLAST)}|sacrifice-two-mountains|graveyard`,
        ]);
    });

    it("unlocks nothing for a sacrifice cast the root already offers", () => {
        const { state, botId } = position();
        // The same Fireblast in HAND: the root weighs its sacrifice itself.
        const bot = state.players[0];
        const at = bot.graveyard.findIndex(
            (c) => (c.card as { id?: string }).id === FIREBLAST
        );
        const [card] = bot.graveyard.splice(at, 1);
        card.zone = "hand";
        bot.hand.push(card);
        const moves = enumerateMoves(state, botId);
        expect(castsOf(state, card.id).some((m) => m.alternativeCostId)).toBe(
            true
        );
        expect(rootUnlockedSacrificeCasts(state, botId, moves)).toBeUndefined();
    });

    it("leaves a land drop out: the cast it pays for is the next decision's to weigh", () => {
        // Fireblast in hand, one Mountain down and one to play: the drop makes
        // the sacrifice payable, and it is taken on outcome-equality anyway.
        const state = buildBladeState({
            label: "land drop before a sacrifice cast",
            spec: {
                cards: [
                    { name: "Fireblast", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "me", zone: "hand" },
                    { name: "Mountain", owner: "me", zone: "battlefield" },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 5,
                landCount: 0,
                libraryCount: 20,
            },
            bot: "me",
            budget: { iterations: 1 },
            tier: "must",
            expect: { moves: [{ kind: "play-land" }] },
        });
        const botId = state.players[0].id;
        const moves = enumerateMoves(state, botId);
        const drop = moves.find((m) => m.kind === "play-land")!;
        const fireblast = idOf(state, FIREBLAST);
        expect(castsOf(state, fireblast)).toEqual([]);
        expect(
            castsOf(applyMoveForSearch(state, botId, drop), fireblast).some(
                (m) => m.alternativeCostId
            )
        ).toBe(true);
        expect(rootUnlockedSacrificeCasts(state, botId, moves)).toBeUndefined();
    });

    it("is silent on a position holding no sacrifice cost at all", () => {
        const { state, botId } = position();
        const bot = state.players[0];
        bot.graveyard = bot.graveyard.filter(
            (c) => (c.card as { id?: string }).id !== FIREBLAST
        );
        expect(
            rootUnlockedSacrificeCasts(
                state,
                botId,
                enumerateMoves(state, botId)
            )
        ).toBeUndefined();
    });
});

describe("hold-trick stands down before a sibling that wins (issue #10401)", () => {
    const weights = DEFAULT_EVAL_WEIGHTS;
    const edge = (key: string, visits: number, meanReward: number): Edge => ({
        move: { kind: "pass" },
        key,
        mover: "p1",
        node: { children: new Map() },
        visits,
        totalReward: meanReward * visits,
        totalMargin: 0,
        avail: visits,
    });
    const rootOf = (edges: Edge[]): Node => ({
        children: new Map(edges.map((e) => [e.key, e])),
    });

    // p1's own main phase: Giant Growth on its own Bears is the trick dumped
    // at sorcery speed, and `pass` is outcome-equal to it.
    const trickRoot = (kill: boolean) => {
        const state = makeState({
            phase: "PRECOMBAT_MAIN",
            activePlayerId: "p1",
            priorityPlayerId: "p1",
            players: [
                makePlayer("p1", {
                    hand: [
                        makeInstance(getCardByName("Giant Growth").id, {
                            id: "growth",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                        makeInstance(getCardByName("Lava Spike").id, {
                            id: "spike",
                            controllerId: "p1",
                            ownerId: "p1",
                            zone: "hand",
                        }),
                    ],
                    battlefield: [
                        makeInstance(getCardByName("Grizzly Bears").id, {
                            id: "bears",
                        }),
                        makeInstance(getCardByName("Forest").id, {
                            id: "forest",
                        }),
                        makeInstance(getCardByName("Mountain").id, {
                            id: "mountain",
                        }),
                    ],
                }),
                makePlayer("p2", { life: 3 }),
            ],
        });
        const moves = enumerateMoves(state, "p1");
        const dump = moves.find(
            (m): m is CastMove =>
                m.kind === "cast-spell" && m.cardInstanceId === "growth"
        )!;
        const spike = moves.find(
            (m): m is CastMove =>
                m.kind === "cast-spell" && m.cardInstanceId === "spike"
        )!;
        const edges = [
            { ...edge("dump", 100, 0.5), move: dump as Move },
            edge("pass", 100, 0.48),
            // Under-visited, so outside the visit band the pick is read from.
            ...(kill ? [{ ...edge("kill", 6, 0.9), move: spike as Move }] : []),
        ];
        const out = { mechanism: "mean-reward" as RootDecisionMechanism };
        const picked = selectRootMove(
            rootOf(edges),
            moves,
            state,
            "p1",
            undefined,
            weights,
            undefined,
            out
        );
        return { picked, mechanism: out.mechanism };
    };

    it("control: with no winning sibling the rule holds the trick", () => {
        const { picked, mechanism } = trickRoot(false);
        expect(picked.kind).toBe("pass");
        expect(mechanism).toBe("hold-trick");
    });

    it("never takes `pass` over a sibling whose line wins", () => {
        const { picked, mechanism } = trickRoot(true);
        expect(picked.kind).not.toBe("pass");
        expect(mechanism).not.toBe("hold-trick");
    });

    it("a sibling in the won band, clear of the hold by more than OUTCOME_EPS, out-rewards it", () => {
        const hold = edge("pass", 100, 0.48);
        const dump = edge("dump", 100, 0.5);
        // Under-visited: the visit band keeps it from being the pick.
        const kill = edge("kill", 6, 0.9);
        const pool = [hold, dump, kill];
        const { mean } = makeRootScorer(rootOf(pool), weights);
        expect(outrewardedByWinningSibling(pool, hold, mean, weights)).toBe(
            true
        );
    });

    it("an outcome-equal dump alone leaves the hold standing", () => {
        const hold = edge("pass", 100, 0.48);
        const dump = edge("dump", 100, 0.5);
        const pool = [hold, dump];
        const { mean } = makeRootScorer(rootOf(pool), weights);
        expect(outrewardedByWinningSibling(pool, hold, mean, weights)).toBe(
            false
        );
    });

    it("a better sibling short of the won band leaves the hold standing", () => {
        const hold = edge("pass", 100, 0.48);
        const better = edge("better", 6, 0.7);
        const pool = [hold, better];
        const { mean } = makeRootScorer(rootOf(pool), weights);
        expect(outrewardedByWinningSibling(pool, hold, mean, weights)).toBe(
            false
        );
    });

    it("a board won on every line leaves the hold standing", () => {
        // Every edge reads in the won band, the hold included: nothing here
        // is a win the hold would decline.
        const hold = edge("pass", 100, 0.88);
        const dump = edge("dump", 100, 0.9);
        const pool = [hold, dump];
        const { mean } = makeRootScorer(rootOf(pool), weights);
        expect(outrewardedByWinningSibling(pool, hold, mean, weights)).toBe(
            false
        );
    });
});
