/**
 * Blade robustness audit (issue #4875).
 *
 * A `must` entry is a position + an expected move + FIXED seeds + a fixed
 * iterations budget. When the expected move and its rival sit inside the
 * outcome band at that budget, the ISMCTS pick is decided by rollout order —
 * by the seed — and the entry is green by luck: any perturbation that changes
 * rollout order (a weight refit, another verdict moving the fit, a change in
 * RNG consumption) flips it. Issues #4768, #4777 and #4874 were each found by
 * the session whose refit tripped them; #4874's refit moved every weight by
 * less than 0.05%, which carries no valuation content at all.
 *
 * This module asks the question BEFORE a refit does: for each entry, run the
 * search at its own budget over a wide fixed seed list, under the committed
 * `DEFAULT_EVAL_WEIGHTS` and under a small fixed set of jittered vectors
 * (every fittable weight, `latent.*` included, moved ±`JITTER_FRACTION`
 * through the `SearchVariant.evalWeights` override), and classify:
 *
 *   - `robust`       — every run passes;
 *   - `noise-pinned` — the entry's own seeds pass, some other run fails;
 *   - `wrong`        — the entry's own seeds fail (the `must` tier is red).
 *
 * Deterministic end to end: fixed seed list, fixed jitter vectors (the signs
 * come from a fixed `makeRng` stream), iterations budgets only. Same registry
 * + same weights ⇒ the same report on any machine.
 *
 * The verdict side — the shrink-only baseline of known noise-pinned entries
 * and what reds — is `compareRobustness`, pure over rows, so the spec runner
 * (`__tests__/robustness.shard-N.spec.ts`) and its unit test share it.
 *
 * Out of scope by design: an entry green for the WRONG reason (non-
 * discriminating). A perturbation cannot see that; proof-of-failure does.
 */

import { makeRng } from "../../rng";
import { DEFAULT_EVAL_WEIGHTS } from "../evalWeights";
import {
    FITTABLE_WEIGHT_KEYS,
    weightValue,
    type FittableWeightKey,
} from "../verdicts/features";
import type { SearchVariant } from "../searchVariant";
import { bladeScenarioSeeds, runBladeScenario } from "./runner";
import type { BladeScenario } from "./types";

/** The wide seed list every entry is re-run over. Fixed forever — changing it
 *  re-rolls the whole audit and invalidates the baseline. */
export const ROBUSTNESS_SEEDS: readonly number[] = Array.from(
    { length: 10 },
    (_, i) => i
);

/** How far each weight moves in a jittered vector: ±1%. Twenty times the
 *  movement of issue #4756's refit, which already flipped an entry. */
export const JITTER_FRACTION = 0.01;

/** Seed of the sign stream behind the jitter vectors. Fixed forever. */
export const JITTER_SIGN_SEED = 0x4875;

/** One weight vector a leg runs under. `variant: null` is the committed
 *  default — no variant installed at all, the production path. */
export type RobustnessVector = {
    name: string;
    variant: SearchVariant | null;
};

/** The sign each fittable weight moves by in the `jitter+` vector (and the
 *  opposite one in `jitter−`), drawn once from a fixed stream. */
export function jitterSigns(): Record<FittableWeightKey, 1 | -1> {
    const next = makeRng(JITTER_SIGN_SEED);
    const signs = {} as Record<FittableWeightKey, 1 | -1>;
    for (const key of FITTABLE_WEIGHT_KEYS) signs[key] = next() < 0.5 ? -1 : 1;
    return signs;
}

/** The `evalWeights` override that moves every fittable weight by
 *  `direction · sign_k · JITTER_FRACTION` of its committed value. */
export function jitteredEvalWeights(
    direction: 1 | -1
): NonNullable<SearchVariant["evalWeights"]> {
    const signs = jitterSigns();
    const flat: Record<string, number> = {};
    const latent: Record<string, number> = {};
    for (const key of FITTABLE_WEIGHT_KEYS) {
        const value =
            weightValue(DEFAULT_EVAL_WEIGHTS, key) *
            (1 + direction * signs[key] * JITTER_FRACTION);
        if (key.startsWith("latent.")) {
            latent[key.slice("latent.".length)] = value;
        } else {
            flat[key] = value;
        }
    }
    return { ...flat, latent };
}

/** The committed default plus an ANTITHETIC pair of jittered vectors: the
 *  second moves every weight the opposite way to the first, so a pick that
 *  leans on any one weight's exact value is pushed off it in both directions. */
export function robustnessVectors(): RobustnessVector[] {
    return [
        { name: "default", variant: null },
        {
            name: "jitter+",
            variant: {
                name: "robustness:jitter+",
                evalWeights: jitteredEvalWeights(1),
            },
        },
        {
            name: "jitter-",
            variant: {
                name: "robustness:jitter-",
                evalWeights: jitteredEvalWeights(-1),
            },
        },
    ];
}

/** One vector's leg of an entry: how many of the wide seeds pass, and which
 *  root mechanism decided each run. */
export type RobustnessLeg = {
    vector: string;
    seeds: number;
    passed: number;
    /** `RootDecisionMechanism` → runs it settled. `material-tiebreak` on a
     *  failing entry is the usual noise signature (a near-tie). */
    mechanisms: Record<string, number>;
    /** The failing seeds with the move chosen, for the report line. */
    failures: { seed: number; move: string }[];
};

export type RobustnessVerdict = "robust" | "noise-pinned" | "wrong";

export type RobustnessRow = {
    label: string;
    iterations: number;
    /** The entry's OWN seeds under the committed default — what the `must`
     *  suite runs. */
    own: { seeds: number; passed: number };
    legs: RobustnessLeg[];
    verdict: RobustnessVerdict;
};

export function classifyRobustness(
    own: RobustnessRow["own"],
    legs: readonly RobustnessLeg[]
): RobustnessVerdict {
    if (own.passed < own.seeds) return "wrong";
    return legs.every((leg) => leg.passed === leg.seeds)
        ? "robust"
        : "noise-pinned";
}

/** Run the audit for ONE entry: its own seeds, then every vector over
 *  `ROBUSTNESS_SEEDS`. Throws what `runBladeScenario` throws (a malformed
 *  entry is an authoring bug, not a verdict). */
export function auditBladeScenario(
    scenario: BladeScenario,
    vectors: readonly RobustnessVector[] = robustnessVectors()
): RobustnessRow {
    const ownResult = runBladeScenario(scenario);
    const own = {
        seeds: bladeScenarioSeeds(scenario).length,
        passed: ownResult.seeds.filter((s) => s.ok).length,
    };
    const wide: BladeScenario = { ...scenario, seeds: [...ROBUSTNESS_SEEDS] };
    const legs = vectors.map((vector): RobustnessLeg => {
        const result = runBladeScenario(wide, vector.variant);
        const mechanisms: Record<string, number> = {};
        for (const s of result.seeds) {
            const key = s.mechanism ?? "none";
            mechanisms[key] = (mechanisms[key] ?? 0) + 1;
        }
        return {
            vector: vector.name,
            seeds: result.seeds.length,
            passed: result.seeds.filter((s) => s.ok).length,
            mechanisms,
            failures: result.seeds
                .filter((s) => !s.ok)
                .map((s) => ({ seed: s.seed, move: s.moveDescription })),
        };
    });
    return {
        label: scenario.label,
        iterations: scenario.budget.iterations,
        own,
        legs,
        verdict: classifyRobustness(own, legs),
    };
}

/** One printable line per entry. */
export function formatRobustnessRow(row: RobustnessRow): string {
    const legs = row.legs
        .map((leg) => {
            const mech = Object.entries(leg.mechanisms)
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([m, n]) => `${m}×${n}`)
                .join(",");
            return `${leg.vector} ${leg.passed}/${leg.seeds} [${mech}]`;
        })
        .join(" · ");
    return `${row.verdict.toUpperCase().padEnd(12)} ${row.label} — own ${row.own.passed}/${row.own.seeds} @${row.iterations} · ${legs}`;
}

/** A known noise-pinned entry. Shrink-only: a row leaves when its follow-up
 *  lands; nothing is ever added except alongside a fresh follow-up issue. */
export type RobustnessBaselineRow = {
    label: string;
    /** The follow-up issue that owns rewriting or re-budgeting the entry. */
    issue: number;
};

/** What reds the audit, each list naming the labels that caused it. */
export type RobustnessFindings = {
    /** Noise-pinned and NOT in the baseline — a new pin (or one that moved). */
    unlisted: string[];
    /** Failing its own seeds — the `must` suite is red on it too. */
    wrong: string[];
    /** In the baseline but now robust — delete the row (shrink-only). */
    cleared: string[];
    /** Baseline rows naming no `must` entry, or duplicated, or with no
     *  issue ref — checked only when `checkBaselineShape` is set, i.e. once
     *  per run rather than once per shard. */
    malformed: string[];
};

/**
 * Compare a slice of audited rows with the baseline. `rows` may be one shard's
 * slice: only the baseline rows whose label is in `rows` are judged for
 * `cleared`, so four shards together judge each row exactly once.
 */
export function compareRobustness(
    rows: readonly RobustnessRow[],
    baseline: readonly RobustnessBaselineRow[],
    options: { mustLabels?: readonly string[] } = {}
): RobustnessFindings {
    const listed = new Set(baseline.map((b) => b.label));
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    const findings: RobustnessFindings = {
        unlisted: rows
            .filter((r) => r.verdict === "noise-pinned" && !listed.has(r.label))
            .map((r) => r.label),
        wrong: rows.filter((r) => r.verdict === "wrong").map((r) => r.label),
        cleared: baseline
            .filter((b) => byLabel.get(b.label)?.verdict === "robust")
            .map((b) => b.label),
        malformed: [],
    };
    if (options.mustLabels) {
        const must = new Set(options.mustLabels);
        const seen = new Set<string>();
        for (const b of baseline) {
            if (!must.has(b.label)) {
                findings.malformed.push(`${b.label}: not a must entry`);
            }
            if (seen.has(b.label)) {
                findings.malformed.push(`${b.label}: listed twice`);
            }
            if (!Number.isInteger(b.issue) || b.issue <= 0) {
                findings.malformed.push(`${b.label}: no follow-up issue`);
            }
            seen.add(b.label);
        }
    }
    return findings;
}

/** Every finding as one message line, empty when the slice is clean. */
export function describeRobustnessFindings(f: RobustnessFindings): string[] {
    return [
        ...f.unlisted.map(
            (l) =>
                `NEW noise-pinned entry "${l}" — file its follow-up issue and add a baseline row, or rewrite the entry`
        ),
        ...f.wrong.map(
            (l) => `"${l}" fails its own seeds — the must tier is red`
        ),
        ...f.cleared.map(
            (l) =>
                `"${l}" is robust now — delete its baseline row (the baseline only shrinks)`
        ),
        ...f.malformed.map((m) => `baseline row ${m}`),
    ];
}
