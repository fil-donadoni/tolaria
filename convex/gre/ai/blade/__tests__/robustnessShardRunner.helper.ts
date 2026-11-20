/**
 * Blade robustness audit — the shared runner behind the four
 * `robustness.shard-N.spec.ts` files (issue #4875). Opt-in:
 *
 *   bun run blade:robustness      (BLADE_ROBUSTNESS=1, heavy gate, `health`)
 *
 * Without `BLADE_ROBUSTNESS=1` each shard registers one skipped test, so the
 * blade config's own `test:blade` run (which includes every `*.spec.ts` here)
 * pays nothing for it.
 *
 * Shard N audits the `must` entries `bladeShardOf` assigns it — the same
 * partition the must suite uses (`../shard.ts`), so the four files spread over
 * the heavy tier's workers. One `it` per entry: it prints the entry's
 * classification line and reds on that entry's own findings against the
 * baseline (`compareRobustness` over one row). Shard 0 also checks the
 * baseline's shape once.
 *
 * `BLADE_ROBUSTNESS_LABELS` (a JSON array of `must` labels) narrows the audit
 * to those entries — the INCREMENTAL mode of a health batch whose only
 * trigger-relevant change was registry entries (issue #5078). The baseline's
 * shape check on shard 0 runs in every mode, and shard 0 also reds on a
 * requested label that names no `must` entry (a filter that audits nothing is
 * a silently dead audit).
 *
 * `BLADE_ROBUSTNESS_PART` (`"i/N"`) narrows each shard further to part i of
 * a cost-balanced N-way split of its slice (`costBalancedSlice`, cost = the
 * entry's search iterations): the PR-side audit
 * (`.github/workflows/blade-robustness.yml`) runs N part jobs,
 * each running all four shard files on its runner's four workers. Unset (the
 * health run) audits the whole slice.
 *
 * By hand inside an issue worktree the heavy gate refuses (`gate.ts`'s
 * issue-worktree guard): `TOLARIA_ALLOW_FULL_SUITE=1 bun run blade:robustness`.
 */

import { describe, expect, it } from "vitest";
import { bladeScenariosForTier } from "..";
import {
    auditBladeScenario,
    compareRobustness,
    describeRobustnessFindings,
    formatRobustnessRow,
    ROBUSTNESS_FINDING_PREFIX,
    ROBUSTNESS_SEEDS,
    robustnessFindingRecords,
    type RobustnessFindings,
    robustnessVectors,
} from "../robustness";
import { bladeScenarioSeeds } from "../runner";
import type { BladeScenario } from "../types";
import { ROBUSTNESS_BASELINE } from "../robustnessBaseline";
import {
    BLADE_SHARDS,
    bladeShardSlice,
    costBalancedSlice,
    parseBladePart,
} from "../shard";

/** Print each finding as its machine line, then red on any (issue #5016).
 *  `test` is the calling test's own name. */
function expectNoFindings(findings: RobustnessFindings, test: string): void {
    for (const record of robustnessFindingRecords(findings, test)) {
        console.log(`${ROBUSTNESS_FINDING_PREFIX} ${JSON.stringify(record)}`);
    }
    expect(describeRobustnessFindings(findings)).toEqual([]);
}

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

const ENABLED = ENV.BLADE_ROBUSTNESS === "1";

/** The label filter, `null` for the full audit. A malformed value throws: the
 *  audit must never quietly widen or narrow itself. */
function labelFilter(): ReadonlySet<string> | null {
    const raw = ENV.BLADE_ROBUSTNESS_LABELS;
    if (raw === undefined || raw === "") return null;
    const parsed: unknown = JSON.parse(raw);
    if (
        !Array.isArray(parsed) ||
        !parsed.every((l): l is string => typeof l === "string")
    )
        throw new Error("BLADE_ROBUSTNESS_LABELS must be a JSON string array");
    return new Set(parsed);
}

/** Floor of an entry's timeout: the 2000-iteration entries measured past the
 *  config's 120 s on a loaded machine (issue #4875). */
const ENTRY_TIMEOUT_FLOOR_MS = 900_000;

/** Wall-clock allowance per search iteration. A rich board costs ~23 ms an
 *  iteration idle (issue #5424: 1000 iterations = 23 s a search); the Oko
 *  loyalty entry measured 137 ms an iteration on a GitHub-hosted runner
 *  (issue #10319: 14,000 iterations, 1914 s, past the 900 s floor). 200 ms is
 *  that plus half: the timeout is a hang guard, never a speed assertion. */
const MS_PER_ITERATION = 200;

/** An entry's audit cost in search iterations: it runs its own seeds plus
 *  every vector over the wide seed list, each search at the entry's
 *  iterations budget. */
export function entrySearchIterations(
    scenario: BladeScenario,
    vectorCount: number
): number {
    const searches =
        bladeScenarioSeeds(scenario).length +
        vectorCount * ROBUSTNESS_SEEDS.length;
    return searches * scenario.budget.iterations;
}

/** An entry's timeout: the cost scales with the budget, so a fixed cap would
 *  eventually time out a heavy board with no finding. */
export function entryTimeoutMs(
    scenario: BladeScenario,
    vectorCount: number
): number {
    return Math.max(
        ENTRY_TIMEOUT_FLOOR_MS,
        entrySearchIterations(scenario, vectorCount) * MS_PER_ITERATION
    );
}

/** Register shard `shard` (0-based) of the robustness audit. */
export function registerRobustnessShard(shard: number): void {
    const title = `blade robustness audit — shard ${shard + 1}/${BLADE_SHARDS}`;
    if (!ENABLED) {
        describe(title, () => {
            it.skip("opt-in: bun run blade:robustness", () => {});
        });
        return;
    }

    const must = bladeScenariosForTier("must");
    const vectors = robustnessVectors();
    const only = labelFilter();
    const part = parseBladePart(ENV.BLADE_ROBUSTNESS_PART);

    describe(title, () => {
        if (shard === 0) {
            const shapeTest =
                "the baseline names must entries, once each, with an issue";
            it(shapeTest, () => {
                const findings = compareRobustness([], ROBUSTNESS_BASELINE, {
                    mustLabels: must.map((s) => s.label),
                });
                expectNoFindings(findings, shapeTest);
            });
            if (only !== null) {
                it("every requested label names a must entry", () => {
                    const known = new Set(must.map((s) => s.label));
                    expect([...only].filter((l) => !known.has(l))).toEqual([]);
                });
            }
        }

        const slice = bladeShardSlice(must, shard);
        const audited = (
            part === null
                ? slice
                : costBalancedSlice(slice, part.part, part.parts, (s) =>
                      entrySearchIterations(s, vectors.length)
                  )
        ).filter((s) => only === null || only.has(s.label));
        // A filtered shard or part may own none of the entries; vitest reds a
        // suite with no test in it.
        if (shard !== 0 && audited.length === 0)
            it.skip("no entry of the filter in this shard", () => {});

        for (const scenario of audited) {
            it(
                scenario.label,
                { timeout: entryTimeoutMs(scenario, vectors.length) },
                () => {
                    const row = auditBladeScenario(scenario, vectors);
                    console.log(
                        `[blade:robustness] ${formatRobustnessRow(row)}`
                    );
                    const findings = compareRobustness(
                        [row],
                        ROBUSTNESS_BASELINE.filter((b) => b.label === row.label)
                    );
                    expectNoFindings(findings, scenario.label);
                }
            );
        }
    });
}
