// CR 702.136a — the Bot's seam on riot: the as-enters prompt is a search decision
// with both answers on the table, each producing the board it promises, so the
// tree weighs a bigger body against attacking now instead of a fixed policy.
import { describe, expect, it } from "vitest";
import {
    makePlayer,
    makeState,
    pushSpell,
} from "../../cards/__tests__/setup.helper";
import { withTemporaryDefinition } from "../../cards/registry";
import type { CardDefinition } from "../../cards/types";
import { choiceCandidates } from "../ai/choiceCandidates";
import type { Move } from "../moves";
import { applyMoveInSearch, search } from "../search";
import { resolveTopOfStack, type GameState } from "../state";

const RIOTER: CardDefinition = {
    id: "riot-bot-test-creature",
    name: "Riot Bot Tester",
    rarity: "common",
    manaCost: { R: 1 },
    types: ["Creature"],
    power: 1,
    toughness: 1,
    staticAbilities: ["riot"],
};

function atThePrompt(
    overrides: Parameters<typeof makeState>[0] = {},
    opponentLife = 20
): GameState {
    const state = makeState({
        activePlayerId: "p1",
        priorityPlayerId: "p1",
        players: [makePlayer("p1"), makePlayer("p2", { life: opponentLife })],
        ...overrides,
    });
    pushSpell(state, RIOTER.id, "p1");
    resolveTopOfStack(state);
    return state;
}

const candidate = (state: GameState, key: RegExp) => {
    const found = choiceCandidates(state, state.pendingChoices![0]).find((c) =>
        key.test(c.key)
    );
    expect(found).toBeDefined();
    return found!.move as Move;
};

const answered = (state: GameState, key: RegExp) => {
    applyMoveInSearch(state, "p1", candidate(state, key));
    return state.players[0].battlefield.find(
        (c) => (c.card as { id?: string }).id === RIOTER.id
    );
};

describe("Riot (CR 702.136a), Bot choice surface", () => {
    it("the search reaches the counter and the haste as two different boards", () => {
        withTemporaryDefinition(RIOTER, () => {
            const accepted = answered(atThePrompt(), /accept/);
            expect(accepted?.counters).toEqual({ "+1/+1": 1 });
            expect(accepted?.staticAbilities).not.toContain("haste");

            const declined = answered(atThePrompt(), /decline/);
            expect(declined?.counters?.["+1/+1"] ?? 0).toBe(0);
            expect(declined?.staticAbilities).toContain("haste");
        });
    });

    it("takes the haste when attacking now is lethal", () => {
        withTemporaryDefinition(RIOTER, () => {
            const state = atThePrompt({ phase: "PRECOMBAT_MAIN" }, 1);
            const move = search(state, "p1", { iterations: 400 }, 1);
            expect(move).toEqual(candidate(state, /decline/));
        });
    });
});
