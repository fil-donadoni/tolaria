// CR 608.2 / 401.2 (issue #9119) — a Bot decision at an open top-N look
// (`look-distribute`, `order-top`) lowers the looked-at window by name, so the
// rebuild's resumed step looks at the same cards and offers the same moves.
// The rest of the library stays out of the spec.
//
// The live positions are reached through the real engine: a blade-built board
// whose library holds named cards on top of filler basics, the look raised by
// `resolveTopOfStack`. The round trip is proven by what `lowerDecision`
// already checks — the candidate list move for move — and by the rebuilt
// library's top run.

import { describe, expect, it } from "vitest";
import { buildBladeState } from "../blade/runner";
import { buildVerdictPosition, candidateMoves } from "../verdicts/candidates";
import { lowerDecision } from "../verdicts/lowering";
import { specFromState } from "../../scenarioBuilder";
import { describeMove } from "../../describeMove";
import { PLACEHOLDER_CARD_ID } from "../../constants";
import { tryGetDefinition } from "../../../cards/registry";
import type { GameState } from "../../state";
import type { BladeSetupStep } from "../blade/types";
import type { ScenarioSpec } from "../../../debugScenarioSpec";

function engineBuilt(spec: ScenarioSpec, setup: BladeSetupStep[]): GameState {
    return buildBladeState({
        label: "library window fixture",
        spec,
        setup,
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [] },
    });
}

/** The definition ids of the top `count` cards of `seat`'s library. */
function topRun(state: GameState, playerId: string, count: number): string[] {
    const player = state.players.find((p) => p.id === playerId)!;
    return player.library
        .slice(0, count)
        .map((c) => (c.card as { id: string }).id);
}

function labels(state: GameState, playerId: string): string[] {
    return candidateMoves(state, playerId)
        .map((m) => describeMove(m, state))
        .sort();
}

/** Lower the Bot's first candidate, assert the round trip, and return what
 *  the lowering and the rebuild produced. */
function roundTrip(state: GameState, botId: string) {
    const head = state.pendingChoices![0];
    const window = head.candidateIds!;
    const [first] = candidateMoves(state, botId);
    const outcome = lowerDecision(state, botId, describeMove(first, state));
    if (!outcome.ok) {
        throw new Error(`refused ${outcome.kind}: ${outcome.error}`);
    }
    const rebuilt = buildVerdictPosition(outcome.lowered.spec);
    const rebuiltBot = rebuilt.players[0].id;
    expect(rebuilt.pendingChoices?.[0].kind).toBe(head.kind);
    expect(topRun(rebuilt, rebuiltBot, window.length)).toEqual(
        topRun(state, botId, window.length)
    );
    expect(labels(rebuilt, rebuiltBot)).toEqual(labels(state, botId));
    return { spec: outcome.lowered.spec, window };
}

/** Torsten's ETB on the stack, its library topped by a card the filter
 *  refuses: the live window holds six keep-eligible cards, a base-deck window
 *  seven — the refusal the issue was filed from. */
const TORSTEN_ETB: ScenarioSpec = {
    cards: [
        { name: "Torsten, Founder of Benalia", owner: "me" },
        { name: "Lightning Bolt", owner: "me", zone: "library", position: 1 },
        { name: "Swamp", owner: "opp" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    activePlayer: "me",
    landCount: 0,
    libraryCount: 20,
};

/** Preordain resolving into its scry 2 over two different cards, so which
 *  half each lands in is a different answer. */
const PREORDAIN_SCRY: ScenarioSpec = {
    cards: [
        { name: "Preordain", owner: "me", zone: "hand" },
        { name: "Island", owner: "me" },
        { name: "Lightning Bolt", owner: "me", zone: "library", position: 1 },
        { name: "Grizzly Bears", owner: "me", zone: "library", position: 2 },
        { name: "Swamp", owner: "opp" },
    ],
    phase: "PRECOMBAT_MAIN",
    turn: 5,
    activePlayer: "me",
    landCount: 0,
    libraryCount: 20,
};

describe("a decision at an open top-N look lowers its looked-at window (CR 608.2, issue #9119)", () => {
    it("look-distribute: Torsten's reveal rebuilds over the same seven cards and offers the same moves", () => {
        const state = engineBuilt(TORSTEN_ETB, [
            { kind: "etb-trigger", card: "Torsten, Founder of Benalia" },
            { kind: "resolve-top" },
        ]);
        const botId = state.players[0].id;
        const head = state.pendingChoices![0];
        expect(head.kind).toBe("look-distribute");
        expect(head.candidateIds).toHaveLength(7);
        expect(head.eligibleIds).toHaveLength(6);

        roundTrip(state, botId);
    });

    it("order-top: Preordain's scry rebuilds over the same two cards and offers the same moves", () => {
        const state = engineBuilt(PREORDAIN_SCRY, [
            { kind: "cast", card: "Preordain", by: "me" },
            { kind: "resolve-top" },
        ]);
        const botId = state.players[0].id;
        expect(state.pendingChoices![0].kind).toBe("order-top");

        roundTrip(state, botId);
    });

    it("lowers ONLY the window: no library card below it enters the spec", () => {
        const state = engineBuilt(TORSTEN_ETB, [
            { kind: "etb-trigger", card: "Torsten, Founder of Benalia" },
            { kind: "resolve-top" },
        ]);
        const botId = state.players[0].id;
        const { spec } = specFromState(state, { mySeatId: botId });
        const library = spec.cards.filter((c) => c.zone === "library");
        const window = state.players[0].library.slice(0, 7);
        expect(library).toHaveLength(7);
        expect(library.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        expect(library.map((c) => c.name)).toEqual(
            window.map(
                (c) => tryGetDefinition((c.card as { id: string }).id)?.name
            )
        );
        expect(library[0].name).toBe("Lightning Bolt");
    });

    it("a window the capturing view cannot name is refused whole, and says so", () => {
        const state = engineBuilt(TORSTEN_ETB, [
            { kind: "etb-trigger", card: "Torsten, Founder of Benalia" },
            { kind: "resolve-top" },
        ]);
        const botId = state.players[0].id;
        state.players[0].library[3] = {
            ...state.players[0].library[3],
            card: { id: PLACEHOLDER_CARD_ID } as never,
        };
        const { spec, dropped } = specFromState(state, { mySeatId: botId });
        expect(spec.cards.filter((c) => c.zone === "library")).toHaveLength(0);
        expect(
            dropped.some((d) => d.startsWith("me's looked-at window:"))
        ).toBe(true);
    });
});
