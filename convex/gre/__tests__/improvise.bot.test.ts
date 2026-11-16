// Bot visibility and costing for Improvise (CR 702.126). The cast Move names
// the artifacts it taps for Improvise — exactly the number mana alone cannot
// cover — prices its tap plan without them, and both search sandboxes tap
// them as the cost is paid.
//
//   702.126a  Improvise ... For each generic mana in this spell's total cost,
//             you may tap an untapped artifact you control rather than pay
//             that mana.
import { describe, it, expect } from "vitest";
import { getCardByName } from "../../cards";
import { enumerateMoves, type Move } from "../moves";
import { applyMoveForSearch } from "../applyMove";
import { applyMoveInSearch } from "../search";
import { describeMove } from "../describeMove";
import type { GameState } from "../state";
import { buildPositionFromSpec } from "../ai/blade/build";
import { findBladeScenario } from "../ai/blade/registry";
import type { ScenarioSpec } from "../../debugScenarioSpec";

const KAPPA_LABEL =
    "improvise: Kappa Cannoneer is cast with four artifacts paying the generic";
const KAPPA = getCardByName("Kappa Cannoneer").id;
const ISLAND = getCardByName("Island").id;
const MIND_STONE = getCardByName("Mind Stone").id;

const defIdOf = (c: { card: unknown }) => (c.card as { id?: string }).id;

function kappaPosition(): GameState {
    const scenario = findBladeScenario(KAPPA_LABEL);
    if (!scenario) throw new Error("missing blade entry");
    return buildPositionFromSpec(scenario.spec, scenario.setup, KAPPA_LABEL);
}

/** Two Islands, Mind Stone and three Ornithopters: the Stone is a mana
 *  source, so only the three Ornithopters are Improvise fuel. */
function mindStonePosition(): GameState {
    const spec: ScenarioSpec = {
        phase: "PRECOMBAT_MAIN",
        turn: 5,
        landCount: 0,
        libraryCount: 20,
        cards: [
            { name: "Island", owner: "me", zone: "battlefield", count: 2 },
            { name: "Mind Stone", owner: "me", zone: "battlefield" },
            { name: "Ornithopter", owner: "me", zone: "battlefield", count: 3 },
            { name: "Kappa Cannoneer", owner: "me", zone: "hand" },
        ],
    };
    return buildPositionFromSpec(spec, undefined, "improvise: Mind Stone");
}

function kappaCast(
    state: GameState
): Extract<Move, { kind: "cast-spell" }> | undefined {
    const bot = state.players[0];
    const kappa = bot.hand.find((c) => defIdOf(c) === KAPPA);
    const move = enumerateMoves(state, bot.id).find(
        (m) => m.kind === "cast-spell" && m.cardInstanceId === kappa?.id
    );
    return move?.kind === "cast-spell" ? move : undefined;
}

function battlefieldDefIds(state: GameState, ids: string[]): string[] {
    return ids.map(
        (id) => defIdOf(state.players[0].battlefield.find((c) => c.id === id)!)!
    );
}

describe("Improvise: Bot visibility (CR 702.126a)", () => {
    it("offers the Kappa Cannoneer cast with the four artifacts tapped for Improvise", () => {
        const state = kappaPosition();
        const move = kappaCast(state);
        expect(move).toBeDefined();
        // {5}{U}: two Islands pay {1}{U}, four artifacts the other {4}.
        expect(move!.improviseArtifactIds).toHaveLength(4);
        expect(
            battlefieldDefIds(
                state,
                move!.tapPlan.map((t) => t.cardInstanceId)
            )
        ).toEqual([ISLAND, ISLAND]);
        const artifacts = new Set(move!.improviseArtifactIds);
        expect(move!.tapPlan.some((t) => artifacts.has(t.cardInstanceId))).toBe(
            false
        );
        expect(describeMove(move!, state)).toContain("[improvise:4]");
    });

    it("taps only what mana cannot cover, never a mana-producing artifact", () => {
        const state = mindStonePosition();
        const move = kappaCast(state);
        expect(move).toBeDefined();
        // Islands + Mind Stone make three; the Ornithopters pay the other three.
        expect(move!.improviseArtifactIds).toHaveLength(3);
        expect(
            battlefieldDefIds(state, move!.improviseArtifactIds!)
        ).not.toContain(MIND_STONE);
        expect(move!.tapPlan).toHaveLength(3);
    });

    it("the ISMCTS sandbox taps the named artifacts and puts the spell on the stack", () => {
        const state = kappaPosition();
        const move = kappaCast(state)!;
        applyMoveInSearch(state, state.players[0].id, move);
        const bf = state.players[0].battlefield;
        for (const id of move.improviseArtifactIds!) {
            expect(bf.find((c) => c.id === id)?.isTapped).toBe(true);
        }
        expect(state.stack.map(defIdOf)).toContain(KAPPA);
    });

    it("the greedy sandbox taps them too", () => {
        const state = kappaPosition();
        const move = kappaCast(state)!;
        const after = applyMoveForSearch(state, state.players[0].id, move);
        const bf = after.players[0].battlefield;
        for (const id of move.improviseArtifactIds!) {
            expect(bf.find((c) => c.id === id)?.isTapped).toBe(true);
        }
    });
});
