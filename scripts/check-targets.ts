#!/usr/bin/env bun
/**
 * The Coverage Invariant (issue #3868, wayfinder issue #3848, map #3846):
 * every card of every ENFORCED Target List is in exactly one coverage state,
 * and every state is a decision with an issue behind it. Red on:
 *
 *   - an `unclaimed` card — a quarantine class with no `mechanic`/`scenario`
 *     claim, a gap at or above `handTailFloor` with no `grammar` claim, or a
 *     below-floor card with neither a `hand-tail` claim nor a `hand-tail:`
 *     marker (the reason is printed per card);
 *   - a `hand-tail:` marker on a card whose lockfile row is `ready` — retire
 *     the hand-written twin (ADR 0114);
 *   - a `hand-tail:` marker on a card whose residual gaps now include one at
 *     or above the floor — flip the marker to `compiler-gap:`.
 *
 * The hand tail is a state, not a sentence: those last two are what keep a
 * marker honest after the grammar moves. A protocol card (closure body, Guard
 * C `incomparable`) is exempt from both — its exit is the report's
 * "compare behaviour by hand" line.
 *
 * The states are `coverageVerdict`'s, the one computation `oracle:report
 * --targets` renders from; the context is `buildCoverageContext`'s, the one
 * reader of markers, claims and closures. Nothing here re-derives either.
 *
 * Enforcement is opt-in per Target (`enforced: true` in data/targets.json):
 * an invariant over every registered card was 12k cards red the day it
 * landed. Liveness of the issues the claims name is the network sweep's
 * question, as for Guard B — never health's.
 *
 * Offline. Runs in `health` ONLY (`HEALTH_SCRIPTS`), never in `check:all`,
 * `check:pr` or `land` — asserted by `check-targets.test.ts`.
 *
 * Run: bun run check:targets
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { buildCoverageContext } from "./lib/coverage-context";
import { parseLockfile } from "./lib/oracle-lockfile";
import {
    readTargetRegistry,
    resolveContext,
    resolveTarget,
    targetCoverage,
    type TargetCoverage,
} from "./lib/targets";

const LOCKFILE_PATH = "data/oracle-compiled.json";

/** Every red of the enforced coverages, one line each; empty = green. */
export function auditCoverage(coverages: readonly TargetCoverage[]): string[] {
    const reds: string[] = [];
    for (const coverage of coverages) {
        if (!coverage.enforced) continue;
        for (const { name, why } of coverage.unclaimed)
            reds.push(`${coverage.id}: ${name} — unclaimed: ${why}`);
        for (const { name, why } of coverage.migrable)
            reds.push(`${coverage.id}: ${name} — hand-tail marker: ${why}`);
    }
    return reds;
}

function main(): void {
    const root = resolvePath(import.meta.dirname, "..");
    const lock = parseLockfile(
        readFileSync(resolvePath(root, LOCKFILE_PATH), "utf8")
    );
    const registry = readTargetRegistry(root);
    const resolve = resolveContext(root, lock);
    const ctx = buildCoverageContext(root, lock, registry, resolve);
    const coverages = registry.targets.map((row) =>
        targetCoverage(resolveTarget(row, resolve), ctx)
    );

    const enforced = coverages.filter((c) => c.enforced);
    for (const c of coverages) {
        process.stdout.write(
            `${c.enforced ? "enforced" : "reported"}  ${c.id}: ${c.total} cards, ` +
                `${c.unclaimed.length} unclaimed, ${c.migrable.length} migrable hand-tail\n`
        );
    }
    if (enforced.length === 0) {
        process.stdout.write(
            "check:targets — no Target is enforced yet (data/targets.json `enforced: true`); " +
                "nothing to red\n"
        );
        return;
    }

    const reds = auditCoverage(coverages);
    if (reds.length > 0) {
        process.stderr.write(
            `\ncheck:targets — ${reds.length} Coverage Invariant violation(s):\n` +
                reds.map((r) => `  ${r}`).join("\n") +
                "\n\nFile the missing claim in data/grammar-gaps.json `claims` " +
                "(bun run gaps:sync), add the `hand-tail:` marker, or act on the migrable line.\n"
        );
        process.exit(1);
    }
    process.stdout.write(
        `check:targets — green: ${enforced.length} enforced Target(s), every card claimed\n`
    );
}

if (import.meta.main) main();
