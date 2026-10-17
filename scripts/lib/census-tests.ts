/**
 * Census TESTS: test files whose verdict depends on repo files they discover
 * through the filesystem — a `readdirSync` walk, a glob, `git ls-files` /
 * `git grep` — rather than import (issue #5535).
 *
 * The lane scopes vitest by the import graph (ADR 0154 §2, `test-reach.ts`),
 * and no import edge names a directory: a census was planned only when the
 * diff happened to touch a module it imports. A diff that changed only its
 * CORPUS passed the lane and turned the base red — PR #5534 added a
 * `.claude/` path to `dashboard-actions.test.ts`, `docs-lane.test.ts` (which
 * censuses every `scripts/__tests__` file naming `.claude/`) was not related,
 * and the next PR whose lane did reach it was refused for a violation it did
 * not introduce.
 *
 * ADMISSION, NOT SCOPING — the `CHEAP_GUARDS` shape (`check-lane.ts`) for a
 * census written as a vitest file: `relatedTests` adds each row's test to its
 * project whenever a changed path matches `admits`, so it rides the one
 * `vitest(related)` run and is never run twice. `admits` is the corpus the
 * test walks, wide on purpose: a census costs its file's runtime, a missed
 * input is a red base.
 *
 * A row over the lane's guard budget carries `healthOnly` with its measured
 * cost and is never admitted (issue #4963's tier rule).
 *
 * `census-tests.test.ts` keeps the table honest: every `scripts/__tests__`
 * file matching `DIRECTORY_WALK` is a row here or in `CENSUS_WALK_EXEMPT`
 * with the reason its walk censuses no repo corpus. SCOPE: `scripts/__tests__`
 * only, where the tree's census guards live; a directory-walking test under
 * `convex/` or `src/` is not seen by the guard and stays health's.
 */

export interface CensusTest {
    /** Repo-relative test file. */
    test: string;
    /** A changed repo-relative path the census reads. */
    admits: RegExp;
    /**
     * The measured cost of a census over the lane's ~10 s guard budget
     * (issue #4963's tier rule): declared, so the table stays whole, but never
     * admitted — health runs it with the full suite.
     */
    healthOnly?: string;
}

/** The source shapes that walk a directory or grep the tree. */
export const DIRECTORY_WALK =
    /\b(?:readdir|opendir|glob)(?:Sync)?\(|["']ls-files["']|\bgit (?:ls-files|grep)\b/;

export const CENSUS_TESTS: readonly CensusTest[] = [
    // .claude/, docs/agents/ and CLAUDE.md — agent-facing names in resident docs
    {
        test: "scripts/__tests__/action-space.test.ts",
        admits: /^(\.claude|docs\/agents)\/|^CLAUDE\.md$/,
    },
    // scripts/**/*.ts and .claude/skills/**/*.md — banned data recipes
    {
        test: "scripts/__tests__/destructive-data-recipes.test.ts",
        admits: /^scripts\/|^\.claude\/skills\//,
    },
    // every tracked file — no text source reads as binary
    {
        test: "scripts/__tests__/source-control-bytes.test.ts",
        admits: /./,
    },
    // docs/adr/ — every ADR has its index row
    { test: "scripts/__tests__/adr-index.test.ts", admits: /^docs\/adr\// },
    // src/, scripts/ — the accessibility-gate exemption attribute
    {
        test: "scripts/__tests__/axe-exemption-scope.test.ts",
        admits: /^(src|scripts)\//,
    },
    // every *.bot.test.ts under convex/, src/, scripts/
    {
        test: "scripts/__tests__/bot-fast-lane.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // the bot-test boundary over convex/, src/, scripts/
    {
        test: "scripts/__tests__/bot-suite-boundary.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // scripts/ and .claude/hooks/ — origin/<branch> literals
    {
        test: "scripts/__tests__/branches.test.ts",
        admits: /^(scripts|\.claude\/hooks)\//,
    },
    // the card sets' __tests__ files
    {
        test: "scripts/__tests__/card-test-seam-boundary.test.ts",
        admits: /^convex\/cards\/sets\//,
    },
    // scripts/__tests__/ — this table's own census
    {
        test: "scripts/__tests__/census-tests.test.ts",
        admits: /^scripts\/__tests__\//,
    },
    // src/ entries and their convex/ import closure
    {
        test: "scripts/__tests__/client-bundle-purity.test.ts",
        admits: /^(src|convex)\//,
    },
    // compiledPool imports over convex/, src/, scripts/
    {
        test: "scripts/__tests__/compiled-pool-client-seam.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // convex/, src/, scripts/ — every importer of `setModules` (issue #5615)
    {
        test: "scripts/__tests__/set-modules-client-seam.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // convex/ top-level game*/debug* modules and their bundled import closure
    {
        test: "scripts/__tests__/convex-card-free-seam.test.ts",
        admits: /^convex\//,
    },
    // src/ tests mocking the cards barrel, resolved into convex/cards/
    {
        test: "scripts/__tests__/convex-cards-barrel-mock.test.ts",
        admits: /^(src|convex\/cards)\//,
    },
    // scripts/__tests__/ — every test that reads prose is classified
    {
        test: "scripts/__tests__/docs-lane.test.ts",
        admits: /^scripts\/__tests__\//,
    },
    // duplicate test blocks over convex/, src/, scripts/, dashboard/
    {
        test: "scripts/__tests__/duplicate-test-blocks.test.ts",
        admits: /^(convex|src|scripts|dashboard)\//,
        healthOnly:
            "17.3 s alone (vitest Duration), load ~19, 2026-10-12 — 20 s inside the 35-file census run",
    },
    // docs/findings/ — every drawer entry parses
    { test: "scripts/__tests__/findings.test.ts", admits: /^docs\/findings\// },
    // data/full-catalogue/ artefacts
    {
        test: "scripts/__tests__/full-catalogue-size.test.ts",
        admits: /^data\/full-catalogue\/|^(package\.json|scripts\/ensure-full-catalogue\.mjs|src\/lib\/fullCatalogue\.ts)$/,
    },
    // .claude/hooks/ and their registration in .claude/settings.json
    {
        test: "scripts/__tests__/hook-policy.test.ts",
        admits: /^\.claude\/(hooks\/|settings\.json$)/,
    },
    // the card sets' test files
    {
        test: "scripts/__tests__/identity-only-card-tests.test.ts",
        admits: /^convex\/cards\/sets\//,
    },
    // vi.mock boundary over convex/, src/, scripts/
    {
        test: "scripts/__tests__/isolation-off-mock-boundary.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // scripts/**/*.ts — every host-platform read is a pinned role or mechanics
    {
        test: "scripts/__tests__/machine-pins.test.ts",
        admits: /^scripts\/.*\.ts$|^vitest\.setup\.node\.ts$/,
    },
    // health-main.ts (spawned, never imported) and the /health-fix skill's
    // prose — the RED evidence is read from the store, never a log path
    // (issue #5589). Measured: 352 ms of tests, ~5.9 s wall-clock.
    {
        test: "scripts/__tests__/health-evidence-pivot.test.ts",
        admits: /^scripts\/health-main\.ts$|^\.claude\/skills\/health-fix\/SKILL\.md$/,
    },
    // convex/manual.ts and convex/manual/
    {
        test: "scripts/__tests__/manual-boundary.test.ts",
        admits: /^convex\/manual(\.ts$|\/)/,
    },
    // manual-* / useManual* modules under src/
    {
        test: "scripts/__tests__/manual-no-native-dialog.test.ts",
        admits: /^src\/(lib|components\/board|hooks)\//,
    },
    // scripts/merge-driver-*.ts
    {
        test: "scripts/__tests__/merge-driver-io.test.ts",
        admits: /^scripts\/merge-driver-[^/]+\.ts$/,
    },
    // perf tests over convex/, src/, scripts/ and the vitest projects
    {
        test: "scripts/__tests__/perf-test-boundary.test.ts",
        admits: /^(convex|src|scripts)\/|^vitest\.config\.ts$/,
    },
    // .claude/skills|rules|hooks/, every CLAUDE.md, scripts/
    {
        test: "scripts/__tests__/project-skills.test.ts",
        admits: /^\.claude\/(skills|rules|hooks)\/|(^|\/)CLAUDE\.md$|^scripts\//,
    },
    // .claude/rules|skills/ and every CLAUDE.md
    {
        test: "scripts/__tests__/resident-context-budget.test.ts",
        admits: /^\.claude\/(rules|skills)\/|(^|\/)CLAUDE\.md$/,
    },
    // every convex/ module
    {
        test: "scripts/__tests__/server-registry-enumerators.test.ts",
        admits: /^convex\//,
    },
    // .claude/skills/
    {
        test: "scripts/__tests__/skill-invocation.test.ts",
        admits: /^\.claude\/skills\/|^scripts\/loop-drain\.sh$/,
    },
    // every test file and the vitest project partition
    {
        test: "scripts/__tests__/src-test-env-split.test.ts",
        admits: /^(convex|src|scripts|dashboard)\/|^vitest\.config\.ts$/,
    },
    // every __tests__/fixtures/ path
    {
        test: "scripts/__tests__/test-fixtures-tracked.test.ts",
        admits: /\/__tests__\/fixtures\/|^\.gitignore$/,
    },
    // the vitest project include globs, mirrored by test-reach
    {
        test: "scripts/__tests__/test-reach.test.ts",
        admits: /^(convex|src|scripts|dashboard)\/|^vitest\.config\.ts$/,
    },
    // every tracked test file's tmp teardown
    {
        test: "scripts/__tests__/test-tmp-teardown.test.ts",
        admits: /^(convex|src|scripts|dashboard)\//,
    },
    // convex/cards/abilities/triggers/
    {
        test: "scripts/__tests__/trigger-gate-marking.test.ts",
        admits: /^convex\/cards\/abilities\/triggers\//,
    },
    // the repo-root tsconfig*.json projects
    {
        test: "scripts/__tests__/tsconfig-convex-node-types.test.ts",
        admits: /^tsconfig[^/]*\.json$/,
    },
    // vacuous alias assertions over convex/, src/, scripts/
    {
        test: "scripts/__tests__/vacuous-alias-assertion.test.ts",
        admits: /^(convex|src|scripts)\//,
    },
    // scripts/, src/ — no file names the write credential
    {
        test: "scripts/__tests__/verdict-store-credentials.test.ts",
        admits: /^(scripts|src)\//,
    },
    // convex/, src/ — the catalogue is the only importer of a card Set module
    {
        test: "scripts/__tests__/vite-card-sets-dev-bundle.test.ts",
        admits: /^(convex|src)\//,
    },
    // weak sole assertions over convex/, src/, scripts/, dashboard/
    {
        test: "scripts/__tests__/weak-sole-assertion.test.ts",
        admits: /^(convex|src|scripts|dashboard)\//,
    },
    // .github/ workflows and actions, .mergify.yml, the job harness (issue #5636)
    {
        test: "scripts/__tests__/workflow-structure.test.ts",
        admits: /^\.github\/|^\.mergify\.yml$|^scripts\/ci\//,
    },
];

/** Directory-walking tests that census no repo corpus, each with its reason. */
export const CENSUS_WALK_EXEMPT: Readonly<Record<string, string>> = {
    "scripts/__tests__/generated-artifact-merge.test.ts":
        "`git ls-files --error-unmatch` on the paths an imported table names, never a directory; it censuses no repo corpus",
    "scripts/__tests__/worktree-bootstrap.test.ts":
        "`git ls-files` on named .husky/ hook paths, never a directory walk; it censuses no repo corpus",
    "scripts/__tests__/convex-ensure.test.ts":
        "a scratch telemetry dir the test creates; it censuses no repo corpus",
    "scripts/__tests__/gate-run.test.ts":
        "scratch run dirs the test creates; it censuses no repo corpus",
    "scripts/__tests__/health-main-preflight.test.ts":
        "a scratch log dir; it censuses no repo corpus",
    "scripts/__tests__/health-main-headroom.test.ts":
        "a mkdtemp dir; it censuses no repo corpus",
    "scripts/__tests__/identity-test-classifier.test.ts":
        "`readdirSync` inside an inline source-string fixture; it censuses no repo corpus",
    "scripts/__tests__/ladder-verdict.test.ts":
        "`git ls-files` named in a comment only; it censuses no repo corpus",
    "scripts/__tests__/loop-drain-lanes.test.ts":
        "scratch telemetry dirs; it censuses no repo corpus",
    "scripts/__tests__/loop-handoff.test.ts":
        "a scratch telemetry dir; it censuses no repo corpus",
    "scripts/__tests__/machine-admission-spawn.test.ts":
        "a scratch log dir; it censuses no repo corpus",
    "scripts/__tests__/receipt.test.ts":
        "`readdirSync` named in comments and test titles only; it censuses no repo corpus",
    "scripts/__tests__/queue-plan.test.ts":
        "a scratch cache dir; it censuses no repo corpus",
    "scripts/__tests__/ui-gate-lane-account.test.ts":
        "a scratch root dir; it censuses no repo corpus",
    "scripts/__tests__/verdict-pack-cache.bot.test.ts":
        "scratch cache dirs; it censuses no repo corpus",
    "scripts/__tests__/vitest-fs-cache-invalidation.test.ts":
        "a scratch vitest cache dir; it censuses no repo corpus",
};

/** The census tests `changed` admits, in table order. */
export function admittedCensusTests(
    changed: readonly string[],
    census: readonly CensusTest[] = CENSUS_TESTS
): string[] {
    return census
        .filter(
            ({ admits, healthOnly }) =>
                healthOnly === undefined && changed.some((p) => admits.test(p))
        )
        .map(({ test }) => test);
}
