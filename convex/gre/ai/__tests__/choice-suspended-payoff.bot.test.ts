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
import { isDominatedNoOpMove } from "../dominance";
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

        // Without a mover there is nobody to answer the choice, so the settle
        // cannot finish — and since issue #3388 a settle that cannot finish
        // hands back the position AS IT WAS rather than the half-applied one it
        // reached. The spell is still on the stack, un-resolved, with NO choice
        // queued: the caller scores an announcement, which is a position, and
        // not "the Ops before the choice have run and the ones that pay for
        // them have not", which is not. (Before #3388 this returned the
        // mid-resolution state — stack 1 AND one pending choice — and every
        // payoff term was measured on it.)
        const stopped = settleStackForBreakdown(cloneGameState(probe));
        expect(stopped.stack.length).toBe(1);
        expect(stopped.pendingChoices?.length ?? 0).toBe(0);
        // …and the caller can SEE that it bailed, rather than having to infer
        // it from a state that looks settled.
        const report = { complete: true };
        settleStackForBreakdown(
            cloneGameState(probe),
            undefined,
            undefined,
            0,
            undefined,
            0,
            report
        );
        expect(report.complete).toBe(false);

        // With the mover named, the choice is the mover's own to make, so the
        // probe makes it — through BOTH nested levels — and reaches a resolved
        // position.
        const settled = settleStackForBreakdown(cloneGameState(probe), botId);
        expect(settled.stack.length).toBe(0);
        expect(settled.pendingChoices?.length ?? 0).toBe(0);
    });

    it("reads the reach as self-confined only when the effect cannot leave it", () => {
        // Position A — the bot's own Island is the only land in the game, so
        // every branch of the choice can touch nothing but the bot's own board,
        // and one of them (a subtype no land has) does nothing at all.
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

    it("is not fooled by an opponent permanent the effect cannot reach", () => {
        // The case that makes the pair above mean what it says. The first cut
        // of this predicate hand-rolled a JSON digest of the opponent's record,
        // which tripped on the layer pass's LAZILY stamped memo fields — the
        // probe runs the engine, the baseline did not — so it answered "this
        // reaches them" whenever the opponent controlled ANY permanent, and the
        // whole fix was inert outside an empty opposing board. A creature is
        // untouchable by a land re-type; the verdict must not move.
        const withCreature = position([
            { name: "Grizzly Bears", owner: "opp", zone: "battlefield" },
        ]);
        expect(
            reachesOnlyOwnSideThroughChoice(
                withCreature.state,
                landTypeMode(withCreature.state, withCreature.botId),
                withCreature.botId
            )
        ).toBe(true);
    });

    it("does not read a tutor as futile, though its reach is self-confined too", () => {
        // The other half of the quantifier, and the reason it is not simply
        // "the reach is my own side": a tutor searches the mover's own library,
        // touches nobody else, and reads as a material LOSS (a card and mana
        // spent for a payoff priced in a hidden zone). What it does NOT have is
        // a branch that does nothing — so it is not the shape this answers, and
        // holding it would be a plain blunder.
        const scenario = {
            label: "tutor",
            spec: {
                cards: [
                    { name: "Demonic Tutor", owner: "me", zone: "hand" },
                    {
                        name: "Swamp",
                        owner: "me",
                        zone: "battlefield",
                        count: 2,
                    },
                ],
                phase: "PRECOMBAT_MAIN",
                turn: 3,
                libraryCount: 20,
            },
            bot: "me",
            budget: { iterations: 1 },
            seeds: [0],
            tier: "must",
            expect: { forbidden: [] },
        } as unknown as BladeScenario;
        const state = buildBladeState(scenario);
        const botId = state.players[0].id;
        const cast = enumerateMoves(state, botId).find(
            (m) => m.kind === "cast-spell"
        );
        expect(cast, "the tutor must be castable here").toBeDefined();
        expect(reachesOnlyOwnSideThroughChoice(state, cast!, botId)).toBe(
            false
        );
    });

    it("the deeper bound does not start PRUNING a mode that does something", () => {
        // Raising MAX_CHOICE_DEPTH from 1 to 5 widens what `dominance.ts` may
        // prove futile for every card with nested choices — and a prune is a
        // legality-side removal from `enumerateMoves`, not a preference among
        // siblings. The land-type mode has branches that change the board, in
        // both positions, so it must stay offered in both: what this PR does to
        // it is rank and hold it, never make it unavailable.
        for (const opponent of [
            [],
            [{ name: "Forest", owner: "opp", zone: "battlefield", count: 3 }],
        ] as ScenarioCard[][]) {
            const { state, botId } = position(opponent);
            expect(
                isDominatedNoOpMove(state, botId, landTypeMode(state, botId))
            ).toBe(false);
        }
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
