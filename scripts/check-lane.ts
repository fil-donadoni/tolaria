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
 *
 * Exits 1 on a dirty working tree, so the HEAD SHA it prints describes
 * exactly what was classified.
 *
 * `--plan` IS NOT A LANE FLAG (ADR 0136 §8). It suppresses EXECUTION, never
 * classification: the lane still comes from the diff, through the same
 * `classifyLane` call every other mode uses. It exists because
 * `/next-issue` §3 keys its `cards` short path — no hand-written test, no
 * proof-of-failure, no bot or frontend walk — on the lane the diff really
 * classifies as, and a session that had to PAY a lane gate to learn that
 * would be running the pre-PR gate §1 retired. Ask after committing: the
 * dirty-tree refusal applies here too, and an uncommitted card is a path the
 * classifier cannot see.
 *
 * NO PREFLIGHT (ADR 0136 §1). Issue #3286 made this refuse a tree behind the
 * base tip or a RED base before paying the gate, to stop a hand-run PRE-PR
 * gate being paid twice. There is no pre-PR gate any more — `land` pays the
 * lane once, on the rebased tip, inside the mutex — so the refusal went with
 * it. A hand-run `check:lane` gates whatever HEAD is, stale or not.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { ORIGIN_BASE } from "./lib/branches";
import { DOC_GATE_TESTS } from "./lib/doc-gate-tests";

/** The whole node project, as its two fixed partitions (ADR 0136 §5). */
export const NODE_PARTITIONS = "--project node-engine --project node-tooling";

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
    // `scripts/__tests__` and `convex/limited` guards this lane never runs.
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
            // The only check that catches the duplicate-import class that
            // crashes the app on cold load, and it costs 12s (#2738).
            { id: "bundle", command: "bun run check:bundle" },
            { id: "cr:lint", command: "bun run cr:lint" },
            // `scripts/**` stays in the SKIN lane on purpose: it is where
            // `src-test-env-split.test.ts` lives, the guard against a new
            // `src` test file being selected by neither vitest project — and
            // skin is precisely the lane that adds `src` test files (#2738).
            // Both node partitions (ADR 0136 §5): the DOM-free `src` tests are
            // in `node-engine`, that guard is in `node-tooling`.
            {
                id: "node[src,scripts]",
                command: `bunx vitest run ${NODE_PARTITIONS} src/ scripts/`,
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
            {
                id: "bot fast lane",
                reason: "no changed code under convex/** or scripts/** — the bot suites cannot go red",
            },
            {
                id: "node[convex]",
                reason: "no changed code under convex/** — the engine tests cannot go red",
            }
        );
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
            // Not in ADR 0136 §4's list, kept on purpose: the card registry
            // is imported by the client, and the duplicate-import class that
            // crashes the app on cold load is caught by the bundle alone —
            // tsc and eslint both pass it (#2738). 12s against a blank board.
            { id: "bundle", command: "bun run check:bundle" },
            { id: "cr:lint", command: "bun run cr:lint" },
            // A FIXED partition classified by content (ADR 0136 §5), never
            // the touched set's own directory: `convex/cards/` whole is the
            // catalogue guards plus EVERY set's tests — 425 files, 18s at
            // load 25 — so ADR 0104's no-diff-derived-subset rule holds and a
            // card borrowed by another set's test is still proven.
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
            {
                id: "bot fast lane",
                reason: "every code path is a card definition or a data/** artefact — a card on exercised Ops cannot move a search or eval test; its censuses run as bot[cards], and a card that adds an Op touches convex/gre/** and is engine (ADR 0136 §4)",
            },
            {
                id: "node-engine+node-tooling",
                reason: "every code path is a card definition or a data/** artefact — the catalogue guards and every set's tests run as node[cards]; a card on exercised Ops cannot reach an engine or tooling test (ADR 0136 §4)",
            },
            {
                id: "dom",
                reason: "no changed code under src/** — no component, style or asset changed",
            }
        );
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
        { id: "bundle", command: "bun run check:bundle" },
        { id: "cr:lint", command: "bun run cr:lint" },
        {
            id: "bot fast lane",
            command:
                "TOLARIA_BOT_FAST=1 bunx vitest run --project bot-node --project bot-dom",
        },
        // The FIXED `node-engine` partition, whole (ADR 0136 §5): `convex/**`,
        // the DOM-free `src` tests, and every `scripts` test that reaches
        // `convex/` or `data/` (`scripts/test-env-split.ts`).
        { id: "node-engine", command: "bunx vitest run --project node-engine" }
    );
    skip.push({
        id: "dom",
        reason: "no changed code under src/** — the whole type-check and convex-cards-barrel-mock.test.ts are the backstops (#2738)",
    });
    // `node-tooling` is admitted by the diff, whole or not at all — the
    // ADR 0104 admission rule, never a slice: a `scripts/**` edit can red a
    // tooling test, a `convex/**` or `data/**` edit cannot reach one.
    if (files.some((p) => p.startsWith("scripts/"))) {
        run.push({
            id: "node-tooling",
            command: "bunx vitest run --project node-tooling",
        });
    } else {
        skip.push({
            id: "node-tooling",
            reason: "no changed code under scripts/** — no tooling test imports convex/ or data/, and neither it nor a module it imports names either as a path (scripts/test-env-split.ts)",
        });
    }
    appendDocsGuards(files, run);
    return { lane, rationale: engineRationale(files), files, run, skip };
}

/**
 * Prose in a code lane (ADR 0136 §3): the run list ENDS with the docs lane's
 * own node test list — the guards that READ prose, exactly the set
 * `check:docs` runs (`DOC_GATE_TESTS`, one list, two consumers). The other two
 * things `check:docs` owes are already in every code lane: `format(diff)`
 * carries the `.md` paths (prettier has a markdown parser) and `cr:lint` is
 * a fixed entry of both `skin` and `engine`.
 *
 * `skin`'s `node[src,scripts]` selects these files already; `engine` runs
 * `node-engine` and admits `node-tooling` only for a `scripts/**` diff
 * (ADR 0136 §5), so for a `convex/**` + prose diff this entry is what runs the
 * prose guards that live in `node-tooling`. A FIXED list, never a
 * diff-derived one — ADR 0104's admission rule is untouched.
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
    return codeLaneRationale(files, "convex/**, scripts/** or data/**");
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
    result?: RunResult
): string {
    return JSON.stringify({ head, ...plan, ...result }, null, 2);
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

/**
 * Argument parsing is a DECISION (which base, which rendering, run or only
 * classify), so it is a pure function tested directly — repo convention in
 * this file, same as `shellStdio` and `runPlan`'s injected `exec`.
 */
export function parseArgs(argv: string[]): {
    base: string;
    json: boolean;
    planOnly: boolean;
} {
    const baseArg = argv.find((a) => a.startsWith("--base="));
    for (const a of argv) {
        if (a === "--json" || a === "--plan" || a.startsWith("--base=")) {
            continue;
        }
        fail(`unknown argument \`${a}\` — usage: bun run check:lane [--base=<ref>] [--json] [--plan]

The lane is derived from the diff and can never be declared by a flag (#2738):
a flag is a hand-maintained list in disguise, and the first agent that passes
\`--skin\` out of habit on a diff touching convex/ gets a lying green.
\`--plan\` is not that flag: it prints the lane this diff classifies as and
runs nothing, so it cannot make a wrong lane true.`);
    }
    return {
        base: baseArg ? baseArg.slice("--base=".length) : ORIGIN_BASE,
        json: argv.includes("--json"),
        planOnly: argv.includes("--plan"),
    };
}

function main(): void {
    const cwd = process.cwd();
    const { base, json, planOnly } = parseArgs(process.argv.slice(2));

    if (git(["status", "--porcelain"], cwd).trim() !== "") {
        fail(
            "working tree is dirty — commit or stash first, so the HEAD SHA in the receipt describes exactly what was classified"
        );
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

    // `--plan` stops HERE, after the one `classifyLane` call above and
    // before any shell: the session asking which path §3 owes it must not
    // pay a gate to find out (ADR 0136 §1/§8).
    if (planOnly) {
        console.log(renderClassification(plan, head, json));
        process.exit(0);
    }

    const result = executePlan(plan, head, json, (command) =>
        shellRun(command, cwd, json)
    );

    process.exit(result.ok ? 0 : 1);
}

if (import.meta.main) {
    main();
}
