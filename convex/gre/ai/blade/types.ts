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
 * One step of a blade entry's `setup` — a small declarative move applied to
 * the BUILT state, through the REAL engine, before the search starts
 * (issue #1487, ADR 0070 §4).
 *
 * A `ScenarioSpec` can only describe a board. A position whose decision is a
 * trigger on the stack (or a live pending choice) does not exist the moment
 * the board is built; `setup` walks it forward to that decision.
 *
 * THE INVARIANT: a step that finds no purchase in the real engine THROWS
 * (`BladeSetupError`, `setup.ts`). There is NO fallback that builds the state
 * "as if" — a silent fallback would run the search on a position other than
 * the one written, which is the whole failure mode this shape exists to avoid.
 */
export type BladeSetupStep =
    /** Make the named battlefield permanent's enters-the-battlefield trigger
     *  fire, through the engine's own emitter + trigger collection/placement
     *  (CR 603.2/603.6). The trigger ends up on the stack UNRESOLVED, so the
     *  seat with priority may respond to it — the Stifle-on-its-own-trigger
     *  shape. Throws when the name matches no (or more than one) battlefield
     *  permanent, or when it puts nothing on the stack. */
    | { kind: "etb-trigger"; card: string; controller?: BladeSeat }
    /** Resolve the top of the stack through the real `resolveTopOfStack`
     *  (CR 608). Throws on an empty stack. */
    | { kind: "resolve-top" }
    /** Activate the named battlefield permanent's activated ability through
     *  the REAL activation path (`activateAbilityOnState`, `convex/game.ts` —
     *  the exact function the `activateAbility` mutation calls), so every
     *  legality check and every cost is the one a live game applies (CR 602).
     *  The ability ends up on the stack UNRESOLVED; pair it with a
     *  `resolve-top` step to reach the decision its resolution opens (a
     *  fetchland's live search-library choice, CR 701.23).
     *
     *  `ability` names the ability id and may be omitted when the card has
     *  exactly one stack-using activated ability. Throws when the name matches
     *  no (or more than one) battlefield permanent, when the ability id is
     *  ambiguous or unknown, when the real path rejects the activation, and
     *  when the activation does not reach the stack (an ability whose costs
     *  need further input — mana payment, a cost choice, target selection —
     *  is not a position `setup` can walk forward on its own). */
    | {
          kind: "activate";
          card: string;
          ability?: string;
          controller?: BladeSeat;
      }
    /** Cast the named card from a seat's hand through the REAL move pipeline
     *  (issue #1490, ADR 0070 §4), leaving the spell on the stack UNRESOLVED —
     *  the archetypal RESPONSE position a `ScenarioSpec` cannot express (a
     *  hand-seeded stack item can describe a spell the engine could never have
     *  cast; §4 forbids exactly that). The cast is realised by `enumerateMoves`
     *  (`gre/moves.ts` — the production legality gate: it returns ONLY legal
     *  casts for the seat that holds priority, so mana, timing and legal-target
     *  checks are the real ones) plus `applyMoveInSearch` (`gre/search.ts` — the
     *  exact application the search itself replays a cast with). No purchase in
     *  that pipeline THROWS (`BladeSetupError`); there is no hand-built fallback.
     *
     *  `by` is the casting seat (defaults to `me`, the active player who holds
     *  priority in a freshly built board). `target` pins WHICH legal target the
     *  cast takes — a seat (`me`/`opp`) for a player target, else a card NAME for
     *  a permanent/spell target — and `x` pins the {X} value (CR 107.3). The step
     *  must resolve to EXACTLY ONE legal cast: it throws when the name matches no
     *  legal cast, when `target`/`x` match none, and — rather than guess — when
     *  more than one legal cast still matches (narrow it with `target`/`x`). */
    | {
          kind: "cast";
          card: string;
          by?: BladeSeat;
          target?: BladeSeat | string;
          x?: number;
      }
    /** Declare the active player's attack (CR 508.1) and pass priority forward
     *  until the DEFENDER owes the block declaration — the position a
     *  "block or die" entry (issue #1489) asserts on, which does not exist the
     *  moment the board is built. `cards` restricts the attack to creatures
     *  with those names; omitted, every legal attacker is sent. Runs through
     *  `applyMoveInSearch`, the engine's own move-application chokepoint (see
     *  `combatSetup.ts`), and throws when no creature may legally attack, when
     *  the declaration fails the real restriction checks, or when the position
     *  never reaches an open declare-blockers window. */
    | { kind: "declare-attackers"; cards?: string[] };

/**
 * Why a blade entry only passes ABOVE its declared budget (ADR 0070 §2).
 *
 * Each cause names a MISSING PIECE OF BOT KNOWLEDGE, which is the whole point
 * of classifying: "needs more iterations" names a compute shortfall that
 * buying more compute never fixes (linear depth against exponential
 * branching), and is never an accepted verdict.
 */
export type BeyondBudgetCause =
    /** Too many candidate moves at one decision — the right move is in the
     *  set but never gets enough visits. Missing knowledge: move PRIORS. */
    | "branching"
    /** The payoff lands beyond the rollout horizon, so the line scores the
     *  same as the blunder. Missing knowledge: VALUATION of the pattern. */
    | "horizon"
    /** The refutation depends on a card the determinizer only occasionally
     *  deals into the hidden zone. Missing knowledge: an OPPONENT MODEL. */
    | "hidden-information"
    /** A subtree is mis-valued outright — not merely reached too rarely
     *  (`horizon`) but scored WRONG once reached, so more search converges
     *  AWAY from the right move instead of towards it. Missing knowledge:
     *  a correct VALUATION term for the pattern (issue #1518). Unlike the
     *  other three causes, this one has no budget at which it passes — see
     *  `BeyondBudget.passesAt`. */
    | "valuation";

/** A recorded beyond-budget verdict: the entry passes, but only above its
 *  declared (production-range) budget. `stretch` tier only — raising the
 *  budget to turn an entry green is not a legitimate move (ADR 0070 §2). */
export type BeyondBudget = {
    cause: BeyondBudgetCause;
    /** The budget at which it WAS observed to pass, for the record. Absent
     *  only for `cause: "valuation"` — a mis-valued subtree converges AWAY
     *  from the right move as the budget rises, so there is no budget to
     *  record (issue #1518). Every other cause names a genuine compute
     *  shortfall that more search eventually clears, so it must carry the
     *  budget that clears it. */
    passesAt?: { iterations: number };
    /** Which piece of bot knowledge is missing — prose, printed verbatim by
     *  the stretch report. */
    note: string;
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
    /** Optional engine-real steps applied to the built board before the
     *  search starts (issue #1487, ADR 0070 §4). Each step runs through the
     *  real engine and THROWS if it finds no purchase. */
    setup?: BladeSetupStep[];
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
    /** Recorded when the entry only passes ABOVE `budget` (ADR 0070 §2). The
     *  stretch report prints the cause; the registry-integrity suite rejects
     *  it on a `must` entry, because a `must` entry passes at its declared,
     *  production-range budget by definition. */
    beyondBudget?: BeyondBudget;
    expect: BladeExpectation;
    /** Optional prose: why this position is a blade, what the bot used to do
     *  wrong, which issue it guards. */
    note?: string;
};
