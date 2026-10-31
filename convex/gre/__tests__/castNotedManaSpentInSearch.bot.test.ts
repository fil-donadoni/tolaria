// CR 601.2h / 702.44a — the search's cast commit and `StackItem.notedManaSpent`.
//
// A `noteManaSpent` card reads back the colours it was paid with: Converge's
// `colorsSpentToCast`, Sunburst's counters (Pentad Prism), Vibrance's "if
// {R}{R} was spent to cast it". The server records them as a pool delta around
// `payCastManaCost`; the search pays mana through the coarse tap plan, which
// never touches the pool, so until `searchCastManaSpent` the search's stack
// item carried no record at all and every such read saw 0 colours in-tree —
// Pentad Prism entered with no counters, Vibrance's evoke killed nothing.

import { describe, expect, it } from "vitest";
import { getCardByName } from "../../cards";
import { buildBladeState } from "../ai/blade/runner";
import type { BladeScenario } from "../ai/blade/types";
import type { ScenarioSpec } from "../../debugScenarioSpec";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveInSearch } from "../search";
import { cloneGameState } from "../clone";
import { checkStateBasedActions } from "../sba";
import { resolveTopOfStack, type GameState } from "../state";

function board(cards: ScenarioSpec["cards"]): GameState {
    const scenario: BladeScenario = {
        label: "cast-noted-mana-spent-unit",
        spec: {
            cards,
            phase: "PRECOMBAT_MAIN",
            turn: 5,
            landCount: 0,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        tier: "must",
        expect: { moves: [{ kind: "pass" }] },
    };
    return buildBladeState(scenario);
}

/** A `CardInstanceState` carries no name of its own — match the definition id. */
function isNamed(card: { card: unknown }, name: string): boolean {
    return (card.card as { id?: string }).id === getCardByName(name).id;
}

function castOf(
    state: GameState,
    name: string
): Extract<Move, { kind: "cast-spell" }> {
    const me = state.players[0];
    const move = enumerateMoves(state, me.id).find(
        (m): m is Extract<Move, { kind: "cast-spell" }> =>
            m.kind === "cast-spell" &&
            me.hand.some((c) => c.id === m.cardInstanceId && isNamed(c, name))
    );
    if (!move) throw new Error(`no ${name} cast was enumerated`);
    return move;
}

/** The cast's stack item, straight after the search committed it. */
function castInSearch(state: GameState, name: string) {
    const probe = cloneGameState(state);
    const move = castOf(state, name);
    applyMoveInSearch(probe, state.players[0].id, move);
    const item = probe.stack.find((i) => isNamed(i, name));
    return { probe, move, item };
}

/** The colour each tap-plan source produces, read off the board by name. */
function tapPlanColors(state: GameState, move: Move): string[] {
    if (move.kind !== "cast-spell") return [];
    const LAND_COLOR: Record<string, string> = {
        Mountain: "R",
        Island: "U",
        Forest: "G",
    };
    return move.tapPlan.map((t) => {
        const land = state.players[0].battlefield.find(
            (c) => c.id === t.cardInstanceId
        );
        const name = Object.keys(LAND_COLOR).find(
            (n) => land && isNamed(land, n)
        );
        return name ? LAND_COLOR[name] : "?";
    });
}

describe("search cast commit stamps notedManaSpent (CR 601.2h / 702.44a)", () => {
    it("a Sunburst cast paid with two colours records both, matching its tap plan's sources", () => {
        const state = board([
            { name: "Pentad Prism", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
        ]);
        const { move, item } = castInSearch(state, "Pentad Prism");
        expect(tapPlanColors(state, move).sort()).toEqual(["R", "U"]);
        expect(item?.notedManaSpent).toEqual({ R: 1, U: 1 });
    });

    it("the record reaches the board: Pentad Prism enters with two charge counters in-tree", () => {
        const state = board([
            { name: "Pentad Prism", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Island", owner: "me", zone: "battlefield" },
        ]);
        const { probe } = castInSearch(state, "Pentad Prism");
        let guard = 0;
        while (probe.stack.length > 0 && guard++ < 8) {
            resolveTopOfStack(probe);
            checkStateBasedActions(probe);
        }
        const prism = probe.players[0].battlefield.find((c) =>
            isNamed(c, "Pentad Prism")
        );
        expect(prism?.counters?.charge).toBe(2);
    });

    it("an evoke (alternative cost) cast reads its colours from the taps alone", () => {
        const state = board([
            { name: "Vibrance", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ]);
        const { move, item } = castInSearch(state, "Vibrance");
        expect(move.alternativeCostId).toBe("evoke");
        expect(item?.notedManaSpent).toEqual({ R: 2 });
    });

    it("mana floating in the pool that the plan draws on is counted too", () => {
        const state = board([
            { name: "Pentad Prism", owner: "me", zone: "hand" },
            { name: "Mountain", owner: "me", zone: "battlefield" },
        ]);
        state.players[0].manaPool = { ...state.players[0].manaPool, G: 1 };
        const { item } = castInSearch(state, "Pentad Prism");
        expect(item?.notedManaSpent).toEqual({ R: 1, G: 1 });
    });

    it("a card that does not declare noteManaSpent carries no record", () => {
        const state = board([
            { name: "Grizzly Bears", owner: "me", zone: "hand" },
            { name: "Forest", owner: "me", zone: "battlefield" },
            { name: "Forest", owner: "me", zone: "battlefield" },
        ]);
        const { item } = castInSearch(state, "Grizzly Bears");
        expect(item).toBeDefined();
        expect(item?.notedManaSpent).toBeUndefined();
    });
});
