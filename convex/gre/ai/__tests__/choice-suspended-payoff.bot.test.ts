/**
 * A payoff behind a Pending Choice is probed THROUGH it (issue #3194).
 *
 * The bot cast a modal instant's self-only land-type mode on turn 1, when the
 * only land on either battlefield was its own single blue source. The reason
 * was not the search: every probe that ranks or prunes a cast stopped the
 * moment resolution suspended on a choice, so the mode probed on a state where
 * its spell was still ON THE STACK — its payoff term measured the cost of
 * casting and none of the effect, and it was then compared against sibling
 * modes measured after a full resolution.
 *
 * These are the two seams that answer that, asserted deterministically: a
 * search-level assertion would be pinning rollout noise (the blade pair
 * "choice-behind payoff" carries the root-level evidence, on the seeds that
 * actually failed).
 */

import { describe, expect, it } from "vitest";
import {
    applyMoveInSearch,
    reachesOnlyOwnSideThroughChoice,
    settleStackForBreakdown,
} from "../../search";
import { enumerateMoves, type Move } from "../../moves";
import { buildBladeState } from "../blade/runner";
import { cloneGameState } from "../../clone";
import type { GameState } from "../../state";
import type { BladeScenario } from "../blade/types";
import type { ScenarioCard } from "../../../debugScenarioSpec";

/** Turn 1, the bot holds one Island — its sole blue source — plus the modal
 *  instant and two cards it cannot pay for. `opponent` seeds the other side. */
function position(opponent: ScenarioCard[] = []): {
    state: GameState;
    botId: string;
} {
    const scenario = {
        label: "issue #3194 probe",
        spec: {
            cards: [
                { name: "Vision Charm", owner: "me", zone: "hand" },
                { name: "Island", owner: "me", zone: "battlefield", count: 1 },
                { name: "Counterspell", owner: "me", zone: "hand", count: 2 },
                ...opponent,
            ],
            phase: "PRECOMBAT_MAIN",
            turn: 1,
            libraryCount: 20,
        },
        bot: "me",
        budget: { iterations: 1 },
        seeds: [0],
        tier: "must",
        expect: { forbidden: [] },
    } as unknown as BladeScenario;
    const state = buildBladeState(scenario);
    return { state, botId: state.players[0].id };
}

/** The land-type mode: no target requirement, both of its answers taken as
 *  resolution-time option choices (CR 608.2). */
function landTypeMode(state: GameState, botId: string): Move {
    const move = enumerateMoves(state, botId).find(
        (m) => m.kind === "cast-spell" && m.chosenModeId === "land-type"
    );
    expect(move, "the land-type mode must be enumerable here").toBeDefined();
    return move!;
}

describe("a mode whose whole effect is behind a Pending Choice", () => {
    it("settles THROUGH the mover's own choice instead of stopping on it", () => {
        const { state, botId } = position();
        const probe = cloneGameState(state);
        applyMoveInSearch(probe, botId, landTypeMode(state, botId));

        // Without a mover the old behaviour is kept verbatim: the spell is
        // still on the stack, waiting on a choice nobody answers. That state is
        // what every payoff term used to be measured on.
        const stopped = settleStackForBreakdown(cloneGameState(probe));
        expect(stopped.stack.length).toBe(1);
        expect(stopped.pendingChoices?.length ?? 0).toBe(1);

        // With the mover named, the choice is the mover's own to make, so the
        // probe makes it — through BOTH nested levels — and reaches a resolved
        // position.
        const settled = settleStackForBreakdown(cloneGameState(probe), botId);
        expect(settled.stack.length).toBe(0);
        expect(settled.pendingChoices?.length ?? 0).toBe(0);
    });

    it("reads the announcement's reach as self-confined only when it IS", () => {
        // Position A — the bot's own Island is the only land in the game, so
        // every branch of the choice can touch nothing but the bot's own board.
        const a = position();
        expect(
            reachesOnlyOwnSideThroughChoice(
                a.state,
                landTypeMode(a.state, a.botId),
                a.botId
            )
        ).toBe(true);

        // Position B — the opponent controls lands of a re-typable subtype, so
        // the very first branch that re-types one reaches THEM. The same mode,
        // the same absence of any declared target, the opposite verdict: this
        // is what keeps the guard a preference and not a ban.
        const b = position([
            { name: "Forest", owner: "opp", zone: "battlefield", count: 3 },
        ]);
        expect(
            reachesOnlyOwnSideThroughChoice(
                b.state,
                landTypeMode(b.state, b.botId),
                b.botId
            )
        ).toBe(false);
    });

    it("says nothing about a move that suspends on no choice at all", () => {
        // The narrowing that keeps the ordinary population untouched: the mill
        // mode resolves without asking the bot anything, so this predicate is
        // false for it whatever it does to the board.
        const { state, botId } = position();
        const mill = enumerateMoves(state, botId).find(
            (m) => m.kind === "cast-spell" && m.chosenModeId === "mill"
        );
        expect(mill).toBeDefined();
        expect(reachesOnlyOwnSideThroughChoice(state, mill!, botId)).toBe(
            false
        );
    });
});
