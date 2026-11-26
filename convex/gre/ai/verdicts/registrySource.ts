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
import { BLADE_LINES } from "../blade/lines";
import { buildLineState, firstMatchingMove, walkLine } from "../blade/line";
import { buildBladeState, forcedSeatAnswer } from "../blade/runner";
import { matchesMove, seatPlayerId } from "../blade/matcher";
import type { Move } from "../../moves";
import type { BladeLine, BladeScenario, MoveMatcher } from "../blade/types";
import { verdictIdOf } from "./identity";
import { pairPositionDefect } from "./pairDiff";
import { positionOf } from "./pairDerivation";
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
        gap: {
            label: scenario.label,
            tier: scenario.tier,
            reason,
            detail,
            ...(scenario.classification?.kind === "conditional"
                ? { conditional: scenario.classification.discriminant }
                : {}),
        },
    });

    if (scenario.expect.predicate) {
        return gap("predicate", scenario.expect.describe);
    }
    // Issue #3590 — the right move here is decided by where the seat has
    // already been, not by the position: a fit over the feature vector can
    // only mislearn from it.
    if (scenario.revisit) {
        return gap(
            "history",
            "the entry's answer depends on the decision history its `revisit` loop builds, which no evaluation term can see"
        );
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
    const decider = decidingPlayer(state);
    // Issue #9957 — a window no search node opens on, answered by the one
    // shed order the search's playout and the live client share: no weight
    // moves that answer, so a verdict here would teach the fit nothing.
    if (forcedSeatAnswer(state, decider, botId)) {
        return gap(
            "forced",
            `seat "${scenario.bot}" owes a mandatory own-hand discard no search node opens on; its one answer is \`mandatoryOwnHandDiscardAnswer\``
        );
    }
    if (decider !== botId) {
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
        // Issue #3533 — the entry's own deck knowledge travels with the
        // verdict, so `buildVerdictState` rebuilds the position the SEARCH
        // saw rather than a blind twin of it.
        ...(scenario.deckKnowledge?.length
            ? { deckKnowledge: scenario.deckKnowledge }
            : {}),
        candidates,
        author: REGISTRY_VERDICT_AUTHOR,
        createdAt: REGISTRY_VERDICT_TIMESTAMP,
        source: "registry" as const,
        ...(scenario.note ? { note: scenario.note } : {}),
        // Issue #4796 — the entry's own classification. Every registry entry
        // but a `pairOf` half declares one (issue #4797); a half carries
        // none: its link classifies it (`derivePairs`).
        ...(scenario.classification && !scenario.pairOf
            ? { classification: scenario.classification }
            : {}),
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

/** Resolve the `pairOf` declarations: each half links to its anchor's verdict
 *  id, or — when the declaration is refused — leaves the corpus as a `pair`
 *  gap, because a right-hand half alone teaches "always" (ADR 0148). The
 *  anchor of a refused pair stays conditional and unpaired. */
function linkPairs(
    scenarios: readonly BladeScenario[],
    verdictOf: Map<string, Verdict>,
    gaps: VerdictGap[]
): void {
    const byLabel = new Map(scenarios.map((s) => [s.label, s]));
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        const decl = scenario.pairOf;
        const half = verdictOf.get(scenario.label);
        if (decl === undefined || half === undefined) continue;
        const refuse = (detail: string) => {
            verdictOf.delete(scenario.label);
            gaps.push({
                label: scenario.label,
                tier: scenario.tier,
                reason: "pair",
                detail: `refused as the right-hand half of "${decl.anchor}": ${detail}`,
            });
        };
        const anchorScenario = byLabel.get(decl.anchor);
        const anchor = verdictOf.get(decl.anchor);
        if (scenario.classification !== undefined) {
            refuse("a half is classified by its link, never by its own field");
        } else if (half.answer.kind !== "right") {
            refuse(
                "a right-hand half names the move that is right here, so its expectation is `moves`"
            );
        } else if (anchorScenario === undefined) {
            refuse("no registry entry carries that label");
        } else if (anchor === undefined) {
            refuse("the anchor yields no verdict");
        } else if (
            anchor.classification?.kind !== "conditional" ||
            anchor.classification.discriminant.kind !==
                decl.discriminant.kind ||
            anchor.classification.discriminant.detail !==
                decl.discriminant.detail
        ) {
            refuse(
                "the anchor is not classified conditional with this same Discriminant"
            );
        } else if (
            anchorScenario.expect.forbidden !== undefined &&
            !anchorScenario.expect.forbidden.some((forbidden) =>
                (scenario.expect.moves ?? []).some(
                    (accepted) =>
                        JSON.stringify(accepted) === JSON.stringify(forbidden)
                )
            )
        ) {
            // The half is where the anchor's ruled-out move is RIGHT
            // (`minimalPair.ts` leaves that check to whoever writes the half).
            refuse(
                "the half accepts no move the anchor forbids — a right-hand half names the move its anchor ruled out"
            );
        } else {
            const defect = pairPositionDefect(
                positionOf(anchor),
                positionOf(half),
                decl.discriminant
            );
            if (defect !== null) refuse(defect);
            else {
                verdictOf.set(scenario.label, {
                    ...half,
                    pairOf: {
                        anchorId: verdictIdOf(anchor),
                        discriminant: decl.discriminant,
                    },
                });
            }
        }
    }
}

/** Every verdict the blade registry yields, plus every entry that yielded
 *  none and why. Deterministic: the registry order, the blade builder's fixed
 *  seeds, and no clock. */
export function verdictsFromRegistry(
    scenarios: readonly BladeScenario[] = BLADE_SCENARIOS
): RegistryVerdicts {
    const verdictOf = new Map<string, Verdict>();
    const gaps: VerdictGap[] = [];
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        const out = verdictFromScenario(scenario);
        if ("verdict" in out) verdictOf.set(scenario.label, out.verdict);
        else gaps.push(out.gap);
    }
    linkPairs(scenarios, verdictOf, gaps);
    // Registry order, whatever the refusals removed.
    const verdicts = scenarios.flatMap((s) => verdictOf.get(s.label) ?? []);
    return { verdicts, gaps };
}

/** The label of a Line's decision `index` (0-based), as its Verdict or gap
 *  names it. */
export function lineDecisionLabel(line: BladeLine, index: number): string {
    return `${line.label} — decision ${index + 1}`;
}

/** Lower ONE Line (ADR 0186 Decision 9) to one Verdict per Bot decision.
 *
 *  Separate from the gate (`runBladeLine`): the walk plays the Line's own
 *  expected moves — at each decision the first enumerated move one of its
 *  matchers accepts — never the Bot's. Each decision is lowered exactly as a
 *  blade entry is (`verdictFromScenario`), its position the Line's `spec`
 *  with a `setup` that replays the walk to it, so every check a registry
 *  entry meets (forced, unconstraining, no-match) is met here too. A decision
 *  that yields no Verdict, and every decision after a walk that cannot go on,
 *  is a gap: never dropped. */
export function verdictsFromLine(line: BladeLine): RegistryVerdicts {
    const verdicts: Verdict[] = [];
    const gaps: VerdictGap[] = [];
    let reported = 0;
    let stop: { index: number; reason: string } | null = null;
    try {
        const state = buildLineState(line);
        const botId = seatPlayerId(state, line.bot);
        stop = walkLine(line, state, {
            decide: (s, index, trail) => {
                const out = verdictFromScenario({
                    label: lineDecisionLabel(line, index),
                    spec: line.spec,
                    setup: [...(line.setup ?? []), ...trail],
                    bot: line.bot,
                    ...(line.deckKnowledge
                        ? { deckKnowledge: line.deckKnowledge }
                        : {}),
                    budget: line.budget,
                    tier: line.tier,
                    expect: { moves: line.steps[index].expect },
                    note: line.note,
                });
                reported++;
                if ("verdict" in out) {
                    verdicts.push({
                        ...out.verdict,
                        id: `line:${line.label}#${index + 1}`,
                    });
                } else {
                    gaps.push(out.gap);
                }
                return (
                    firstMatchingMove(s, botId, line.steps[index].expect) ?? {
                        stop: "no enumerated move matches its expected moves",
                    }
                );
            },
        });
    } catch (error) {
        stop = {
            index: reported,
            reason: error instanceof Error ? error.message : `${error}`,
        };
    }
    if (stop !== null) {
        for (let i = reported; i < line.steps.length; i++) {
            gaps.push({
                label: lineDecisionLabel(line, i),
                tier: line.tier,
                reason: "build",
                detail: `the Line's walk stopped at decision ${stop.index + 1}: ${stop.reason}`,
            });
        }
    }
    return { verdicts, gaps };
}

/** Every Verdict the blade Lines yield, plus every decision that yielded
 *  none and why. Not part of `verdictsFromRegistry`: the fit reads it only
 *  when a caller adds it (ADR 0186 — nothing in its PRD changes the Bot
 *  players face). */
export function verdictsFromLines(
    lines: readonly BladeLine[] = BLADE_LINES
): RegistryVerdicts {
    const out: RegistryVerdicts = { verdicts: [], gaps: [] };
    for (let i = 0; i < lines.length; i++) {
        const one = verdictsFromLine(lines[i]);
        out.verdicts.push(...one.verdicts);
        out.gaps.push(...one.gaps);
    }
    return out;
}
