#!/usr/bin/env bun
/**
 * `bun run check:lane` — the gate-lane classifier AND executor (issue
 * #2741, wiring up the classifier landed inert in #2740; parent #2738). It
 * reads the changed paths against `origin/main`, decides which lane the
 * diff qualifies for, PRINTS the plan (the ordered list of checks that lane
 * runs, and the skip list with the reason for each skip), then EXECUTES
 * that exact plan and prints a receipt: per-check pass/fail/not-run with
 * wall-clock.
 *
 * ONE PLAN OBJECT, BUILT ONCE. `main()` calls `classifyLane` exactly once
 * and hands the resulting `LanePlan` to `executePlan`, the single function
 * that fans it out to `renderPlan`, `runPlan` and `renderJson` — none of
 * which can independently rebuild a plan, because none of them (nor
 * `executePlan`) has access to `classifyLane` or the git plumbing. There is
 * no second list of commands anywhere and no second JSON renderer — the
 * failure this guards against is a receipt that describes a different run
 * from the one that happened (a skip line claiming "dom skipped" while dom
 * actually ran, or vice versa; or a `--json` blob hand-built next to
 * `renderJson` instead of through it, #2748 review finding 1).
 * `check-lane.test.ts` pins this two ways: a behavioural test that
 * `executePlan` renders and executes off the exact same plan it was given,
 * and a narrower textual check that `classifyLane` itself has exactly one
 * call site in this file.
 *
 * THE LANE IS DERIVED FROM THE DIFF AND CAN NEVER BE DECLARED BY A FLAG.
 * A `--skin` flag is a hand-maintained list in disguise: the first agent
 * that passes it out of habit on a diff touching `convex/` gets a lying
 * green. There is no lane flag here and there must never be one.
 *
 * FAIL-CLOSED IS THE LOAD-BEARING PROPERTY. `classifyPath` returns `full`
 * for anything it does not affirmatively recognise, and `laneFor` returns
 * `full` as its terminal statement with every narrower lane guarded by an
 * affirmative predicate (`every(... === "skin")`, `every(... === "docs")`,
 * `!includes("skin")`).
 * Reordering those clauses cannot turn an unknown path into `skin`. The
 * explicit `FULL_PATTERNS` rules below are therefore documentation of the
 * dominant cases AND a guard that beats any future widening of the skin
 * rules — they are not what makes the default safe.
 *
 * NAMES MUST BE INVOKABLE. Every `command` string in a plan is something
 * that can really be run today; `check-lane.test.ts` pins that (`bun run X`
 * resolves to a package.json script, `--project X` to a real vitest
 * project, every `tsconfig*.json` named actually exists). A pretty receipt
 * full of aspirational names would be a plan #2741 cannot execute.
 *
 * Usage:
 *   bun run check:lane                # classify HEAD against origin/main
 *   bun run check:lane --base=<ref>   # classify against another base
 *   bun run check:lane --json         # emit the plan + receipt as JSON
 *   bun run check:lane --plan         # print the classification, run NOTHING
 *   bun run check:lane --retry-flaky  # re-run a failed vitest command once (queue lane, issue #5640)
 *
 * Exits 1 on a dirty working tree, so the HEAD SHA it prints describes
 * exactly what was classified — and exits 1 again if that tree MOVES under
 * the run (issue #4379, finding 2727: husky's `lint-staged` stash). The
 * receipt carries the start and end SHA it asserted.
 *
 * `--plan` IS NOT A LANE FLAG (ADR 0136 §8). It suppresses EXECUTION, never
 * classification: the lane still comes from the diff, through the same
 * `classifyLane` call every other mode uses. It exists because
 * `/next-ticket` §3 keys its `cards` short path — no hand-written test, no
 * proof-of-failure, no bot or frontend walk — on the lane the diff really
 * classifies as, and a session that had to PAY a lane gate to learn that
 * would be running the pre-PR gate §1 retired. Ask after committing: the
 * dirty-tree refusal applies here too, and an uncommitted card is a path the
 * classifier cannot see.
 *
 * NO STALENESS REFUSAL (ADR 0136 §1). Issue #3286 made this refuse a tree
 * behind the base tip or a RED base before paying the gate, to stop a
 * hand-run PRE-PR gate being paid twice. There is no pre-PR gate any more —
 * `land` pays the lane once, on the rebased tip, inside the mutex — so the
 * refusal went with it. A hand-run `check:lane` gates whatever HEAD is, stale
 * or not.
 *
 * `--preflight` (issue #4967, `land`'s static half on the un-rebased head) is
 * retired with `land`'s preflight (ADR 0154 §5, issue #5457).
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BLADE_INDEX_DRIFT_TEST } from "./lib/blade-card-index";
import { ORIGIN_BASE } from "./lib/branches";
import { DOC_GATE_TESTS } from "./lib/doc-gate-tests";
import { failingFiles } from "./lib/health-evidence";
import { laneFlakeOf, planLaneRetry, type LaneFlake } from "./lib/health-retry";
import {
    reachIndex,
    relatedTests,
    type ReachIndex,
    type RelatedTests,
} from "./lib/test-reach";

/** The whole node project, as its two fixed partitions (ADR 0136 §5). */
export const NODE_PARTITIONS = "--project node-engine --project node-tooling";

/**
 * The tests a diff reaches through the import graph (ADR 0154 §2, issue
 * #5464) — see `lib/test-reach.ts` for what the walk sees and what it cannot,
 * and why it is a static walk and not vitest's own `--changed`.
 *
 * The INDEX is memoised, never a result: `classifyLane` is called once per
 * process in production, but the walk is ~1–2 s and the `--plan` mode exists
 * precisely so asking which lane a diff owes costs little (ADR 0136 §1/§8).
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let memoisedIndex: ReachIndex | null = null;
function defaultRelated(paths: string[]): RelatedTests {
    memoisedIndex ??= reachIndex(REPO_ROOT);
    return relatedTests(memoisedIndex, paths);
}

// ─────────────────────────────────────────────────────────────────────────
// Path classification
// ─────────────────────────────────────────────────────────────────────────

export type Lane = "skin" | "engine" | "cards" | "docs" | "full";

/**
 * What a single changed path admits. `full` is the fail-closed default.
 *
 * `data` is a PATH class and never a lane: a generated or vendored artefact
 * rides with whatever code regenerated it — `cards` beside a card definition,
 * `engine` on its own or beside any other engine path (ADR 0136 §3/§4).
 */
export type PathClass = Lane | "data";

/**
 * Paths that force the full gate no matter what else is in the diff. Every
 * one of these would already be `full` by the fail-closed default; listing
 * them explicitly, and matching them FIRST, means a future widening of the
 * skin/engine rules cannot quietly swallow one.
 *
 * FULL IS A PLACEMENT, NOT A FALLBACK (issue #5456). `telemetry:latency`
 * reported 22 of 157 landings (14%) paying `check:pr` whole for a
 * configuration path that has a real lane, so only what changes what EVERY
 * lane means stays here: the dependency set (`package.json` is content-
 * classified, see `packageJsonClass`; the lockfiles are always `full`) and
 * the build/test/type/lint configuration. The rest of the old list moved to
 * `ENGINE_CONFIG_PATTERNS`.
 */
const FULL_PATTERNS: RegExp[] = [
    /^package\.json$/,
    /^(bun\.lock|bun\.lockb|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
    /(^|\/)tsconfig[\w.]*\.json$/,
    /(^|\/)vite\.config\.[cm]?[jt]s$/,
    /(^|\/)vitest[\w.]*\.config\.[cm]?[jt]s$/,
    /^vitest\.setup\.ts$/,
    /(^|\/)eslint\.config\.[cm]?[jt]s$/,
    /(^|\/)\.prettierrc(\..*)?$/,
];

/**
 * Configuration that is tooling, not a lane definition (issue #5456) — each
 * row with the reason it is `engine` and not `full`:
 *
 * - `.claude/**` non-prose (hooks, `settings.json`, skill scripts): a program
 *   or harness configuration read by `scripts/__tests__` drift guards, all in
 *   `node-tooling`, which an `.claude/` path admits (see `classifyLane`).
 *   The prose half is `CLAUDE_PROSE_PATTERNS`, tested before this.
 * - `tolaria.config.json`: branch names and session caps, read through
 *   `scripts/lib/**` and proven by its tests.
 * - `.nvmrc`, `.gitattributes`, `.prettierignore`: repository plumbing; the
 *   format and drift checks of the engine lane exercise them.
 */
const ENGINE_CONFIG_PATTERNS: RegExp[] = [
    /^\.claude\//,
    /^tolaria\.config\.json$/,
    /^\.nvmrc$/,
    /^\.gitattributes$/,
    /^\.prettierignore$/,
];

/**
 * `package.json` is classified by CONTENT (issue #5456): `engine` only when
 * nothing but `scripts` (or version/description) moved, else `full` — an
 * allow-list, so `type`, `imports`, `engines`, dependencies and any unknown
 * key stay `full`.
 * Anything unparsable, added or deleted is `full` — fail-closed. Pure over the
 * two file texts; the git plumbing that fetches them is `packageJsonClasses`.
 */
/** Keys whose change cannot move any lane's meaning: allow-list, fail-closed. */
const PACKAGE_JSON_ENGINE_KEYS = new Set(["scripts", "version", "description"]);

export function packageJsonClass(
    before: string | null,
    after: string | null
): PathClass {
    if (before === null || after === null) return "full";
    try {
        const a = JSON.parse(before) as Record<string, unknown>;
        const b = JSON.parse(after) as Record<string, unknown>;
        const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
        const moved = [...keys].some(
            (k) =>
                !PACKAGE_JSON_ENGINE_KEYS.has(k) &&
                JSON.stringify(a[k]) !== JSON.stringify(b[k])
        );
        return moved ? "full" : "engine";
    } catch {
        return "full";
    }
}

/**
 * The prose half of `.claude/**` (issue #4376) — the ONE carve-out ahead of
 * `FULL_PATTERNS`.
 *
 * WHY. `^\.claude/` was written when that tree held hooks and rule indexes
 * only, and "a hook can change anything" made forcing `full` the obviously
 * right call. Issues #4087/#4090 then moved every WORKFLOW SKILL in there
 * (`/next-ticket`, `/grammar-rule`, `/to-prd`, …), so a one-line `SKILL.md`
 * edit paid `check:pr` verbatim — ~440s against ~190s for a lane and seconds
 * for `check:docs`. Measured on the last 30 landings before this change: 3
 * paid `full` for a full-forcing path, 2 of them a `SKILL.md`.
 *
 * WHAT MAKES IT SAFE is not that the file is markdown — it is that what a
 * skill or a rule index can break is a CLOSED SET of guards, and every one of
 * them is already in `DOC_GATE_TESTS`, which is what the docs lane runs and
 * what `appendDocsGuards` appends to every code lane:
 * `project-skills.test.ts` (skill drift to the user-level directory and the
 * frontmatter shape), `resident-context-budget.test.ts` (the resident byte
 * budget over `.claude/rules/**`), `agents-md-drift.test.ts` (the generated
 * `AGENTS.md` mirror of `.claude/rules/`), `bot-globs.test.ts`
 * (`.claude/rules/bot-development.md`'s `globs:` feeds
 * `scripts/lib/bot-globs.ts`), `destructive-data-recipes.test.ts` (scans
 * `.claude/skills/**\/*.md`), `gate-rule-parity.test.ts` (the gate rule held
 * in both `deny-guard.sh` and the `/next-ticket` skill), `action-space.test.ts`
 * and `cr-citation-ledger.test.ts` (a `CR` line in a skill owes a ledger
 * entry). `format:check`'s glob already covers `**\/*.md`, so prettier reaches
 * these too. `docs-lane.test.ts` is what keeps that set honest: its census
 * refuses a new `scripts/__tests__` file that mentions `.claude/` and is
 * neither in `DOC_GATE_TESTS` nor in `DOC_GATE_TESTS_EXCLUDED` with a reason.
 *
 * ANCHORED TO `.md` IN TWO NAMED DIRECTORIES, for the same reason
 * `DOCS_PATTERNS` is: a directory must never promote a non-prose file into
 * the prose lane. `.claude/skills/next-ticket/lib/plan.ts`,
 * `.claude/hooks/deny-guard.sh`, `.claude/settings.json` and `.claude/CLAUDE.md`
 * all still reach `FULL_PATTERNS` — the first three because they are programs
 * or configuration, the last because it is neither a skill nor a rule index
 * and nothing enumerates what reads it.
 */
const CLAUDE_PROSE_PATTERNS: RegExp[] = [
    /^\.claude\/skills\/(?:[^/]+\/)+[^/]+\.md$/,
    /^\.claude\/rules\/[^/]+\.md$/,
];

/**
 * Paths a `skin` diff may contain: the client and what it serves.
 *
 * DIRECTORY IS THE PRIMARY KEY, AND AN EXTENSION IS NEVER A KEY AT ALL.
 * This list used to carry `/\.css$/` and an unanchored asset-extension
 * alternation, and `classifyPath` tests it BEFORE `ENGINE_PATTERNS` — so any
 * path outside `data/` and `.claude/` classified as `skin` on its extension
 * alone, whatever directory it lived in: `convex/gre/theme.css`,
 * `convex/cards/art/x.svg`, `docs/img/a.png`, and the five tracked
 * `.agents/skills/<skill>/assets/icon.svg` files that exist in the repo
 * today (round-1 review of #2740). The sharpest symptom was
 * `scripts/ui-gate/report.css` ⇒ `lane=skin`, whose rendered skip reason read
 * "no changed path under convex/** or scripts/**" — a false statement in the
 * one artifact whose entire purpose is to be judgable, and the single place
 * where this file's "unknown never means skin" was not structural.
 *
 * `^src/` and `^public/` already admit every stylesheet and asset that
 * belongs to the client, so anchoring costs nothing and an extension can no
 * longer promote a path out of `full`/`engine`.
 */
const SKIN_PATTERNS: RegExp[] = [/^src\//, /^public\//, /^index\.html$/];

/**
 * Paths that are server/tooling code but do not force the full gate.
 *
 * `data/**` IS ENGINE, NOT FULL (ADR 0136 §3). It used to sit in
 * `FULL_PATTERNS`, and that one line sent 40 of 300 PRs (2026-09-03 →
 * 09-17) to `check:pr` whole for no other reason than the two artefacts every
 * card PR regenerates, `data/card-index.json` and
 * `data/cr/citations-ledger.json`. What lives there is generated or vendored
 * input to the engine — the card index, the oracle lockfiles, the CR text and
 * its ledger, set JSON, pick ratings — and the guards that READ it
 * (`check:index`, `check:oracle`, `cr:lint`) run in the engine lane, so an
 * edit there is proven exactly where a `convex/**` edit is. A `data/**` path
 * next to `src/**` is still a mixed diff and still `full`.
 */
const ENGINE_PATTERNS: RegExp[] = [/^convex\//, /^scripts\//];
const DATA_PATTERNS: RegExp[] = [/^data\//];

/**
 * Card definitions (ADR 0136 §4). A card on already-exercised Ops is DATA in
 * a `.ts` file (ADR 0045's per-Op regime): it cannot reach an engine test, a
 * tooling test, the app type-check or the DOM. A card that needs a new Op
 * touches `convex/gre/**` too, and that one path makes the diff `engine`.
 *
 * Anchored to `convex/cards/sets/`, NOT `convex/cards/`: the registry, the
 * types, the compiler seams and the catalogue guards live one level up, and
 * an edit there is engine work whatever it looks like.
 */
const CARDS_PATTERNS: RegExp[] = [/^convex\/cards\/sets\//];

/**
 * Prose-only paths: markdown under `docs/**` and the root-level markdown that
 * is resident agent context (`CLAUDE.md`, `GLOSSARY.md`, `README.md`).
 *
 * ANCHORED TO `.md` ON PURPOSE, for the same reason `SKIN_PATTERNS` is
 * anchored to a directory: `docs/` also holds images and stylesheets, and an
 * extension must never be what promotes a path out of `full`. `docs/img/a.png`
 * and `docs/guides/style.css` stay `full`. `.agents/**` stays `full` too — it
 * matches nothing, so it cannot reach this list. `.claude/**` is split: its
 * skills' and rules' markdown is prose by `CLAUDE_PROSE_PATTERNS` above
 * (issue #4376), everything else under it is matched by `FULL_PATTERNS`
 * FIRST and never reaches here.
 *
 * WHY A LANE AND NOT A FALLBACK. `check:docs` is already the ratified
 * definition of what a prose diff owes — the whole `wt:docs` / `docs:ship`
 * flow is built on it, and it runs `format:check`, `cr:lint` and the six node
 * test files that are precisely the guards which READ prose
 * (`adr-index`, `findings`, `project-skills`, `resident-context-budget`,
 * `action-space`, `bot-globs`). Before this lane existed, `docs/**` matched no
 * rule and fell to `full` by the fail-closed default, so `bun run land` on a
 * one-file docs branch paid the entire `check:pr` suite: 466s measured on
 * PR #2891, against seconds for `check:docs`. That gap was a standing invitation
 * to reach for `docs:ship` from muscle memory and pay the full gate whenever
 * anyone forgot — a rule prose cannot enforce, so it belongs here.
 *
 * A NESTED `CLAUDE.md` / `AGENTS.md` IS PROSE WHEREVER IT SITS. The
 * path-specific rules are two-tier: a resident index in `.claude/rules/` and
 * the full text in a `CLAUDE.md` under the directory it governs, which Claude
 * Code loads only when a session reads a file there. `AGENTS.md` is the
 * generated mirror of the same prose for Codex and opencode
 * (`scripts/build-agents-md.ts`). Those files live at `convex/` and `src/`, so
 * without the third pattern `src/CLAUDE.md` matches `SKIN_PATTERNS` (`^src/`)
 * and a markdown-only diff classifies as `skin` — which makes `bun run land`
 * demand a byte-exact `check:ui` receipt for a file that cannot reach the DOM.
 * Anchored to the two exact basenames, at any depth: this admits agent memory
 * and nothing else, so it cannot promote a stylesheet or an asset out of
 * `full`.
 */
const DOCS_PATTERNS: RegExp[] = [
    /^docs\/.*\.md$/,
    /^[^/]+\.md$/,
    /^(?:[^/]+\/)+(?:CLAUDE|AGENTS)\.md$/,
];

/**
 * Classify ONE changed path. Fail-closed: anything not affirmatively
 * recognised is `full`, so a new top-level directory nobody thought about
 * degrades to the full gate rather than to a narrowed one.
 */
export function classifyPath(path: string): PathClass {
    // BEFORE `FULL_PATTERNS`, and the only thing that is: the prose half of
    // `.claude/**` (issue #4376). Its two patterns are anchored to `.md`
    // inside `skills/` and `rules/`, so ordering it first cannot widen
    // anything else — every other path under `.claude/` falls to the very
    // next line.
    if (CLAUDE_PROSE_PATTERNS.some((re) => re.test(path))) return "docs";
    if (FULL_PATTERNS.some((re) => re.test(path))) return "full";
    // BEFORE `DOCS_PATTERNS`: `.claude/CLAUDE.md` matches the nested
    // `CLAUDE.md` rule but is not a skill or a rule index (issue #5456).
    if (ENGINE_CONFIG_PATTERNS.some((re) => re.test(path))) return "engine";
    if (DOCS_PATTERNS.some((re) => re.test(path))) return "docs";
    if (SKIN_PATTERNS.some((re) => re.test(path))) return "skin";
    if (CARDS_PATTERNS.some((re) => re.test(path))) return "cards";
    if (DATA_PATTERNS.some((re) => re.test(path))) return "data";
    if (ENGINE_PATTERNS.some((re) => re.test(path))) return "engine";
    return "full";
}

/**
 * Pick the lane from the per-path classes.
 *
 * Structurally fail-closed: `full` is the terminal statement, and each
 * narrower lane is reached only through an affirmative predicate over ALL
 * paths. There is no `else` chain whose order decides safety.
 */
export function laneFor(classes: PathClass[]): Lane {
    // An empty diff is almost always a wrong base ref or a detached HEAD,
    // not a genuinely empty change — and "nothing changed" is precisely the
    // shape that would make a narrowed gate look green for free.
    if (classes.length === 0) return "full";
    if (classes.includes("full")) return "full";
    if (classes.every((c) => c === "docs")) return "docs";
    // PROSE RIDES WITH THE CODE (ADR 0136 §3). This used to read "prose mixes
    // with nothing": a docs path in any non-pure diff forced `full`, and 75
    // of 300 PRs (2026-09-03 → 09-17) paid `check:pr` whole for an ADR or a
    // guide that travelled with the code it described. The code decides the
    // lane; `classifyLane` appends the docs lane's own node test list to it,
    // so the prose is still proven by exactly the guards `check:docs` runs.
    // `code` is never empty here — the all-docs case returned above — so the
    // two predicates below remain affirmative over every code path.
    const code = classes.filter((c) => c !== "docs");
    if (code.every((c) => c === "skin")) return "skin";
    // CARDS NEEDS A CARD (ADR 0136 §4). `data/**` alone stays `engine`: a
    // `cr:sync`, a pick-ratings refresh or a hand-edited lockfile is read by
    // `scripts/__tests__` and `convex/limited` guards the `cards` lane never
    // runs — `engine` reaches the ones that NAME the file (a file-name
    // literal is an edge, `lib/test-reach.ts`) and its drift guards read it.
    if (
        code.includes("cards") &&
        code.every((c) => c === "cards" || c === "data")
    )
        return "cards";
    if (!code.includes("skin")) return "engine";
    return "full";
}

// ─────────────────────────────────────────────────────────────────────────
// The plan object — the single source both the printer and (in #2741) the
// executor read, so the receipt cannot drift from what runs.
// ─────────────────────────────────────────────────────────────────────────

export interface PlannedCheck {
    /** Short name as it appears in the receipt. */
    id: string;
    /** A shell command that can really be run today. */
    command: string;
}

export interface SkippedCheck {
    id: string;
    /** Why this lane may skip it — judged by a reviewer, not assumed. */
    reason: string;
}

export interface LanePlan {
    lane: Lane;
    /** One line explaining the lane choice, rendered into the header. */
    rationale: string;
    /** The changed paths the lane was derived from. */
    files: string[];
    run: PlannedCheck[];
    skip: SkippedCheck[];
}

/** Extensions `prettier --check` has a parser for (see package.json § format). */
const PRETTIER_EXTENSIONS = /\.(tsx?|jsx?|json|css|md)$/;
/** Extensions the flat eslint config actually matches. */
const ESLINT_EXTENSIONS = /\.([cm]?[jt]sx?)$/;

/** Single-quote a path so a space or a non-ASCII name survives the shell. */
function shellQuote(path: string): string {
    return `'${path.replace(/'/g, `'\\''`)}'`;
}

function scopedCheck(
    id: string,
    prefix: string,
    paths: string[]
): PlannedCheck | null {
    if (paths.length === 0) return null;
    return { id, command: `${prefix} ${paths.map(shellQuote).join(" ")}` };
}

/**
 * The seconds-cost slice of `check:pr` for a `full` diff (issue #5554): the
 * lane delegates verbatim, so a pre-queue check that merely dropped `check:pr`
 * would pass exactly the largest PRs with a type error. Same commands the
 * `engine` lane plans for these ids.
 */
export function fullLaneSecondsSteps(presentPaths: string[]): PlannedCheck[] {
    return [
        scopedCheck(
            "format(diff)",
            "bunx prettier --check",
            presentPaths.filter((p) => PRETTIER_EXTENSIONS.test(p))
        ),
        scopedCheck(
            "lint(diff)",
            "bunx eslint --no-warn-ignored",
            presentPaths.filter((p) => ESLINT_EXTENSIONS.test(p))
        ),
        { id: "tsc[all]", command: "bun run check:ts" },
        { id: "cr:lint", command: "bun run cr:lint" },
    ].filter((c): c is PlannedCheck => c !== null);
}

/**
 * Build the lane plan from the changed paths.
 *
 * `presentPaths` defaults to `changedPaths` and exists for one reason: a
 * DELETED file still decides the lane (a deleted `convex/**` file is an
 * engine change) but must never be handed to prettier or eslint, which fail
 * on a path that no longer exists. The caller passes the surviving subset.
 */
export function classifyLane(
    changedPaths: string[],
    presentPaths: string[] = changedPaths,
    /**
     * The tests the diff reaches through the import graph, per vitest project
     * (ADR 0154 §2, issue #5464). Injectable so the plan builder stays a pure
     * function over its inputs — a test pins the `engine` and `skin` branches
     * against a fixture set instead of the live tree, which would make the
     * guard restate whatever the walk currently returns. Called ONLY in those
     * two branches, so `docs`, `cards` and `full` never pay the walk.
     */
    related: (paths: string[]) => RelatedTests = defaultRelated,
    /**
     * Content-decided classes (issue #5456): `package.json` only, from
     * `packageJsonClass`. Absent ⇒ the path-only class, which is `full`.
     */
    overrides: ReadonlyMap<string, PathClass> = new Map()
): LanePlan {
    const files = [...changedPaths];
    const lane = laneFor(files.map((p) => overrides.get(p) ?? classifyPath(p)));

    if (lane === "full") {
        return {
            lane,
            rationale: fullRationale(files),
            files,
            // Verbatim delegation: the fallback path is `check:pr` exactly as
            // it is today, so it cannot rot while the lanes get attention
            // (#2738 § Explicitly unchanged).
            // The cheap census guards ride AFTER it, unconditionally: the
            // fallback lane cannot say which paths moved them (issue #4963).
            // `blade-index` repeats a file `check:guards`' bot run already
            // ran — 2 s, cheaper than a second rule for one lane.
            run: [
                { id: "check:pr", command: "bun run check:pr" },
                ...CHEAP_GUARDS.map((guard) => ({
                    id: guard.id,
                    command: cheapGuardCommand(guard),
                })),
            ],
            skip: [],
        };
    }

    if (lane === "docs") {
        return {
            lane,
            rationale: docsRationale(files),
            files,
            // Verbatim delegation, for the same reason the `full` lane
            // delegates to `check:pr`: `check:docs` is what the docs lane
            // already owes (`docs:ship` runs exactly this), so naming it
            // whole means this lane cannot drift from it — if `check:docs`
            // grows a check, this grows with it.
            run: [{ id: "check:docs", command: "bun run check:docs" }],
            skip: [
                {
                    id: "tsc[all]",
                    reason: "no .ts/.tsx in the diff — markdown cannot break a type-check",
                },
                {
                    id: "lint(diff)",
                    reason: "eslint has no parser for .md; prettier covers it inside check:docs",
                },
                {
                    id: "dom",
                    reason: "no changed code under src/** — no component, style or asset changed",
                },
                {
                    id: "node-engine+node-tooling",
                    reason: "check:docs runs the node files that READ prose (adr-index, findings, project-skills, resident-context-budget); the rest cannot see a markdown edit",
                },
            ],
        };
    }

    const format = scopedCheck(
        "format(diff)",
        "bunx prettier --check",
        presentPaths.filter((p) => PRETTIER_EXTENSIONS.test(p))
    );
    const lint = scopedCheck(
        "lint(diff)",
        "bunx eslint --no-warn-ignored",
        presentPaths.filter((p) => ESLINT_EXTENSIONS.test(p))
    );

    const run: PlannedCheck[] = [];
    const skip: SkippedCheck[] = [];
    for (const [check, id, what] of [
        [format, "format(diff)", "formattable"],
        [lint, "lint(diff)", "lintable"],
    ] as const) {
        if (check) run.push(check);
        else
            skip.push({
                id,
                reason: `no ${what} file in the diff — nothing to check`,
            });
    }

    if (lane === "skin") {
        run.push(
            {
                id: "tsc[app,scripts]",
                command:
                    "bunx tsc -b tsconfig.app.json tsconfig.scripts.json --noEmit",
            },
            { id: "cr:lint", command: "bun run cr:lint" }
        );
        // SCOPED BY THE IMPORT GRAPH (ADR 0154 §2): the `node` and `dom`
        // tests the diff reaches, in ONE vitest run over the projects they
        // belong to. A new `src` test file is itself in the diff, so it is
        // planned. A test file NO project selects is in no project here
        // either, so it is never planned: that class is
        // `src-test-env-split.test.ts`'s, and it runs in health.
        pushRelated(
            related(files),
            ["node-engine", "node-tooling", "dom"],
            run,
            skip
        );
        skip.push(
            {
                id: "tsc[convex,node]",
                reason: "convex/** never imports src/**, so a skin diff cannot break the convex or vite-config projects",
            },
            {
                id: "check:index",
                reason: "no changed code under convex/cards/** or data/** — the card index lockfile cannot drift",
            },
            {
                id: "check:stubs",
                reason: "no changed code under convex/cards/** — stub coverage cannot change",
            },
            {
                id: "check:oracle",
                reason: "no changed code under convex/** or data/** — the oracle lockfile cannot drift",
            },
            ...HEALTH_ONLY_SKIPS
        );
        appendCheapGuards(files, run, skip);
        appendDocsGuards(files, run);
        return { lane, rationale: skinRationale(files), files, run, skip };
    }

    if (lane === "cards") {
        run.push(
            // The card files are in the convex project; nothing in a cards
            // diff is in any other (ADR 0136 §4).
            { id: "tsc[convex]", command: "bunx tsc -b convex --noEmit" },
            { id: "check:index", command: "bun run check:index" },
            { id: "check:stubs", command: "bun run check:stubs" },
            { id: "check:oracle", command: "bun run check:oracle" },
            CONVEX_BUNDLE,
            { id: "cr:lint", command: "bun run cr:lint" },
            // A FIXED partition, not the import graph (issue #5464): every
            // test that loads the catalogue imports the set barrel, so the
            // walk would call half the suite related to any card. The
            // `convex/cards/` partition is the catalogue guards plus EVERY
            // set's tests — 425 files, 18s at load 25 — and a card borrowed
            // by another set's test is still proven.
            {
                id: "node[cards]",
                command: "bunx vitest run --project node-engine convex/cards/",
            },
            // The three bot censuses (aiEffectsGuard, opValuerCoverage,
            // opBeneficenceCensus) plus the sets' own bot files: 16 files, 8s.
            {
                id: "bot[cards]",
                command: "bunx vitest run --project bot-node convex/cards/",
            }
        );
        skip.push(
            {
                id: "tsc[app,scripts]",
                reason: "no changed code under src/** or scripts/** — the card files are type-checked by tsc[convex]",
            },
            ...HEALTH_ONLY_SKIPS,
            {
                id: "node-engine+node-tooling",
                reason: "every code path is a card definition or a data/** artefact — the catalogue guards and every set's tests run as node[cards]; a card on exercised Ops cannot reach an engine or tooling test (ADR 0136 §4)",
            },
            {
                id: "dom",
                reason: "no changed code under src/** — no component, style or asset changed",
            }
        );
        appendCheapGuards(files, run, skip);
        appendDocsGuards(files, run);
        return { lane, rationale: cardsRationale(files), files, run, skip };
    }

    run.push(
        // The engine lane keeps the WHOLE type-check: src/** imports
        // convex/gre (ADR 0074), so an engine diff CAN break the app
        // project, and that type-check is one of the three backstops that
        // make dropping `dom` safe (#2738).
        { id: "tsc[all]", command: "bun run check:ts" },
        { id: "check:index", command: "bun run check:index" },
        { id: "check:stubs", command: "bun run check:stubs" },
        // `data/**` classifies as engine (ADR 0136 §3) on the premise that
        // every guard reading it runs here. `check:oracle` reads
        // `data/oracle-*.json` and the projection of `data/card-index.json`;
        // its offline tier is header hashes and costs nothing worth skipping.
        { id: "check:oracle", command: "bun run check:oracle" },
        CONVEX_BUNDLE,
        { id: "cr:lint", command: "bun run cr:lint" }
    );
    // SCOPED BY THE IMPORT GRAPH (ADR 0154 §2): the `node-engine` and
    // `node-tooling` tests the diff reaches. One exception is ADMITTED WHOLE:
    // a tooling path that is not a module (a hook, `settings.json`,
    // `package.json` scripts, `tolaria.config.json`) is read through `fs` by
    // the drift guards in `node-tooling`, and no import edge names it
    // (issue #5456 put those paths in this lane on that premise).
    const toolingWhole = files.some(
        (p) => TOOLING_PATHS.test(p) && !MODULE_PATH.test(p)
    );
    const reach = related(files);
    if (toolingWhole) {
        run.push({
            id: "node-tooling",
            command: "bunx vitest run --project node-tooling",
        });
        pushRelated(reach, ["node-engine"], run, skip);
    } else {
        pushRelated(reach, ["node-engine", "node-tooling"], run, skip);
    }
    skip.push(
        {
            id: "dom",
            reason: "no changed code under src/** — the whole type-check is the backstop (#2738); a src test the diff reaches is health's (ADR 0154 §2)",
        },
        ...HEALTH_ONLY_SKIPS
    );
    appendCheapGuards(files, run, skip);
    appendDocsGuards(files, run);
    return { lane, rationale: engineRationale(files), files, run, skip };
}

/**
 * The census guards that cost seconds (issue #4963): measured in `health`
 * (`.claude/telemetry/health/detach.log`, 14 days to 2026-10-02) at <1 s
 * (`check:gaps`), ~1 s (`check:targets`) and 2–3 s (`check:test-hygiene`,
 * whose guard cache makes an unchanged tree a cached PASS). Between them they
 * caused 19 of 40 RED base tips in that window — violations a lane would
 * have refused at `land`, which `health` only found after the merge.
 *
 * THE RULE IS COST, NOT PHASE: a guard whose measured cost is ≤ 10 s on the
 * heavy tier belongs in the lane; `health`-only is for guards that cost more
 * (`HEALTH_ONLY_GUARDS` in `lib/health-step.ts`, each with its measured
 * cost). These stay in `HEALTH_SCRIPTS` too — health is the full gate; the
 * lane is only no longer the place a violation is first SEEN late.
 *
 * ADMISSION, NOT SCOPING: each guard runs whole, and runs when the diff holds
 * a path that is one of its inputs — never on a slice. A census reads its
 * inputs through `fs`, so the import graph that scopes the vitest run
 * (ADR 0154 §2) cannot see them; the admission paths below are what can.
 *
 *   - `check:test-hygiene` reads every test file and its `__tests__/`
 *     support, the card registry (which decides pure-DSL), and its
 *     classifier and allow-list under `scripts/lib/**` — the guard cache's
 *     own declaration (`TEST_CORPUS_GLOBS` ∪ `CARD_REGISTRY_GLOBS`; the
 *     latter's `package.json` / `tsconfig*` / lockfile are `full`-lane paths).
 *   - `check:gaps` / `check:targets` read the committed Oracle lockfile, the
 *     claims allow-list and the Target Lists under `data/**`, the registry
 *     and card sources, `convex/oracle/**` and the Bot sources whose hash
 *     keys the verdict merge (`botHash`) — so `convex/**` whole — their
 *     readers under `scripts/lib/**`, and `scripts/oracle-*.ts`
 *     (`poolOracleIds`, `REPORTED_FORMATS`).
 *   - `blade-index` (issue #5940) is the blade card index drift test, a
 *     `bot-node` file no scoped lane relates (ADR 0154 §3 sends that project
 *     to health, where `test:bot` runs it): it reads the blade registry and
 *     pins the two artefacts built from it plus their builder. 1.9 s at load
 *     ~2, 4.5–9.2 s wall at load 33 (2026-10-18). Without it a registry entry
 *     landed with a stale index and the base went RED (PR #5868); with it
 *     `pr-fixup`'s `blade-index` row regenerates the index on the PR.
 *
 * Wide on purpose: each costs seconds, and a missed input is a violation
 * that slips back to `health` — the failure this exists to remove.
 *
 * Order: after `check:oracle` wherever the lane runs it — lockfile DRIFT is
 * the error a reader must see first, not a census over a stale file.
 */
export const CHEAP_GUARDS: readonly {
    id: string;
    /** A changed path that is one of the guard's inputs. */
    admits: RegExp;
    /** What the diff lacks, for the skip line. */
    lacks: string;
    /** The command, when it is not `bun run <id>`. */
    command?: string;
}[] = [
    {
        id: "check:gaps",
        admits: /^(data\/|convex\/|scripts\/lib\/|scripts\/oracle-[^/]*\.ts$|scripts\/check-gaps\.ts$)/,
        lacks: "no changed path under data/**, convex/**, scripts/lib/** or scripts/oracle-*.ts — the lockfile, the claims, the registry and the Bot hash it censuses did not move",
    },
    {
        id: "check:targets",
        admits: /^(data\/|convex\/|scripts\/lib\/|scripts\/oracle-[^/]*\.ts$|scripts\/check-targets\.ts$)/,
        lacks: "no changed path under data/**, convex/**, scripts/lib/** or scripts/oracle-*.ts — the Target Lists, the lockfile and the claims did not move",
    },
    {
        id: "check:test-hygiene",
        admits: /(\.test\.tsx?$|(^|\/)__tests__\/|^convex\/|^data\/|^scripts\/lib\/|^scripts\/(check-test-hygiene|purge-identity-tests)\.ts$)/,
        lacks: "no test file, no __tests__/ support, nothing under convex/**, data/** or scripts/lib/** — the census's corpus, registry and allow-list did not move",
    },
    {
        id: "blade-index",
        admits: /^(convex\/gre\/ai\/blade\/|data\/blade-(card-index|reproducers)\.json$|scripts\/lib\/blade-card-index\.ts$|scripts\/__tests__\/blade-card-index-drift\.bot\.test\.ts$)/,
        lacks: "no changed path under convex/gre/ai/blade/**, data/blade-{card-index,reproducers}.json or their builder — the blade card index cannot drift",
        command: `bunx vitest run --project bot-node ${BLADE_INDEX_DRIFT_TEST}`,
    },
];

/** The cheap guard's command: its own, else `bun run <id>`. */
function cheapGuardCommand(guard: (typeof CHEAP_GUARDS)[number]): string {
    return guard.command ?? `bun run ${guard.id}`;
}

function appendCheapGuards(
    files: string[],
    run: PlannedCheck[],
    skip: SkippedCheck[]
): void {
    for (const guard of CHEAP_GUARDS) {
        if (files.some((p) => guard.admits.test(p)))
            run.push({ id: guard.id, command: cheapGuardCommand(guard) });
        else skip.push({ id: guard.id, reason: guard.lacks });
    }
}

/** Where the drift-guard census lives: hooks, skills, the gate scripts. */
const TOOLING_PATHS =
    /^((scripts|\.claude)\/|tolaria\.config\.json$|\.nvmrc$|\.gitattributes$|\.prettierignore$|package\.json$)/;

/**
 * The server bundle's size receipt rides the lanes that can move it (`engine`,
 * `cards`): its own esbuild pass measured 2 s (2026-10-12, load ~10), inside
 * the ≤ 10 s lane budget ADR 0154 §3 leaves unchanged — so it is NOT one of
 * the guards that section sends to health, whatever the issue text guessed.
 */
const CONVEX_BUNDLE: PlannedCheck = {
    id: "check:convex-bundle",
    command: "bun run check:convex-bundle",
};

/** A path an import edge can name — what `lib/test-reach.ts` can see. */
const MODULE_PATH = /\.([cm]?[jt]sx?)$/;

/**
 * What no scoped lane runs any more (ADR 0154 §3, issue #5464), named in
 * every scoped plan's skip list so the receipt says where each one went. The
 * costs are `HEALTH_ONLY_GUARDS`' (`lib/health-step.ts`), the one table.
 */
const HEALTH_ONLY_SKIPS: SkippedCheck[] = [
    {
        id: "bot fast lane",
        reason: "health-only (ADR 0154 §3): its byte-identity pins red on base drift, not on the PR — 29 of 34 vitest reds at land",
    },
    {
        id: "bundle",
        reason: "health-only (ADR 0154 §3): check:bundle costs 12–24 s and runs in health's check:all",
    },
];

/**
 * The scoped vitest run (ADR 0154 §2): ONE command over the projects that
 * hold a related test, the files as filters. Only projects with a related
 * file are named, so the filters can never match nothing in a named project
 * (vitest exits 1 on "no test files found"). Nothing related → a skip line,
 * never an empty run. Past `WHOLE_PROJECT_AT` related files the named
 * projects run WHOLE, without filters: a hub edit (`gre/types.ts` relates
 * 1116 of 1273 `node-engine` files) would otherwise put ~60 KB of filters in
 * one `sh -c` argument — half Linux's 128 KiB `MAX_ARG_STRLEN` — to select
 * what the bare project selects anyway.
 */
function pushRelated(
    reach: RelatedTests,
    projects: (keyof RelatedTests)[],
    run: PlannedCheck[],
    skip: SkippedCheck[]
): void {
    const named = projects.filter((p) => reach[p].length > 0);
    const files = named.flatMap((p) => reach[p]);
    if (files.length === 0) {
        skip.push({
            id: "vitest(related)",
            reason: `no ${projects.join("/")} test reaches a changed path through the import graph — an unreachable test is health's (ADR 0154 §2)`,
        });
        return;
    }
    const projectFlags = named.map((p) => `--project ${p}`).join(" ");
    run.push({
        id: "vitest(related)",
        command:
            files.length > WHOLE_PROJECT_AT
                ? `bunx vitest run ${projectFlags}`
                : `bunx vitest run ${projectFlags} ${files.map(shellQuote).join(" ")}`,
    });
}

/** Related files past which the named projects run whole (see above). */
export const WHOLE_PROJECT_AT = 400;

/**
 * Prose in a code lane (ADR 0136 §3): the run list ENDS with the docs lane's
 * own node test list — the guards that READ prose, exactly the set
 * `check:docs` runs (`DOC_GATE_TESTS`, one list, two consumers). The other two
 * things `check:docs` owes are already in every code lane: `format(diff)`
 * carries the `.md` paths (prettier has a markdown parser) and `cr:lint` is
 * a fixed entry of both `skin` and `engine`.
 *
 * The scoped `vitest(related)` run (ADR 0154 §2) cannot select these: they
 * READ the prose through `fs`, and no import edge names a markdown file — so
 * for any code + prose diff this entry is what runs them. A FIXED list,
 * admitted by the presence of prose, never derived from the import graph.
 */
function appendDocsGuards(files: string[], run: PlannedCheck[]): void {
    if (!files.some((p) => classifyPath(p) === "docs")) return;
    run.push({
        id: "node[docs]",
        command: `bunx vitest run ${NODE_PARTITIONS} ${DOC_GATE_TESTS.join(" ")}`,
    });
}

function skinRationale(files: string[]): string {
    return codeLaneRationale(files, "src/**, public/** or index.html");
}

function engineRationale(files: string[]): string {
    return codeLaneRationale(
        files,
        "convex/**, scripts/**, data/**, .claude/** or a tooling config file"
    );
}

function cardsRationale(files: string[]): string {
    return codeLaneRationale(files, "convex/cards/sets/** or data/**");
}

/**
 * "all under X" when the diff is pure code; when prose rides along, say how
 * many of each and that the docs guards are appended — a positive claim about
 * the diff must stay true of every path in it (the truth test in
 * `check-lane.test.ts` reads it back).
 */
function codeLaneRationale(files: string[], where: string): string {
    const prose = files.filter((p) => classifyPath(p) === "docs").length;
    const n = files.length;
    if (prose === 0)
        return `${n} file${n === 1 ? "" : "s"}, all under ${where}`;
    const code = n - prose;
    return `${n} files — ${code} under ${where}, ${prose} prose (the code decides the lane; the check:docs node files are appended)`;
}

function docsRationale(files: string[]): string {
    return `${files.length} file${files.length === 1 ? "" : "s"}, all prose — markdown under docs/**, .claude/{skills,rules}/** or a root-level .md`;
}

function fullRationale(files: string[]): string {
    if (files.length === 0) {
        return "empty diff — nothing to classify, so the full gate stands (a wrong base ref looks exactly like this)";
    }
    const unrecognised = files.filter((p) => classifyPath(p) === "full");
    if (unrecognised.length > 0) {
        return `${files.length} file${files.length === 1 ? "" : "s"}, ${unrecognised.length} outside every lane rule (first: ${unrecognised[0]})`;
    }
    // Nothing unrecognised and not a pure or prose-plus-code lane: the only
    // way left here is code on both sides. Prose in such a diff changes
    // nothing — it is the src-vs-engine mix that costs the full gate.
    return `${files.length} files spanning src/** and convex|scripts|data/** — the mixed case never gets a narrowed gate`;
}

// ─────────────────────────────────────────────────────────────────────────
// Rendering — a pure view of the plan object above. The skip list is
// rendered from the SAME object that will later drive execution, so the
// receipt cannot describe a different run from the one that happens.
// ─────────────────────────────────────────────────────────────────────────

export function renderPlan(plan: LanePlan, head: string): string {
    const lines: string[] = [];
    lines.push(`lane:  ${plan.lane}   (HEAD ${head}, ${plan.rationale})`);
    lines.push(`run:   ${plan.run.map((c) => c.id).join(" ")}`);
    if (plan.skip.length > 0) {
        const width = Math.max(...plan.skip.map((s) => s.id.length));
        plan.skip.forEach((s, i) => {
            const label = i === 0 ? "skip: " : "      ";
            lines.push(`${label} ${s.id.padEnd(width)}  — ${s.reason}`);
        });
        lines.push(`       predicate: classifyPath() in scripts/check-lane.ts`);
    }
    return lines.join("\n");
}

/**
 * The machine-readable form of the SAME plan object, with the HEAD SHA the
 * human receipt carries. The dirty-tree refusal exists so the printed SHA
 * describes exactly what was classified; `--json` must not lose that, or the
 * one consumer that could check the classification mechanically is the one
 * that cannot say which tree it classified (round-1 review of #2740).
 *
 * `result` is optional so this ALSO covers the executed case (#2741): when
 * `main()` runs the plan for real, it passes the `RunResult` `runPlan`
 * returned and this merges in `ok`/`outcomes`/`totalMs` alongside the plan
 * fields — there is exactly one JSON renderer, never a second
 * `JSON.stringify({ head, ...plan, ...result })` built by hand next to this
 * one (#2748 review, finding 1: that second build was live in `main()` and
 * left this function dead, so the round-1 review's own SHA guard never
 * reached production).
 */
export function renderJson(
    plan: LanePlan,
    head: string,
    result?: RunResult,
    endHead?: string
): string {
    return JSON.stringify(
        endHead === undefined
            ? { head, ...plan, ...result }
            : { head, endHead, ...plan, ...result },
        null,
        2
    );
}

/**
 * `--plan`: the classification alone, in whichever of the two forms above
 * the caller asked for, with NO `RunResult` because nothing ran (ADR 0136
 * §8). One expression over the two renderers that already exist — never a
 * third rendering of a plan, for the same reason `renderJson` takes an
 * optional `result` instead of a sibling renderer for the dry case.
 */
export function renderClassification(
    plan: LanePlan,
    head: string,
    json: boolean
): string {
    return json ? renderJson(plan, head) : renderPlan(plan, head);
}

// ─────────────────────────────────────────────────────────────────────────
// Execution (issue #2741) — the SAME `plan.run` list every render above
// reads drives this. `runPlan` takes an injectable `exec` so the only thing
// that is a DECISION here (fail-fast? what counts as pass/fail? how the
// receipt accounts for a check that never ran) is a pure function, testable
// without spawning a shell — repo convention (git plumbing thin & untested;
// land.ts, docs-lane.ts).
// ─────────────────────────────────────────────────────────────────────────

export type CheckStatus = "pass" | "fail" | "not-run";

/** What running one planned command reports back. `flake` and `failedFiles`
 *  exist only under `--retry-flaky` (issue #5640). */
export interface ExecResult {
    ok: boolean;
    ms: number;
    /** The command failed once and passed on its one re-run. */
    flake?: LaneFlake;
    /** The test files a failed vitest command named — what the fixup job
     *  reads to tell a stale generated artefact from a real red. */
    failedFiles?: string[];
}

export interface CheckOutcome {
    id: string;
    status: CheckStatus;
    ms: number;
    flake?: LaneFlake;
    failedFiles?: string[];
}

export interface RunResult {
    outcomes: CheckOutcome[];
    ok: boolean;
    totalMs: number;
}

/**
 * Run every check in `plan.run`, IN ORDER, against the injected `exec`.
 *
 * FAIL-FAST, matching `check:pr`'s own behaviour: `check:all:inner` chains
 * its steps with `&&`, and `check:pr` chains `check:all:inner` and
 * `check:guards` the same way (package.json) — the first red check already
 * stops everything after it today. A check that never ran because an
 * earlier one failed is recorded `not-run` rather than silently missing
 * from the receipt, so every planned check is accounted for either way.
 *
 * `assertQuiet` is the tree re-assertion (issue #4379), called before each
 * check that actually runs; it exits the process on a tree that moved.
 * Required, not defaulted: see `executePlan`.
 */
export function runPlan(
    plan: LanePlan,
    exec: (command: string) => ExecResult,
    assertQuiet: () => unknown
): RunResult {
    const outcomes: CheckOutcome[] = [];
    let ok = true;
    let totalMs = 0;
    for (const check of plan.run) {
        if (!ok) {
            outcomes.push({ id: check.id, status: "not-run", ms: 0 });
            continue;
        }
        // BEFORE EVERY CHECK, not once around the whole phase (round-1
        // review of #4379). An `engine` or `full` lane runs fourteen checks
        // over minutes; a stash that is pushed and popped inside that span
        // leaves HEAD, status and the stash list identical at both ends,
        // so a single assertion after the last check sees nothing — while
        // whichever checks ran in the middle read the moved tree. That is
        // the bug this file exists to close, relocated one level down. The
        // assertion is three cheap git reads against a check that costs
        // seconds at minimum.
        assertQuiet();
        const result = exec(check.command);
        totalMs += result.ms;
        outcomes.push({
            id: check.id,
            status: result.ok ? "pass" : "fail",
            ms: result.ms,
            ...(result.flake ? { flake: result.flake } : {}),
            ...(result.failedFiles ? { failedFiles: result.failedFiles } : {}),
        });
        if (!result.ok) ok = false;
    }
    return { outcomes, ok, totalMs };
}

/**
 * The receipt: per-check pass/fail/not-run with wall-clock, rendered from
 * the `RunResult` `runPlan` returned — never a second list. Replaces the
 * old `note: INERT` line now that this executes for real.
 *
 * `heads` is the pair this run ASSERTED (issue #4379, finding 2727): the
 * HEAD the lane classified and the HEAD it still saw when the last check
 * returned. A run that reaches here has already refused a moved tree, so
 * the two are equal — printing them anyway is what makes the receipt say
 * WHICH tree it describes rather than merely implying one, and it is the
 * pair `land` re-checks on the record it reads back (ADR 0136 §2).
 */
export function renderReceipt(
    result: RunResult,
    heads: { start: string; end: string }
): string {
    const lines: string[] = [];
    const width = Math.max(...result.outcomes.map((o) => o.id.length));
    const mark: Record<CheckStatus, string> = {
        pass: "✓",
        fail: "✗",
        "not-run": "·",
    };
    for (const o of result.outcomes) {
        const time =
            o.status === "not-run" ? "" : `  ${(o.ms / 1000).toFixed(1)}s`;
        lines.push(`  ${mark[o.status]} ${o.id.padEnd(width)}${time}`);
    }
    lines.push("");
    lines.push(`tree:  ${heads.start} → ${heads.end}   (start → end)`);
    lines.push(
        `${result.ok ? "PASS" : "FAIL"}  ${(result.totalMs / 1000).toFixed(1)}s total`
    );
    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Tree stability (issue #4379, finding 2727) — the dirty-tree refusal in
// `main()` covers the tree being dirty when the run STARTS. It does not
// cover the tree being rewritten UNDER the run, which is exactly what
// husky's `lint-staged` does on every commit: it stashes the working state
// (`lint-staged automatic backup`), runs prettier, then restores it. A
// `git commit && bun run check:lane` chain — the shape every AFK session
// types — can therefore classify and gate files while the stash is still
// applied. Observed on a `skin` diff: the lane saw a diff it could not
// place and fell back to `check:pr`, and a ratchet test failed with a count
// matching a partially-restored tree; the identical quiet tree passed on
// re-run.
//
// The cost that matters is not the wasted gate — it is a receipt whose HEAD
// SHA describes a tree that was never on disk, which is precisely the
// property the dirty-tree refusal exists to give. So the snapshot is taken
// once at the start and RE-ASSERTED after classification and again before
// the receipt is printed.
// ─────────────────────────────────────────────────────────────────────────

/** What the working tree looked like at one instant during the run. */
export interface TreeSnapshot {
    /** `git rev-parse --short HEAD`. */
    head: string;
    /** `git status --porcelain`, verbatim — compared, never parsed. */
    status: string;
    /** `git stash list --format=%gs`, verbatim — compared, never parsed. */
    stash: string;
}

/**
 * The refusal message for a tree that moved between two snapshots, or null
 * when nothing moved. Pure, so the DECISION is testable without a
 * subprocess — same convention as every other decision in this file.
 *
 * THE SIGNAL IS THE STASH STACK CHANGING, NOT A LINT-STAGED ENTRY BEING
 * PRESENT. Issue #4379 asked for the direct check — "an entry whose message
 * starts with `lint-staged automatic backup` while the lane runs is the same
 * refusal" — and that is wrong on this machine, for two reasons that only
 * showed up against a real repo. The stash stack is shared by every worktree,
 * so one session's entry refuses every other session's lane; and a
 * lint-staged that dies between its stash and its restore leaves the entry
 * behind forever. One such entry, dated 2026-09-17, was sitting on this
 * repo's stack when this guard was first run — presence alone would have
 * refused every `check:lane` (and therefore every `land`) on the machine
 * until a human dropped it.
 *
 * A lint-staged run that races us, by contrast, PUSHES its backup and then
 * DROPS it, so the stack differs between two snapshots — which is exactly
 * the observed failure (the lint-staged banner appearing inside the lane's
 * own log). Comparing the list catches that and is inert against a stale
 * entry, which changes nothing and is applied to nothing.
 */
export function treeMoved(
    start: TreeSnapshot,
    now: TreeSnapshot
): string | null {
    const moved =
        "the tree moved under the lane — a lint-staged stash or a concurrent commit; re-run on a quiet tree";
    if (start.head !== now.head) {
        return `${moved} (HEAD ${start.head} → ${now.head})`;
    }
    if (start.status !== now.status) {
        const first = now.status.trim().split("\n")[0] ?? "";
        return `${moved} (working tree no longer matches the one classified${
            first === "" ? "" : `, first change: ${first}`
        })`;
    }
    if (start.stash !== now.stash) {
        return `${moved} (${
            hasLintStagedStash(start.stash) || hasLintStagedStash(now.stash)
                ? "a `lint-staged automatic backup` stash entry was pushed or dropped under the run"
                : "the stash stack changed under the run"
        })`;
    }
    return null;
}

/**
 * Whether `git stash list --format=%gs` shows a lint-staged backup. Names
 * the cause in the refusal above; never a refusal on its own, per the
 * stale-entry reasoning there. The prefix strip keeps this honest against a
 * plain `git stash list`, whose lines carry a `stash@{N}: ` prefix the
 * `--format` above drops.
 */
export function hasLintStagedStash(stashList: string): boolean {
    return stashList
        .split("\n")
        .some((line) =>
            line
                .replace(/^stash@\{\d+\}:\s*/, "")
                .startsWith("lint-staged automatic backup")
        );
}

// ─────────────────────────────────────────────────────────────────────────
// git plumbing — thin and untested, per repo convention (land.ts,
// docs-lane.ts): every DECISION above is a pure function tested directly
// against hand-built path lists, never through a subprocess.
// ─────────────────────────────────────────────────────────────────────────

function git(args: string[], cwd: string): string {
    const r = spawnSync("git", args, { encoding: "utf8", cwd });
    if (r.status !== 0) {
        throw new Error(
            `git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`
        );
    }
    return r.stdout;
}

/**
 * `-z` matters: two tracked files in this repo carry non-ASCII names
 * (`public/img/symbols/½.svg`, `…/∞.svg`) and plain `--name-only` returns
 * them C-quoted, which would classify as an unrecognised path.
 */
export function changedPaths(
    base: string,
    cwd: string,
    deleted: boolean
): string[] {
    const filter = deleted ? [] : ["--diff-filter=d"];
    return git(["diff", "-z", "--name-only", ...filter, `${base}...HEAD`], cwd)
        .split("\0")
        .filter((p) => p.length > 0);
}

/** Paths the diff ADDS (not modifies) — what a new-file guard reads. */
export function addedPaths(base: string, cwd: string): string[] {
    return git(
        ["diff", "-z", "--name-only", "--diff-filter=A", `${base}...HEAD`],
        cwd
    )
        .split("\0")
        .filter((p) => p.length > 0);
}

/** A file's text at a ref, or null when it does not exist there. */
function showAt(ref: string, path: string, cwd: string): string | null {
    const r = spawnSync("git", ["show", `${ref}:${path}`], {
        encoding: "utf8",
        cwd,
    });
    return r.status === 0 ? r.stdout : null;
}

/**
 * The content-decided classes (issue #5456): `package.json` against the
 * merge base, when it is in the diff. Thin plumbing; `packageJsonClass`
 * decides.
 */
export function contentClasses(
    paths: string[],
    base: string,
    cwd: string
): Map<string, PathClass> {
    const out = new Map<string, PathClass>();
    if (!paths.includes("package.json")) return out;
    const mergeBase = git(["merge-base", base, "HEAD"], cwd).trim();
    out.set(
        "package.json",
        packageJsonClass(
            showAt(mergeBase, "package.json", cwd),
            showAt("HEAD", "package.json", cwd)
        )
    );
    return out;
}

/** One instant of the working tree. Thin plumbing; `treeMoved` decides. */
function snapshotTree(cwd: string): TreeSnapshot {
    return {
        head: git(["rev-parse", "--short", "HEAD"], cwd).trim(),
        status: git(["status", "--porcelain"], cwd),
        stash: git(["stash", "list", "--format=%gs"], cwd),
    };
}

function fail(message: string): never {
    console.error(`check:lane: ${message}`);
    process.exit(1);
}

// Computed from this FILE's directory, same pattern as land.ts/docs-lane.ts.
const GATE = resolve(__dirname, "gate.ts");

/**
 * The stdio wiring for one planned check's child process. In `--json` mode
 * the process's OWN stdout must carry nothing but the JSON blob (that is
 * the entire point of `--json` — a consumer piping it to `jq`), so the
 * child's stdout is redirected to the parent's stderr instead of inherited;
 * stdin and the child's own stderr keep flowing straight through either
 * way. Split out as a pure function so the DECISION (which fd a child's
 * stdout lands on) is unit-testable without spawning anything, matching
 * every other decision in this file (#2748 review, finding 2: `stdio:
 * "inherit"` unconditionally meant every check's own stdout — tsc,
 * prettier, vitest, vite — landed on `check:lane --json`'s stdout ahead of
 * the JSON blob, breaking `bun run check:lane --json | jq`).
 */
export function shellStdio(
    json: boolean
): ["inherit", "inherit" | 2, "inherit"] {
    return ["inherit", json ? 2 : "inherit", "inherit"];
}

/**
 * Execute one planned command at the LIGHT tier — no mutex, no worker-count
 * override. `scripts/gate.ts light` is the repo's single mechanism for
 * that: for the light tier it takes no lock and leaves
 * `TOLARIA_VITEST_WORKERS` exactly as the caller set it (unset here), which
 * is how `check:pr`'s own `--project` invocations land on
 * `vitest.config.ts`'s default cap of 2. Delegating to `gate.ts` rather
 * than re-deriving that env logic here means a future change to what
 * "light" means is inherited automatically instead of drifting between two
 * copies of the same mechanism.
 */
function shellRun(command: string, cwd: string, json: boolean): ExecResult {
    const t0 = Date.now();
    const r = spawnSync("bun", [GATE, "light", command], {
        stdio: shellStdio(json),
        cwd,
    });
    return { ok: r.status === 0, ms: Date.now() - t0 };
}

/**
 * `--retry-flaky` (issue #5640): the queue's lane re-runs a failed vitest
 * command ONCE, on the failing files only, and records the flake. Output is
 * captured to be read (`planLaneRetry` owns what is retryable) and replayed
 * onto the same stream `shellStdio` would have used. A command that is not
 * vitest runs exactly as `shellRun` runs it.
 */
export function shellRunRetrying(
    command: string,
    cwd: string,
    json: boolean
): ExecResult {
    if (!/^bunx vitest run(\s|$)/.test(command)) {
        return shellRun(command, cwd, json);
    }
    const t0 = Date.now();
    const sink = json ? process.stderr : process.stdout;
    const capture = (
        cmd: string
    ): { ok: boolean; out: string; signal: boolean } => {
        const r = spawnSync("bun", [GATE, "light", cmd], {
            stdio: ["inherit", "pipe", "pipe"],
            cwd,
            encoding: "utf8",
            maxBuffer: 512 * 1024 * 1024,
        });
        const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
        sink.write(out);
        return { ok: r.status === 0, out, signal: r.signal !== null };
    };
    const first = capture(command);
    if (first.ok) return { ok: true, ms: Date.now() - t0 };
    const plan = first.signal ? null : planLaneRetry(command, first.out);
    if (plan === null) {
        // No files named: a red the retry could not cover (crash, untagged
        // FAIL) is never one the fixup job may call regenerable.
        return { ok: false, ms: Date.now() - t0 };
    }
    sink.write(
        `check:lane: ${plan.projects.join(", ")} failed (${plan.cause}) — re-running ${plan.files.length} file(s) once (issue #5640)\n`
    );
    const second = capture(plan.command);
    if (second.ok) {
        sink.write(
            `check:lane: flaky — green on the re-run: ${plan.files.join(", ")}\n`
        );
        return { ok: true, ms: Date.now() - t0, flake: laneFlakeOf(plan) };
    }
    return {
        ok: false,
        ms: Date.now() - t0,
        failedFiles: failingFiles(second.out),
    };
}

/**
 * The single consumer of ONE plan object (#2748 review, finding 3): given a
 * `LanePlan`, fans it out to `renderPlan`, `runPlan` and `renderJson`, so
 * the receipt describes the same run that was executed — the invariant
 * issue #2741 exists to hold.
 *
 * WHAT HOLDS THIS IS THE TEST, NOT THE STRUCTURE. `executePlan` is
 * module-scope in this file, so `classifyLane` and the git plumbing ARE
 * lexically in scope here: a rebuild inserted into this body type-checks
 * and runs (round-2 review of #2748, which proved exactly that). An earlier
 * version of this comment claimed the function "CANNOT" reach
 * `classifyLane`; that was false, and a false structural claim in the one
 * file whose thesis is "the receipt must not lie" is the same sin one level
 * up. The real guard is `check-lane.test.ts` § "executePlan renders and
 * executes off the plan it was given", which reddens when a rendering path
 * is fed anything but the passed plan. Taking the plan as a PARAMETER makes
 * the rebuild an obvious edit rather than an invisible one; it does not
 * make it impossible.
 *
 * `exec`, `log` and `endHeadOf` are injected so a test can drive this with a
 * hand-built plan and a fake shell, with no subprocess — same pattern as
 * `runPlan`'s injectable `exec`. `endHeadOf` is the tree re-assertion
 * (issue #4379): it runs before every check and again before the receipt,
 * and `main()` passes one that refuses a tree that moved under the run.
 *
 * NONE OF THE THREE HAS A DEFAULT (round-1 review of #4379). `log` and
 * `endHeadOf` used to default to `console.log` and `() => head`, and the
 * second of those is a silent no-op: a future caller that forgot the
 * argument would get the pre-#4379 behaviour back with nothing — not `tsc`,
 * not a test — saying so. A required parameter is the signal.
 */
export function executePlan(
    plan: LanePlan,
    head: string,
    json: boolean,
    exec: (command: string) => ExecResult,
    log: (line: string) => void,
    endHeadOf: () => string
): RunResult {
    if (!json) log(renderPlan(plan, head));

    // `endHeadOf` goes down into the loop as well, so the tree is asserted
    // before every check and not only around the phase (round-1 review of
    // #4379).
    const result = runPlan(plan, exec, endHeadOf);

    // BEFORE either rendering, never after (issue #4379): `endHeadOf` is
    // `main()`'s re-assertion, which exits on a tree that moved under the
    // run. A receipt printed first would already have told the reader that
    // this tree was gated.
    const endHead = endHeadOf();

    if (json) log(renderJson(plan, head, result, endHead));
    else log(renderReceipt(result, { start: head, end: endHead }));

    return result;
}

/**
 * Argument parsing is a DECISION (which base, which rendering, run or only
 * classify), so it is a pure function tested directly — repo convention in
 * this file, same as `shellStdio` and `runPlan`'s injected `exec`.
 */
export function parseArgs(argv: string[]): {
    base: string;
    json: boolean;
    planOnly: boolean;
    retryFlaky: boolean;
} {
    const baseArg = argv.find((a) => a.startsWith("--base="));
    for (const a of argv) {
        if (
            a === "--json" ||
            a === "--plan" ||
            a === "--retry-flaky" ||
            a.startsWith("--base=")
        ) {
            continue;
        }
        fail(`unknown argument \`${a}\` — usage: bun run check:lane [--base=<ref>] [--json] [--plan] [--retry-flaky]

The lane is derived from the diff and can never be declared by a flag (#2738):
a flag is a hand-maintained list in disguise, and the first agent that passes
\`--skin\` out of habit on a diff touching convex/ gets a lying green.
\`--plan\` is not that flag: it prints the lane this diff classifies as and
runs nothing, so it cannot make a wrong lane true.
\`--retry-flaky\` (the queue's lane, issue #5640) re-runs a failed vitest
command once on its failing files; it changes what a flake costs, never what
the lane is.`);
    }
    return {
        base: baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE,
        json: argv.includes("--json"),
        planOnly: argv.includes("--plan"),
        retryFlaky: argv.includes("--retry-flaky"),
    };
}

function main(): void {
    const cwd = process.cwd();
    const { base, json, planOnly, retryFlaky } = parseArgs(
        process.argv.slice(2)
    );

    const start = snapshotTree(cwd);
    if (start.status.trim() !== "") {
        fail(
            "working tree is dirty — commit or stash first, so the HEAD SHA in the receipt describes exactly what was classified"
        );
    }

    /**
     * Re-assert the tree is the one classified, and return its HEAD
     * (issue #4379). Called after classification and again after the last
     * check: the dirty-tree refusal above is a single instant, and a
     * `lint-staged` stash applied a beat later rewrites the very files the
     * lane is about to read.
     */
    const assertQuiet = (): string => {
        const now = snapshotTree(cwd);
        const moved = treeMoved(start, now);
        if (moved) fail(moved);
        return now.head;
    };

    const head = assertQuiet();
    // ONE plan, built once — passed to executePlan, the single function
    // that reads it for rendering AND execution. Never build a second list
    // of commands, and never render the JSON form by hand next to
    // renderJson (#2748 review, finding 1).
    const present = changedPaths(base, cwd, false);
    const all = changedPaths(base, cwd, true);
    const plan = classifyLane(
        all,
        present,
        defaultRelated,
        contentClasses(all, base, cwd)
    );

    // The classification read the tree; assert it is still the tree the
    // start snapshot described before anything is printed or run.
    assertQuiet();

    // `--plan` stops HERE, after the one `classifyLane` call above and
    // before any shell: the session asking which path §3 owes it must not
    // pay a gate to find out (ADR 0136 §1/§8).
    if (planOnly) {
        console.log(renderClassification(plan, head, json));
        process.exit(0);
    }

    const result = executePlan(
        plan,
        head,
        json,
        (command) =>
            (retryFlaky ? shellRunRetrying : shellRun)(command, cwd, json),
        console.log,
        assertQuiet
    );

    process.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
    main();
}
