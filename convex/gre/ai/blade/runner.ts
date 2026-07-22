/**
 * Blade-scenario suite — the runner (issue #1427, PRD #1423).
 *
 * Takes a `BladeScenario`, builds its `GameState` in-process through the
 * SHARED, production `buildStateFromScenario` (issue #1424 — the exact
 * builder the Debug panel's `debugSetupScenario` uses, so a blade position
 * and a hand-loaded Debug scenario are the same board), runs the REAL ISMCTS
 * entry point `searchWithTrace` at a fixed iterations budget and a fixed
 * seed, and reports whether the chosen move satisfies the entry.
 *
 * Determinism contract (an acceptance criterion of #1427):
 *   - the base state is built from a FIXED synthetic deck and a FIXED shuffle
 *     seed — never a preset deck that may be re-tuned, never `Math.random`;
 *   - the search budget is `iterations` only — a `timeMs` budget would make
 *     the number of rollouts machine-dependent, and with it the move;
 *   - `searchWithTrace(state, playerId, budget, seed)` is pure given those.
 * Same registry + same seeds => identical result, on any machine, forever.
 *
 * Pure and synchronous: no Convex `ctx`, no DB, no network.
 */

import { getCardByName } from "../../../cards";
import { createInitialGameState, type PlayerInput } from "../../setup";
import { buildStateFromScenario } from "../../scenarioBuilder";
import { searchWithTrace } from "../../search";
import type { GameState } from "../../state";
import type { Move } from "../../moves";
import {
    describeChosenMove,
    describeMatcher,
    matchesMove,
    seatPlayerId,
} from "./matcher";
import type { BladeScenario } from "./types";

/** The one seed every blade entry uses unless it declares its own. Fixed
 *  forever — changing it re-rolls the whole suite. */
export const DEFAULT_BLADE_SEED = 0xb1ade;

/** Shuffle seed for the base (pre-scenario) game state. Fixed for the same
 *  reason. */
const BASE_STATE_SEED = 0x51ade;

/** Size of the synthetic base deck. A scenario clears both libraries anyway
 *  when it sets `libraryCount`; this only has to be a legal-sized pile the
 *  engine can draw from. */
const BASE_DECK_SIZE = 60;

/** Filler card for the synthetic base deck: a basic land, so any card left in
 *  a library the scenario did not override is inert (no cast decisions, no
 *  triggers) and cannot perturb a rollout. */
const BASE_DECK_CARD = "Plains";

function syntheticPlayer(id: string, name: string): PlayerInput {
    const def = getCardByName(BASE_DECK_CARD);
    return {
        id,
        name,
        bgColor: "#000000",
        deck: {
            id: `blade-${id}`,
            name: "Blade base deck",
            format: "freeform",
            cards: Array.from({ length: BASE_DECK_SIZE }, () => ({
                cardId: def.id,
                cardName: def.name,
            })),
        },
    };
}

/**
 * The base `GameState` every blade scenario is applied on top of: two seats
 * (`p1` = the spec's `me`, `p2` = its `opp`) with identical synthetic decks,
 * shuffled at a fixed seed. `buildStateFromScenario` finalizes the mulligan
 * and clears every zone, so nothing but the leftover library survives.
 */
export function buildBladeBaseState(): GameState {
    return createInitialGameState(
        [syntheticPlayer("p1", "Blade P1"), syntheticPlayer("p2", "Blade P2")],
        BASE_STATE_SEED
    );
}

/** Build the `GameState` a blade entry describes. Exported so a failing entry
 *  can be inspected (or replayed at a bigger budget) from a scratch test. */
export function buildBladeState(scenario: BladeScenario): GameState {
    return buildStateFromScenario(buildBladeBaseState(), scenario.spec);
}

/** Result of running ONE seed of one blade scenario. */
export type BladeSeedResult = {
    seed: number;
    move: Move | null;
    /** Human-readable rendering of `move`, in card names. */
    moveDescription: string;
    ok: boolean;
    /** Why it failed — empty when `ok`. */
    reason: string;
};

/** Result of running one blade scenario across all its seeds. */
export type BladeResult = {
    label: string;
    tier: BladeScenario["tier"];
    ok: boolean;
    seeds: BladeSeedResult[];
    /** One-line failure summary, ready to hand to `expect(...).toBe(true)` as
     *  its message. Empty when `ok`. */
    failureMessage: string;
};

function seedsFor(scenario: BladeScenario): number[] {
    const seeds = scenario.seeds ?? [DEFAULT_BLADE_SEED];
    if (seeds.length === 0) {
        throw new Error(
            `Blade scenario "${scenario.label}" declares an empty seed list.`
        );
    }
    return seeds;
}

function checkExpectation(
    scenario: BladeScenario,
    state: GameState,
    move: Move | null
): string {
    const expectation = scenario.expect;
    const actual = describeChosenMove(state, move);

    if (expectation.moves) {
        const hit = expectation.moves.some((m) => matchesMove(state, move, m));
        if (hit) return "";
        const wanted = expectation.moves.map(describeMatcher).join(" | ");
        return `chose [${actual}] — expected one of [${wanted}]`;
    }

    if (expectation.forbidden) {
        const hit = expectation.forbidden.find((m) =>
            matchesMove(state, move, m)
        );
        if (!hit) return "";
        return `chose [${actual}] — forbidden by [${describeMatcher(hit)}]`;
    }

    if (expectation.predicate(move, state)) return "";
    return `chose [${actual}] — expected: ${expectation.describe}`;
}

/**
 * Run one blade scenario at every declared seed. Never throws on a failed
 * expectation (the caller decides whether a failure is blocking — `must` — or
 * report-only — `stretch`); it DOES throw on a malformed entry (unknown card
 * name, a matcher name with no instance in the built state, empty seed list,
 * a seat that owes no action), which is an authoring bug, not a bot result.
 */
export function runBladeScenario(scenario: BladeScenario): BladeResult {
    if (scenario.budget.iterations <= 0) {
        throw new Error(
            `Blade scenario "${scenario.label}" needs a positive iterations budget.`
        );
    }

    const seeds: BladeSeedResult[] = [];
    for (const seed of seedsFor(scenario)) {
        // A fresh state per seed: `searchWithTrace` never mutates the root
        // state, but rebuilding keeps each seed's run provably independent.
        const state = buildBladeState(scenario);
        const botId = seatPlayerId(state, scenario.bot);
        const { move } = searchWithTrace(
            state,
            botId,
            { iterations: scenario.budget.iterations },
            seed
        );
        const reason = checkExpectation(scenario, state, move);
        seeds.push({
            seed,
            move,
            moveDescription: describeChosenMove(state, move),
            ok: reason === "",
            reason,
        });
    }

    const failures = seeds.filter((s) => !s.ok);
    return {
        label: scenario.label,
        tier: scenario.tier,
        ok: failures.length === 0,
        seeds,
        failureMessage: failures
            .map((f) => `seed ${f.seed}: ${f.reason}`)
            .join("; "),
    };
}
