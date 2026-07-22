/**
 * Blade-scenario suite — types (issue #1427, PRD #1423, map #1256).
 *
 * The blade suite is the CORRECTNESS METRIC for the AI effort: a small,
 * hand-curated set of positions where a human can say, without hedging, what
 * the bot ought to do. It is deliberately a CODE-SIDE registry (not the
 * `debugScenarios` DB table): a blade entry is a regression assertion that
 * must travel in git with the engine change it guards, be reviewable in a
 * diff, and be reproducible on any machine with no deployment attached.
 *
 * Every entry is fully deterministic: a fixed `iterations` budget (NEVER
 * `timeMs` — wall-clock makes the result machine-dependent) and an explicit
 * seed list. Same registry + same seeds => byte-identical chosen move.
 */

import type { ScenarioSpec } from "../../../debugScenarioSpec";
import type { GameState } from "../../state";
import type { Move } from "../../moves";

/** Which seat the search runs for. Mirrors `ScenarioSpec`'s own vocabulary:
 *  `me` is `players[0]` (the scenario author's seat, and the active player),
 *  `opp` is `players[1]`. */
export type BladeSeat = "me" | "opp";

/** Blade tiers. `must` is a BLOCKING CI check — a regression there is a real
 *  regression. `stretch` is REPORT-ONLY: positions the bot is not expected to
 *  solve yet, tracked so progress (and regression) is visible without gating
 *  the merge. */
export type BladeTier = "must" | "stretch";

/**
 * A structural, name-based matcher for the move the bot chose.
 *
 * Structural-by-NAME, never by instance id: a scenario spec places cards by
 * card name, so the expectation is written in the same vocabulary and the
 * runner resolves name → the set of instance ids present in the BUILT state.
 * That keeps entries readable and immune to instance-id allocation changes.
 *
 * Matching is PARTIAL: only the fields present are checked. `{ kind: "pass" }`
 * matches any pass; `{ kind: "cast-spell", card: "Lightning Bolt" }` matches
 * that cast regardless of its targets or tap plan.
 */
export type MoveMatcher = {
    /** Required. The move kind, exactly as in the `Move` union. */
    kind: Move["kind"];
    /** Card NAME the move acts with (the cast/activated/played card, or one of
     *  the declared attackers/blockers). Matches when ANY instance of that
     *  name is among the move's acting cards. */
    card?: string;
    /** Several card NAMES that must ALL appear among the move's acting cards
     *  (multi-card moves: `declare-attackers`, `declare-blockers`,
     *  `resolution-choice`). Still partial — extra cards are allowed. */
    cards?: string[];
    /** Target NAME — a card name, or the literal `"me"` / `"opp"` for a player
     *  target. Matches when ANY of the move's targets resolves to it. */
    target?: string;
    /** Expected boolean for the yes/no move kinds (`may-pay`, `land-entry`,
     *  `draw-replacement`). */
    accept?: boolean;
};

/**
 * What the entry asserts about the chosen move. Exactly one of the three
 * shapes:
 *   - `moves`     — the chosen move must match AT LEAST ONE matcher (the
 *                   "these are all acceptable best plays" shape);
 *   - `forbidden` — the chosen move must match NONE (the "whatever it does,
 *                   not this" shape — cheaper to write when the good play is
 *                   ambiguous but the blunder is not);
 *   - `predicate` — an escape hatch for a position whose correctness is a
 *                   property of the move, not its shape.
 */
export type BladeExpectation =
    | { moves: MoveMatcher[]; forbidden?: never; predicate?: never }
    | { forbidden: MoveMatcher[]; moves?: never; predicate?: never }
    | {
          predicate: (move: Move | null, state: GameState) => boolean;
          /** Human-readable statement of what the predicate demands — printed
           *  on failure, since a closure cannot describe itself. */
          describe: string;
          moves?: never;
          forbidden?: never;
      };

/**
 * One blade scenario. THIS IS THE SHAPE EVERY LATER SCENARIO COPIES — keep
 * new entries to these fields and let the registry stay a flat, readable list.
 */
export type BladeScenario = {
    /** Stable, unique, human-readable id. Shows up in the vitest test name and
     *  in the stretch report, so make it say what the position is about. */
    label: string;
    /** The board, in the exact `ScenarioSpec` vocabulary the Debug panel and
     *  `buildStateFromScenario` already speak (issue #1424). */
    spec: ScenarioSpec;
    /** Seat the bot plays. Must be the seat that holds priority in the built
     *  state, or the search returns `null` (nothing owed). */
    bot: BladeSeat;
    /** Iterations ONLY — a `timeMs` budget would make the result depend on the
     *  machine, which defeats the whole point of the suite. */
    budget: { iterations: number };
    /** Seeds to run. Defaults to `[DEFAULT_BLADE_SEED]` (a single seed). Add
     *  more when a position is known to be seed-sensitive — every seed must
     *  satisfy the expectation. */
    seeds?: number[];
    tier: BladeTier;
    expect: BladeExpectation;
    /** Optional prose: why this position is a blade, what the bot used to do
     *  wrong, which issue it guards. */
    note?: string;
};
