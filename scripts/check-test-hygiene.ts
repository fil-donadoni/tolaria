#!/usr/bin/env bun
/**
 * Test-suite hygiene census (issue #4490, PRD #4481).
 *
 * Runs the identity-test classifier's repo-wide dry run
 * (`scripts/purge-identity-tests.ts --dry`) and reds on anything the purge
 * left at zero growing back: identity blocks outside the named allow-list,
 * Op-only blocks on pure-DSL cards in the card-set suites, and a stale or
 * ambiguous allow-list entry. The verdict itself is `lib/test-hygiene.ts`.
 *
 * A `health` step (`HEALTH_SCRIPTS`), never a PR-phase gate: the census
 * loads the whole catalogue to know which cards are pure-DSL and walks every
 * test file (~7s measured), and a PR diff cannot move its answer in a way the
 * classifier's own unit tests would not catch. Only the Op-only half needs
 * the catalogue; the identity half is cheap, and it still lives here, by the
 * issue's decision that no new guard joins a PR-phase gate. The price is
 * that a new constant-pin test lands green and reds the next `health` run,
 * which then names the block and the fix (delete it, or allow-list a census /
 * partition / domain pin by name with its reason). The `convex/cards/sets/**`
 * identity guard that predates it (`scripts/__tests__/
 * identity-only-card-tests.test.ts`, issue #2363) stays where it is, in the
 * PR-phase suite, at its original scope.
 *
 * Scoped through the content-hash guard cache (`lib/guard-cache.ts`): the
 * verdict is a pure function of the test corpus, the card registry (which
 * decides pure-DSL), the classifier and its allow-list under `scripts/lib/**`,
 * and the two scripts. `health` bypasses the cache and proves it from scratch;
 * a by-hand re-run on an unchanged tree skips with `cached PASS`.
 */
import {
    CARD_REGISTRY_GLOBS,
    TEST_CORPUS_GLOBS,
    enterGuardCache,
} from "./lib/guard-cache";

// Before the classifier and registry imports: a cached PASS never pays for them.
enterGuardCache({
    guard: "check:test-hygiene",
    globs: [
        ...CARD_REGISTRY_GLOBS,
        ...TEST_CORPUS_GLOBS,
        "scripts/purge-identity-tests.ts",
        "scripts/check-test-hygiene.ts",
    ],
});

const { dryRun, loadCardFacts, readRelativeImport, trackedTestFiles } =
    await import("./purge-identity-tests");
const { hygieneVerdict } = await import("./lib/test-hygiene");
const fs = await import("node:fs");
const path = await import("node:path");

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const sources = trackedTestFiles().map((file) => ({
    file,
    source: fs.readFileSync(path.join(REPO_ROOT, file), "utf-8"),
}));
const report = dryRun(sources, await loadCardFacts(), readRelativeImport);
const verdict = hygieneVerdict(report);

const summary =
    `check:test-hygiene: ${report.files} test files, ${report.blocks} blocks — ` +
    `identity ${report.identity.flagged} (+${report.identity.allowListed} allow-listed), ` +
    `Op-only ${report.opOnly.blocks}, definition-read lines ${report.definitionReads.lines} (reported, not gated)`;

if (verdict.ok) {
    console.log(`✓ ${summary}`);
} else {
    console.error(`✗ ${summary}`);
    for (const line of verdict.findings) console.error(line);
    process.exit(1);
}
