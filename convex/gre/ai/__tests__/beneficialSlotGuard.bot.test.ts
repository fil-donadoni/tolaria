// Issue #9044 (PRD #9043) — the beneficial-slot guard: a pure gift aimed at a
// player (a draw, a life gain) is never handed to the opponent's face while a
// sibling variant aimed at the Bot is legal, WHATEVER the rollouts' mean
// reward says. `announcement-variant`'s misdirection penalty only ranks
// siblings inside `outcomeEps`; these roots put the misdirected variant 0.3
// of mean reward ahead, far outside it, which the preference never reaches.
//
// Hand-built roots (the `selectRootMove` prior art of `search.bot.test.ts`
// and `beneficence.bot.test.ts`): deterministic, and the only way to build
// the reward gap on purpose. The registry entry at the bottom is the search
// seen whole on the reported position.
import { describe, expect, it } from "vitest";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import { enumerateMoves } from "../../moves";
import { buildBladeState } from "../blade/build";
import { seatPlayerId } from "../blade/matcher";
import { BLADE_SCENARIOS } from "../blade/scenarios";
import type { BladeScenario } from "../blade/types";
import { misdirectedPlayerGiftCount } from "../beneficence";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import type { RootDecisionMechanism } from "../decisionTelemetry";
import {
    searchWithTrace,
    selectRootMove,
    type Edge,
    type Node,
} from "../../search";
import { getDefinition, withTemporaryDefinition } from "../../../cards";
import type { CardDefinition } from "../../../cards/types";

const ANCESTRAL_RECALL_ID = "70e7ddf2-5604-41e7-bb9d-ddd03d3e9d0b";

type Cast = Extract<Move, { kind: "cast-spell" }>;

function build(spec: BladeScenario["spec"]): GameState {
    return buildBladeState({
        label: "beneficial-slot-guard-unit",
        spec,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    });
}

/** One gift spell in the Bot's hand, mana open: at the opponent's end step
 *  for an instant, in the Bot's own main phase for a sorcery. */
function giftBoard(spell: string, lands: number, sorcery = false): GameState {
    return build({
        cards: [
            { name: spell, owner: "me", zone: "hand" },
            { name: "Island", owner: "me", zone: "battlefield", count: lands },
            { name: "Forest", owner: "me", zone: "battlefield", count: lands },
        ],
        phase: sorcery ? "PRECOMBAT_MAIN" : "END_STEP",
        turn: 6,
        libraryCount: 20,
        activePlayer: sorcery ? "me" : "opp",
        priority: "me",
    });
}

/** The two player-targeted casts of the one spell in hand: at the Bot and at
 *  the opponent, the first X the enumerator offers for each. */
function playerVariants(state: GameState): { self: Cast; opp: Cast } {
    const botId = state.players[0].id;
    const oppId = state.players[1].id;
    const casts = enumerateMoves(state, botId).filter(
        (m): m is Cast =>
            m.kind === "cast-spell" &&
            m.targets.length === 1 &&
            m.targets[0].type === "player" &&
            (m.chosenX === undefined || m.chosenX === 1)
    );
    const self = casts.find((m) => m.targets[0].id === botId);
    const opp = casts.find((m) => m.targets[0].id === oppId);
    if (!self || !opp) throw new Error("both player variants must be legal");
    return { self, opp };
}

function edge(move: Move, mover: string, reward: number, visits = 100): Edge {
    return {
        key: JSON.stringify(move),
        move,
        mover,
        node: { children: new Map() },
        visits,
        totalReward: reward * visits,
        totalMargin: 0,
        avail: visits,
    };
}

function nodeOf(edges: Edge[]): Node {
    return { children: new Map(edges.map((e) => [e.key, e])) };
}

/** `selectRootMove` on a root where the OPPONENT-aimed variant leads the
 *  self-aimed one by 0.3 of mean reward. */
function pickWithOppLeading(
    state: GameState,
    disabled: ReadonlySet<RootDecisionMechanism> = new Set()
): { move: Move; mechanism: RootDecisionMechanism; self: Cast; opp: Cast } {
    const botId = state.players[0].id;
    const { self, opp } = playerVariants(state);
    const out = { mechanism: "mean-reward" as RootDecisionMechanism };
    const move = selectRootMove(
        nodeOf([edge(self, botId, 0.2), edge(opp, botId, 0.5)]),
        [self, opp],
        state,
        botId,
        undefined,
        DEFAULT_EVAL_WEIGHTS,
        undefined,
        out,
        undefined,
        disabled
    );
    return { move, mechanism: out.mechanism, self, opp };
}

describe("beneficial-slot guard — selectRootMove (issue #9044)", () => {
    it("a draw led by its opponent-aimed twin by 0.3 still goes to the Bot, by announcement-variant", () => {
        const state = giftBoard("Ancestral Recall", 1);
        const { move, mechanism, self } = pickWithOppLeading(state);
        expect(move).toEqual(self);
        expect(mechanism).toBe("announcement-variant");
    });

    it("the class, not the card: a life gain (Stream of Life, X = 1) is guarded the same way", () => {
        const state = giftBoard("Stream of Life", 2, true);
        const { move, mechanism, self } = pickWithOppLeading(state);
        expect(move).toEqual(self);
        expect(mechanism).toBe("announcement-variant");
    });

    it("decking: with two cards left in the opponent's library the draw goes to them", () => {
        const state = giftBoard("Ancestral Recall", 1);
        state.players[1].library = state.players[1].library.slice(0, 2);
        const { move, opp, mechanism } = pickWithOppLeading(state);
        expect(
            misdirectedPlayerGiftCount(state, opp, state.players[0].id)
        ).toBe(0);
        expect(move).toEqual(opp);
        expect(mechanism).not.toBe("announcement-variant");
    });

    it("a punisher slot (draw + lose life at the same player) is untouched", () => {
        const base = getDefinition(ANCESTRAL_RECALL_ID);
        const punisher: CardDefinition = {
            ...base,
            effects: [
                { op: "draw", player: { target: 0 }, count: 3 },
                { op: "loseLife", player: { target: 0 }, amount: 3 },
            ],
        };
        withTemporaryDefinition(punisher, () => {
            const state = giftBoard("Ancestral Recall", 1);
            const { move, opp } = pickWithOppLeading(state);
            expect(
                misdirectedPlayerGiftCount(state, opp, state.players[0].id)
            ).toBe(0);
            expect(move).toEqual(opp);
        });
    });

    it("a self-aimed variant the root never opened is still taken", () => {
        const state = giftBoard("Ancestral Recall", 1);
        const botId = state.players[0].id;
        const { self, opp } = playerVariants(state);
        const out = { mechanism: "mean-reward" as RootDecisionMechanism };
        const move = selectRootMove(
            nodeOf([edge(opp, botId, 0.5)]),
            [self, opp],
            state,
            botId,
            undefined,
            DEFAULT_EVAL_WEIGHTS,
            undefined,
            out
        );
        expect(move).toEqual(self);
        expect(out.mechanism).toBe("announcement-variant");
    });

    it("is announcement-variant's: no-rule:announcement-variant turns the guard off", () => {
        const state = giftBoard("Ancestral Recall", 1);
        const { move, opp } = pickWithOppLeading(
            state,
            new Set<RootDecisionMechanism>(["announcement-variant"])
        );
        expect(move).toEqual(opp);
    });
});

describe("beneficial-slot guard through the search (issue #9044 position)", () => {
    const LABEL =
        "far behind: the prepared Ancestral Recall copy is never cast at the opponent (issue #8954 position)";

    it("on every registry seed the misdirected cast is never the pick", () => {
        const scenario = BLADE_SCENARIOS.find((s) => s.label === LABEL);
        if (!scenario) throw new Error(`registry lost the entry: ${LABEL}`);
        for (const seed of scenario.seeds ?? [0xb1ade]) {
            const state = buildBladeState(scenario);
            const bot = seatPlayerId(state, scenario.bot);
            const { move } = searchWithTrace(
                state,
                bot,
                { iterations: scenario.budget.iterations },
                seed
            );
            expect(move).not.toBeNull();
            expect(misdirectedPlayerGiftCount(state, move!, bot)).toBe(0);
        }
    });
});
