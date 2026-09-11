// The blade registry as the FIRST Verdict source (issue #3400, PRD #3397
// story 4, ADR 0124 §1).
//
// The registry is already a corpus of human judgements — a hundred-odd
// positions where somebody wrote down what the Bot ought to do — so the
// verdict dataset exists before any intake UI does. This module is the
// lowering, and the whole of it: position from the entry's `spec` and `setup`,
// candidates from the Bot's own enumerator on the built board, the right one
// from the entry's own matchers.
//
// THREE EXPECTATION SHAPES, THREE OUTCOMES, NONE SILENT:
//   * `moves`     → one Verdict naming the ACCEPTED SET — every enumerated
//                   move the matcher list accepts, not the first. The
//                   expectation is "at least one of these" and its matchers
//                   are partial, so the first acceptance is frequently not the
//                   play the entry means (`VerdictAnswer` in `types.ts` has
//                   the Stone Rain measurement). The pair builder takes the
//                   best of the set.
//   * `forbidden` → one Verdict carrying the WEAKER constraint: the best
//                   non-forbidden candidate must outrank the forbidden one.
//                   It names no right answer because the entry does not know
//                   one — that is why it was written as a `forbidden`.
//   * `predicate` → none. A closure cannot be matched against a move list
//                   without running it, and what it demands is a property of
//                   the move rather than its shape.
// Every entry that yields nothing is returned as a `VerdictGap` and printed by
// the report. "Skipped silently" is the failure mode this shape exists to
// prevent: a dataset that quietly drops a third of its source is a dataset
// nobody can audit.

import { describeMove } from "../../describeMove";
import type { GameState } from "../../state";
import { decidingPlayer, moveKey } from "../../search";
import { BLADE_SCENARIOS } from "../blade/registry";
import { buildBladeState } from "../blade/runner";
import { matchesMove, seatPlayerId } from "../blade/matcher";
import type { Move } from "../../moves";
import type { BladeScenario, MoveMatcher } from "../blade/types";
import { candidateMoves } from "./position";
import type { Verdict, VerdictCandidate, VerdictGap } from "./types";

/** The author recorded on a registry-derived verdict. */
export const REGISTRY_VERDICT_AUTHOR = "blade-registry";

/** The timestamp recorded on a registry-derived verdict.
 *
 *  A CONSTANT, never `Date.now()`: these verdicts are DERIVED at fit time from
 *  entries that carry no date of their own, and a clock reading would make the
 *  derivation — and therefore the fit that consumes it — non-deterministic,
 *  which ADR 0124 §3 forbids ("same verdicts, same weights, to the bit"). The
 *  date is ADR 0124's own. */
export const REGISTRY_VERDICT_TIMESTAMP = "2026-09-05T00:00:00.000Z";

export type RegistryVerdicts = {
    verdicts: Verdict[];
    gaps: VerdictGap[];
};

/** Every candidate index one of `matchers` accepts. */
function indexesMatching(
    state: GameState,
    moves: Move[],
    matchers: MoveMatcher[]
): number[] {
    const out: number[] = [];
    moves.forEach((move, i) => {
        if (matchers.some((m) => matchesMove(state, move, m))) out.push(i);
    });
    return out;
}

/** Lower ONE blade entry. Returns either a verdict or the reason there is
 *  none — never nothing. */
export function verdictFromScenario(
    scenario: BladeScenario
): { verdict: Verdict } | { gap: VerdictGap } {
    const gap = (
        reason: VerdictGap["reason"],
        detail: string
    ): { gap: VerdictGap } => ({
        gap: { label: scenario.label, tier: scenario.tier, reason, detail },
    });

    if (scenario.expect.predicate) {
        return gap("predicate", scenario.expect.describe);
    }

    let state: GameState;
    try {
        state = buildBladeState(scenario);
    } catch (error) {
        return gap(
            "build",
            error instanceof Error ? error.message : `${error}`
        );
    }

    const botId = seatPlayerId(state, scenario.bot);
    if (decidingPlayer(state) !== botId) {
        return gap(
            "not-deciding",
            `seat "${scenario.bot}" owes no decision on the built position`
        );
    }

    const moves = candidateMoves(state, botId);
    if (moves.length === 0) return gap("not-deciding", "no legal moves");

    const candidates: VerdictCandidate[] = moves.map((move) => ({
        key: moveKey(move),
        description: describeMove(move, state),
    }));

    const base = {
        id: `registry:${scenario.label}`,
        spec: scenario.spec,
        ...(scenario.setup ? { setup: scenario.setup } : {}),
        seat: scenario.bot,
        candidates,
        author: REGISTRY_VERDICT_AUTHOR,
        createdAt: REGISTRY_VERDICT_TIMESTAMP,
        source: "registry" as const,
        ...(scenario.note ? { note: scenario.note } : {}),
    };

    if (scenario.expect.moves) {
        const matchers = scenario.expect.moves;
        // EVERY accepted candidate, not the first: a `moves` expectation says
        // "at least one of these", and its matchers are partial, so the first
        // acceptance is frequently not the play the entry means (see
        // `VerdictAnswer`). The verdict carries the whole accepted set and the
        // pair builder takes the best of it.
        const rightIndexes = indexesMatching(state, moves, matchers);
        if (rightIndexes.length === 0) {
            return gap(
                "no-match",
                `no enumerated move satisfies the entry's ${matchers.length} matcher(s)`
            );
        }
        if (rightIndexes.length === moves.length) {
            return gap(
                "unconstraining",
                "every candidate is accepted (a forced line), so the entry states no preference"
            );
        }
        return {
            verdict: { ...base, answer: { kind: "right", rightIndexes } },
        };
    }

    const forbiddenIndexes = indexesMatching(
        state,
        moves,
        scenario.expect.forbidden ?? []
    );
    if (forbiddenIndexes.length === 0) {
        return gap(
            "unconstraining",
            "the forbidden move is not among the enumerated candidates, so the entry rules nothing out"
        );
    }
    if (forbiddenIndexes.length === moves.length) {
        return gap(
            "no-match",
            "every candidate is forbidden, so there is no better move to outrank them"
        );
    }
    return {
        verdict: { ...base, answer: { kind: "forbidden", forbiddenIndexes } },
    };
}

/** Every verdict the blade registry yields, plus every entry that yielded
 *  none and why. Deterministic: the registry order, the blade builder's fixed
 *  seeds, and no clock. */
export function verdictsFromRegistry(
    scenarios: readonly BladeScenario[] = BLADE_SCENARIOS
): RegistryVerdicts {
    const verdicts: Verdict[] = [];
    const gaps: VerdictGap[] = [];
    for (const scenario of scenarios) {
        const out = verdictFromScenario(scenario);
        if ("verdict" in out) verdicts.push(out.verdict);
        else gaps.push(out.gap);
    }
    return { verdicts, gaps };
}
