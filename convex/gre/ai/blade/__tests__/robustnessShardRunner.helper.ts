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
 * By hand inside an issue worktree the heavy gate refuses (`gate.ts`'s
 * issue-worktree guard): `TOLARIA_ALLOW_FULL_SUITE=1 bun run blade:robustness`.
 *
 * `BLADE_ROBUSTNESS_SCOPE=tiebreak` (issue #5016, `check:lane` on a diff under
 * the Bot's `convex/` globs) runs every entry's own seeds and the wide legs
 * only where `robustnessScopeAdmits` says so; a skipped entry still owes its
 * own seeds green.
 */

import { describe, expect, it } from "vitest";
import { bladeScenariosForTier, runBladeScenario } from "..";
import {
    auditBladeScenario,
    compareRobustness,
    describeRobustnessFindings,
    formatRobustnessRow,
    ROBUSTNESS_FINDING_PREFIX,
    robustnessFindingRecords,
    type RobustnessFindings,
    parseRobustnessScope,
    robustnessScopeAdmits,
    robustnessVectors,
} from "../robustness";
import { ROBUSTNESS_BASELINE } from "../robustnessBaseline";
import { BLADE_SHARDS, bladeShardSlice } from "../shard";

/** Print each finding as its machine line, then red on any (issue #5016). */
function expectNoFindings(findings: RobustnessFindings): void {
    for (const record of robustnessFindingRecords(findings)) {
        console.log(`${ROBUSTNESS_FINDING_PREFIX} ${JSON.stringify(record)}`);
    }
    expect(describeRobustnessFindings(findings)).toEqual([]);
}

const ENV: Record<string, string | undefined> =
    (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {};

const ENABLED = ENV.BLADE_ROBUSTNESS === "1";

const SCOPE = parseRobustnessScope(ENV.BLADE_ROBUSTNESS_SCOPE);

/** One entry is ~31 searches at its own budget; the 2000-iteration entries
 *  measured past the config's 120 s on a loaded machine (issue #4875). */
const ENTRY_TIMEOUT_MS = 900_000;

/** Register shard `shard` (0-based) of the robustness audit. */
export function registerRobustnessShard(shard: number): void {
    const title = `blade robustness audit [${SCOPE}] — shard ${shard + 1}/${BLADE_SHARDS}`;
    if (!ENABLED) {
        describe(title, () => {
            it.skip("opt-in: bun run blade:robustness", () => {});
        });
        return;
    }

    const must = bladeScenariosForTier("must");
    const vectors = robustnessVectors();

    describe(title, () => {
        if (shard === 0) {
            it("the baseline names must entries, once each, with an issue", () => {
                const findings = compareRobustness([], ROBUSTNESS_BASELINE, {
                    mustLabels: must.map((s) => s.label),
                });
                expectNoFindings(findings);
            });
        }

        for (const scenario of bladeShardSlice(must, shard)) {
            it(scenario.label, { timeout: ENTRY_TIMEOUT_MS }, () => {
                const own = runBladeScenario(scenario);
                if (!robustnessScopeAdmits(SCOPE, own, ROBUSTNESS_BASELINE)) {
                    console.log(
                        `[blade:robustness] SKIPPED      ${scenario.label} — own seeds settled without material-tiebreak (scope ${SCOPE})`
                    );
                    expect(own.ok, own.failureMessage).toBe(true);
                    return;
                }
                const row = auditBladeScenario(scenario, vectors, own);
                console.log(`[blade:robustness] ${formatRobustnessRow(row)}`);
                const findings = compareRobustness(
                    [row],
                    ROBUSTNESS_BASELINE.filter((b) => b.label === row.label)
                );
                expectNoFindings(findings);
            });
        }
    });
}
