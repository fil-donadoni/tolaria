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
 *
 * Exits 1 on a dirty working tree, so the HEAD SHA it prints describes
 * exactly what was classified.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { BASE_BRANCH, ORIGIN_BASE } from "./lib/branches";
import { primaryCheckout } from "./lib/primary-checkout";

// ─────────────────────────────────────────────────────────────────────────
// Path classification
// ─────────────────────────────────────────────────────────────────────────

export type Lane = "skin" | "engine" | "docs" | "full";

/** What a single changed path admits. `full` is the fail-closed default. */
export type PathClass = Lane;

/**
 * Paths that force the full gate no matter what else is in the diff. Every
 * one of these would already be `full` by the fail-closed default; listing
 * them explicitly, and matching them FIRST, means a future widening of the
 * skin/engine rules cannot quietly swallow one.
 */
const FULL_PATTERNS: RegExp[] = [
    /^package\.json$/,
    /^(bun\.lock|bun\.lockb|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/,
    /(^|\/)tsconfig[\w.]*\.json$/,
    /(^|\/)vite\.config\.[cm]?[jt]s$/,
    /(^|\/)vitest[\w.]*\.config\.[cm]?[jt]s$/,
    /^vitest\.setup\.ts$/,
    /(^|\/)eslint\.config\.[cm]?[jt]s$/,
    /(^|\/)\.prettier(rc|rc\..*|ignore)$/,
    /^data\//,
    /^\.claude\//,
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

/** Paths that are server/tooling code but do not force the full gate. */
const ENGINE_PATTERNS: RegExp[] = [/^convex\//, /^scripts\//];

/**
 * Prose-only paths: markdown under `docs/**` and the root-level markdown that
 * is resident agent context (`CLAUDE.md`, `CONTEXT.md`, `README.md`).
 *
 * ANCHORED TO `.md` ON PURPOSE, for the same reason `SKIN_PATTERNS` is
 * anchored to a directory: `docs/` also holds images and stylesheets, and an
 * extension must never be what promotes a path out of `full`. `docs/img/a.png`
 * and `docs/guides/style.css` stay `full`. `.claude/**` and `.agents/**` stay
 * `full` too — `.claude/` is matched by `FULL_PATTERNS` FIRST, and `.agents/`
 * matches nothing, so neither can reach this list.
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
    if (FULL_PATTERNS.some((re) => re.test(path))) return "full";
    if (DOCS_PATTERNS.some((re) => re.test(path))) return "docs";
    if (SKIN_PATTERNS.some((re) => re.test(path))) return "skin";
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
    // Prose MIXES WITH NOTHING. Without this line the `!includes("skin")`
    // clause below would hand a docs+convex diff the `engine` lane — a
    // widening nobody asked for, arrived at by omission rather than by
    // argument. A mixed diff keeps paying the full gate exactly as it did
    // before the docs lane existed; only the pure case is narrowed.
    if (classes.includes("docs")) return "full";
    if (classes.every((c) => c === "skin")) return "skin";
    if (!classes.includes("skin")) return "engine";
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
 * Build the lane plan from the changed paths.
 *
 * `presentPaths` defaults to `changedPaths` and exists for one reason: a
 * DELETED file still decides the lane (a deleted `convex/**` file is an
 * engine change) but must never be handed to prettier or eslint, which fail
 * on a path that no longer exists. The caller passes the surviving subset.
 */
export function classifyLane(
    changedPaths: string[],
    presentPaths: string[] = changedPaths
): LanePlan {
    const files = [...changedPaths];
    const lane = laneFor(files.map(classifyPath));

    if (lane === "full") {
        return {
            lane,
            rationale: fullRationale(files),
            files,
            // Verbatim delegation: the fallback path is `check:pr` exactly as
            // it is today, so it cannot rot while the lanes get attention
            // (#2738 § Explicitly unchanged).
            run: [{ id: "check:pr", command: "bun run check:pr" }],
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
                    reason: "no changed path under src/** — no component, style or asset changed",
                },
                {
                    id: "node[all]",
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
            // The only check that catches the duplicate-import class that
            // crashes the app on cold load, and it costs 12s (#2738).
            { id: "bundle", command: "bun run check:bundle" },
            { id: "cr:lint", command: "bun run cr:lint" },
            // `scripts/**` stays in the SKIN lane on purpose: it is where
            // `src-test-env-split.test.ts` lives, the guard against a new
            // `src` test file being selected by neither vitest project — and
            // skin is precisely the lane that adds `src` test files (#2738).
            {
                id: "node[src,scripts]",
                command: "bunx vitest run --project node src/ scripts/",
            },
            { id: "dom", command: "bunx vitest run --project dom" }
        );
        skip.push(
            {
                id: "tsc[convex,node]",
                reason: "convex/** never imports src/**, so a skin diff cannot break the convex or vite-config projects",
            },
            {
                id: "check:index",
                reason: "no changed path under convex/cards/** — the card index lockfile cannot drift",
            },
            {
                id: "check:stubs",
                reason: "no changed path under convex/cards/** — stub coverage cannot change",
            },
            {
                id: "bot fast lane",
                reason: "no changed path under convex/** or scripts/** — the bot suites cannot go red",
            },
            {
                id: "node[convex]",
                reason: "no changed path under convex/** — the engine tests cannot go red",
            }
        );
        return { lane, rationale: skinRationale(files), files, run, skip };
    }

    run.push(
        // The engine lane keeps the WHOLE type-check: src/** imports
        // convex/gre (ADR 0074), so an engine diff CAN break the app
        // project, and that type-check is one of the three backstops that
        // make dropping `dom` safe (#2738).
        { id: "tsc[all]", command: "bun run check:ts" },
        { id: "check:index", command: "bun run check:index" },
        { id: "check:stubs", command: "bun run check:stubs" },
        { id: "bundle", command: "bun run check:bundle" },
        { id: "cr:lint", command: "bun run cr:lint" },
        {
            id: "bot fast lane",
            command:
                "TOLARIA_BOT_FAST=1 bunx vitest run --project bot-node --project bot-dom",
        },
        { id: "node[all]", command: "bunx vitest run --project node" }
    );
    skip.push({
        id: "dom",
        reason: "no changed path under src/** — the whole type-check and convex-cards-barrel-mock.test.ts are the backstops (#2738)",
    });
    return { lane, rationale: engineRationale(files), files, run, skip };
}

function skinRationale(files: string[]): string {
    return `${files.length} file${files.length === 1 ? "" : "s"}, all under src/**, public/** or index.html`;
}

function engineRationale(files: string[]): string {
    return `${files.length} file${files.length === 1 ? "" : "s"}, all under convex/** or scripts/**`;
}

function docsRationale(files: string[]): string {
    return `${files.length} file${files.length === 1 ? "" : "s"}, all prose — markdown under docs/** or a root-level .md`;
}

function fullRationale(files: string[]): string {
    if (files.length === 0) {
        return "empty diff — nothing to classify, so the full gate stands (a wrong base ref looks exactly like this)";
    }
    const unrecognised = files.filter((p) => classifyPath(p) === "full");
    if (unrecognised.length > 0) {
        return `${files.length} file${files.length === 1 ? "" : "s"}, ${unrecognised.length} outside every lane rule (first: ${unrecognised[0]})`;
    }
    // A docs path in a diff that is not ALL docs is a mix by definition
    // (`laneFor` returns `docs` only for the pure case), so say so rather
    // than mis-describing it as the src-vs-engine mix below.
    if (files.some((p) => classifyPath(p) === "docs")) {
        return `${files.length} files mixing prose with code — prose is only narrowed when the diff is nothing but prose`;
    }
    return `${files.length} files spanning src/** and convex|scripts/** — the mixed case never gets a narrowed gate`;
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
    result?: RunResult
): string {
    return JSON.stringify({ head, ...plan, ...result }, null, 2);
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

export interface CheckOutcome {
    id: string;
    status: CheckStatus;
    ms: number;
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
 */
export function runPlan(
    plan: LanePlan,
    exec: (command: string) => { ok: boolean; ms: number }
): RunResult {
    const outcomes: CheckOutcome[] = [];
    let ok = true;
    let totalMs = 0;
    for (const check of plan.run) {
        if (!ok) {
            outcomes.push({ id: check.id, status: "not-run", ms: 0 });
            continue;
        }
        const result = exec(check.command);
        totalMs += result.ms;
        outcomes.push({
            id: check.id,
            status: result.ok ? "pass" : "fail",
            ms: result.ms,
        });
        if (!result.ok) ok = false;
    }
    return { outcomes, ok, totalMs };
}

/**
 * The receipt: per-check pass/fail/not-run with wall-clock, rendered from
 * the `RunResult` `runPlan` returned — never a second list. Replaces the
 * old `note: INERT` line now that this executes for real.
 */
export function renderReceipt(result: RunResult): string {
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
    lines.push(
        `${result.ok ? "PASS" : "FAIL"}  ${(result.totalMs / 1000).toFixed(1)}s total`
    );
    return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────
// Preflight — refuse BEFORE paying the lane gate (issue #3286)
// ─────────────────────────────────────────────────────────────────────────

/**
 * WHY A PREFLIGHT AT ALL. One `check:lane` costs 8-17 minutes under the heavy
 * mutex, and two conditions make that run worthless before it starts:
 *
 *   - HEAD is not rebased onto the base tip. The gate runs on a stale tree,
 *     the rebase that follows drags in foreign commits, and the gate has to
 *     be paid a SECOND time on a tree nobody has gated yet.
 *   - The base tip is RED. A commit pushed by hand outside `land` can red it,
 *     and the session discovers that only after a full lane gate has run —
 *     then owes a fix-forward PR before its own work can land at all.
 *
 * Both are answerable in about two seconds. Answering them late is the whole
 * cost; answering them early is the whole fix.
 *
 * WHY `land` IS EXEMPT. `land.ts` already orders this correctly — fetch →
 * rebase → `check:lane` → push → merge, all inside one mutex — and it
 * deliberately WARNS rather than refuses on RED, because the fix-forward that
 * repairs a red tip arrives through a `land` (see `land.ts` § the release
 * health verdict). Two further reasons this preflight must not run there:
 * re-fetching inside the lock could observe a base tip NEWER than the one
 * `land` just rebased onto, which would fail the ancestry check and kill the
 * land mid-lock; and the ordering `land` enforces is exactly what makes the
 * ancestry check redundant. So `land` sets `TOLARIA_LAND_GATE=1` and this
 * whole section is skipped.
 */
export interface PreflightInputs {
    /** Commits the base ref has that HEAD does not. 0 ⇔ HEAD is rebased. */
    behind: number;
    /** Is the durable release-health `RED` marker present? */
    red: boolean;
    /** `TOLARIA_ALLOW_RED_BASE=1` — hatch for the RED refusal ONLY. */
    allowRed: boolean;
    /** The ref the diff is classified against, e.g. `origin/staging`. */
    base: string;
}

/**
 * The refusal text, or `null` to proceed. Pure, so every branch is enumerable
 * in a test without a subprocess — the convention the rest of this file keeps.
 *
 * THE STALE CHECK HAS NO HATCH, on purpose. Rebasing is cheap, always correct,
 * and the alternative is paying the gate twice; an env var that let a session
 * gate a stale tree would only ever be used by the habit this refusal exists
 * to break. The RED check has one, because a human gating the fix-forward
 * branch by hand before landing it is a legitimate reason to proceed on a red
 * tip — that is the ONE case, and it is the reason the hatch is named for RED
 * rather than for the preflight.
 */
export function preflightRefusal(input: PreflightInputs): string | null {
    if (input.behind > 0) {
        const commits = input.behind === 1 ? "commit" : "commits";
        return `HEAD is ${input.behind} ${commits} behind \`${input.base}\`.
  Gating a stale tree pays the gate twice: this run classifies and gates code
  that is not what will land, and the rebase afterwards produces a tree nobody
  has gated. Rebase FIRST, then gate once.

  Run:  git rebase ${input.base}
  Then: bun run check:lane`;
    }
    if (input.red && !input.allowRed) {
        return `the release health gate is RED on \`${BASE_BRANCH}\` (\`bun run health:status\`).
  The base tip is broken for a reason that is not your diff, so this lane gate
  would burn 8-17 minutes to report someone else's failure. RED means
  fix-forward FIRST (ADR 0118).

  If this branch IS the fix-forward: TOLARIA_ALLOW_RED_BASE=1 bun run check:lane`;
    }
    return null;
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

/**
 * Refresh the base ref so `behindCount` answers about the tip that actually
 * exists, not a remote-tracking ref from an hour ago. NON-FATAL by design: the
 * gate is offline by contract (CLAUDE.md § Quality gates), so a session with
 * no network must still be able to gate. A failed fetch degrades to "answer
 * from the ref we already have" and says so, rather than inventing a new way
 * for `check:lane` to refuse.
 */
function fetchBase(cwd: string): void {
    const r = spawnSync("git", ["fetch", "--quiet", "origin", BASE_BRANCH], {
        encoding: "utf8",
        cwd,
    });
    if (r.status !== 0) {
        console.warn(
            `check:lane: could not fetch origin/${BASE_BRANCH} (${(r.stderr || "").trim() || "no network?"}) — answering the preflight from the remote-tracking ref as it stands`
        );
    }
}

/** Commits `base` has that HEAD does not. 0 ⇔ HEAD is rebased onto it. */
function behindCount(base: string, cwd: string): number {
    const r = spawnSync("git", ["rev-list", "--count", `HEAD..${base}`], {
        encoding: "utf8",
        cwd,
    });
    // An unknown ref (a hand-passed `--base=` that does not resolve) is not
    // the preflight's business to diagnose — `changedPaths` below fails on it
    // with git's own message. Treat it as "nothing to say" here.
    if (r.status !== 0) return 0;
    return Number((r.stdout || "").trim()) || 0;
}

/**
 * The durable RED marker lives in the PRIMARY checkout, never in a worktree:
 * `.claude/telemetry/` is gitignored, so a fresh worktree has an empty one and
 * would read every red tip as green. Same read `land.ts` does, for the same
 * reason — and legitimate through `primaryCheckout()` precisely BECAUSE the
 * path is untracked machine state, so the verdict cannot depend on which
 * branch another directory happens to have checked out.
 */
function baseIsRed(cwd: string): boolean {
    try {
        return existsSync(
            join(primaryCheckout(cwd), ".claude/telemetry/health/RED")
        );
    } catch {
        return false;
    }
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
function shellRun(
    command: string,
    cwd: string,
    json: boolean
): { ok: boolean; ms: number } {
    const t0 = Date.now();
    const r = spawnSync("bun", [GATE, "light", command], {
        stdio: shellStdio(json),
        cwd,
    });
    return { ok: r.status === 0, ms: Date.now() - t0 };
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
 * `exec` and `log` are injected so a test can drive this with a hand-built
 * plan and a fake shell, with no subprocess — same pattern as `runPlan`'s
 * injectable `exec`.
 */
export function executePlan(
    plan: LanePlan,
    head: string,
    json: boolean,
    exec: (command: string) => { ok: boolean; ms: number },
    log: (line: string) => void = console.log
): RunResult {
    if (!json) log(renderPlan(plan, head));

    const result = runPlan(plan, exec);

    if (json) log(renderJson(plan, head, result));
    else log(renderReceipt(result));

    return result;
}

function parseArgs(argv: string[]): { base: string; json: boolean } {
    const baseArg = argv.find((a) => a.startsWith("--base="));
    for (const a of argv) {
        if (a === "--json" || a.startsWith("--base=")) continue;
        fail(`unknown argument \`${a}\` — usage: bun run check:lane [--base=<ref>] [--json]

The lane is derived from the diff and can never be declared by a flag (#2738):
a flag is a hand-maintained list in disguise, and the first agent that passes
\`--skin\` out of habit on a diff touching convex/ gets a lying green.`);
    }
    return {
        base: baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE,
        json: argv.includes("--json"),
    };
}

function main(): void {
    const cwd = process.cwd();
    const { base, json } = parseArgs(process.argv.slice(2));

    if (git(["status", "--porcelain"], cwd).trim() !== "") {
        fail(
            "working tree is dirty — commit or stash first, so the HEAD SHA in the receipt describes exactly what was classified"
        );
    }

    // Preflight before anything expensive — see the § Preflight header for
    // why `land` (which has already fetched and rebased inside its own lock)
    // sets TOLARIA_LAND_GATE and is exempt.
    if (process.env.TOLARIA_LAND_GATE !== "1") {
        if (base === ORIGIN_BASE) fetchBase(cwd);
        const refusal = preflightRefusal({
            behind: behindCount(base, cwd),
            red: baseIsRed(cwd),
            allowRed: process.env.TOLARIA_ALLOW_RED_BASE === "1",
            base,
        });
        if (refusal) fail(refusal);
    }

    const head = git(["rev-parse", "--short", "HEAD"], cwd).trim();
    // ONE plan, built once — passed to executePlan, the single function
    // that reads it for rendering AND execution. Never build a second list
    // of commands, and never render the JSON form by hand next to
    // renderJson (#2748 review, finding 1).
    const plan = classifyLane(
        changedPaths(base, cwd, true),
        changedPaths(base, cwd, false)
    );

    const result = executePlan(plan, head, json, (command) =>
        shellRun(command, cwd, json)
    );

    process.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
    main();
}
