#!/usr/bin/env bun
/**
 * `bun run check:ui` — the headless five-viewport + axe lane (issue #2580,
 * base slice #2512).
 *
 * WHY THIS EXISTS. `.claude/rules/chrome-debug.md` demands a browser receipt
 * for any diff that can change what a user sees, and until now that rule was
 * enforced by nothing: the `dom` vitest project runs on happy-dom, which has
 * no layout engine, so "the card is in the document" passes on a screen where
 * the card sits in a 24px window. #2511 shipped exactly that with the whole
 * `dom` project green — 90 of 95 card images occluded at 390x844. CLAUDE.md's
 * own norm applies: a rule that CAN be enforced mechanically belongs in a
 * script the gate runs.
 *
 * WHAT IT DOES. Owns the whole lifecycle, so a run is reproducible and nothing
 * about it depends on what the developer happens to have open:
 *
 *   1. checks the Convex deployment answers (fail fast, never hang);
 *   2. starts its OWN Vite on 127.0.0.1 and a free port, waits for readiness,
 *      and tears it down on exit — the repo's `dev` script is left alone;
 *   3. registers the run's OWN throwaway account (`lane-account.ts`, issue
 *      #3626), signs every viewport in as it, and destroys it — with every
 *      row it owns — however the run ends;
 *   4. for each of the five Viewport Matrix viewports (ADR 0101), walks every
 *      surface in `surfaces.ts`, runs the occlusion probe (`probe.js`, the
 *      same file the manual runbook points at) and axe-core;
 *   5. compares against `budgets.json` and exits non-zero on a regression OR
 *      on a coverage hole.
 *
 * COVERAGE IS AN ASSERTION, NOT A BEST EFFORT. A surface that could not be
 * reached — the scenario row is missing, an active game blocks the route,
 * login failed — prints UNWALKED and fails the run. A surface with no budget
 * entry is refused rather than measured. The one thing that never happens is a
 * silent green. The three shapes and their handling are documented on
 * `evaluateRun` in `budgets.ts`.
 *
 * THE MACHINE IS NOT THE TREE (issue #3644). A walk cut short by the machine —
 * a backend function past its execution limit, a Convex server error, a
 * navigation or step timeout, a screen that never settled — is classified by
 * its signature (`infra-verdict.ts`) and retried after the 1-minute load drops,
 * recreating the lane's game when the surface plays in one. A cell that still
 * fails on a busy machine stands as `INFRA — <signature>, load <n>`: unproven,
 * never green, never a UI failure. Nothing is measured before it is a Settled
 * Screen (`settle.ts`), and the receipt prints the machine load at the start
 * and end of the run under the coverage line.
 *
 * NOT PART OF `check:all`. The full gate is offline by contract and already
 * mutex-held; booting a browser inside it would tax every session that never
 * touches the DOM. This is a standalone command a UI diff runs, and its output
 * is the receipt that goes in the PR.
 *
 * Usage:
 *   bun run check:ui
 *   bun run check:ui -- --surface=lobby,deck-builder     # subset, same rules
 *   bun run check:ui -- --record                         # record NEW keys only
 *                                                        # (see recordBudgets)
 *   bun run check:ui -- --record --accept=lobby.1440x900x2.cardsOcc
 *                                                        # + accept one named
 *                                                        # regression/tightening
 *   bun run check:ui -- --keep-user                      # leave the run's
 *                                                        # account in place and
 *                                                        # print its credentials
 *   bun run check:ui -- --scope-only                     # print the diff's
 *                                                        # scope, no browser
 *   bun run check:ui -- --all                            # force the full scope
 *   bun run check:ui -- --scope-only --base=<ref>        # scope of the diff
 *                                                        # against another ref
 *
 * SCOPE (issues #3627, #3628; ADR 0131). Every run starts by printing which
 * surfaces the diff against the base branch can reach
 * (`scripts/lib/ui-scope.ts`), or FULL and why. A run started with neither
 * `--surface=` nor `--all` walks exactly that scope: FULL prints `RECEIPT`, a
 * narrower scope prints `SCOPED` naming the base and the surfaces, and an empty
 * scope prints a `SCOPED` receipt that walked nothing — no deployment, no
 * browser. `land` re-derives the scope from the PR's diff and refuses a
 * `SCOPED` receipt that does not match it. A hand-picked `--surface=` subset
 * is still a `DIAGNOSTIC`.
 *
 * Env:
 *   VITE_CONVEX_URL   the deployment to talk to (environment, else the
 *       gitignored `.env.local`). It must be LOCAL: the lane account's role
 *       grant and teardown refuse any other deployment. No credentials are
 *       read — each run mints its own account.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import {
    coverageLine,
    evaluateRun,
    formatResultRow,
    loadBudgets as loadBudgetsFromDisk,
    metricsOf,
    planRecord,
    receiptKindLine,
    type AxeCount,
    type BudgetFile,
    type Measurement,
    type ProbeResult,
    type SquareExample,
    type SoftExample,
    type RecordChange,
    type SurfaceWalk,
    type DiffScope,
    type InfraCell,
} from "./budgets.ts";
import { landingDiffScope } from "./verify-receipt.ts";
import {
    SURFACES,
    SURFACE_IDS,
    Unreachable,
    recreateLaneGame,
    type Surface,
    type WalkContext,
} from "./surfaces.ts";
import { VIEWPORTS } from "./viewports.ts";
import {
    createLaneLifecycle,
    installSignalTeardown,
    LaneAccountError,
    localConvexRunner,
    newLaneAccount,
    passwordSignUp,
    runScreenshotDir,
    withLaneAccount,
} from "./lane-account.ts";
import { ORIGIN_BASE } from "../lib/branches.ts";
import { renderUiScope, type UiScope } from "../lib/ui-scope.ts";
import {
    classifyWalkFailure,
    infraDetail,
    retryStep,
    standingVerdict,
    type RetryPolicy,
} from "./infra-verdict.ts";
import {
    NETWORK_INSTRUMENT_SOURCE,
    trackPageRequests,
    waitForSettledScreen,
} from "./settle.ts";
import { runSettleSelfCheck } from "./settle-selfcheck.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const BUDGETS_PATH = path.join(HERE, "budgets.json");
const PROBE_PATH = path.join(HERE, "probe.js");
const AXE_PATH = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
/** Each run writes under `<root>/<runId>/` (issue #3626). */
const SHOT_ROOT = path.join(REPO_ROOT, ".claude", "telemetry", "ui-gate");

const STRESS_SCENARIO_LABEL = "UI stress — full board, full hand, deep piles";
const YIELDS_SCENARIO_LABEL = "UI yields — two spells on the stack";

/**
 * The Infra Verdict's retry policy (issue #3644): three attempts per cell, and
 * before each retry a wait of up to 90s, sampled every 5s, for the 1-minute
 * load average to drop under the threshold. The threshold is the CPU count —
 * at or over it every core has a queue — unless
 * `TOLARIA_UI_GATE_LOAD_THRESHOLD` says otherwise.
 */
const RETRY_POLICY: RetryPolicy = {
    maxAttempts: 3,
    loadThreshold:
        Number(process.env.TOLARIA_UI_GATE_LOAD_THRESHOLD) || os.cpus().length,
    pollMs: 5_000,
    maxWaitMs: 90_000,
};

function loadAverage(): number {
    return os.loadavg()[0];
}

/** Printed under the coverage line, outside the region `verify-receipt.ts`
 *  re-renders: the load is what a reader needs to judge an INFRA cell, and it
 *  differs between two runs of one tree without meaning anything. */
function machineLoadLine(start: number, end: number): string {
    return `machine load: start ${start.toFixed(1)}, end ${end.toFixed(1)} (1-minute average, ${os.cpus().length} cpus, retry threshold ${RETRY_POLICY.loadThreshold})`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────

class FatalError extends Error {}

function log(message: string): void {
    process.stdout.write(`${message}\n`);
}

/** `.env.local` is gitignored and holds the deployment URL; the credentials go
 *  there too when they are not in the environment. Parsed, never echoed. */
function readEnvLocal(): Record<string, string> {
    const file = path.join(REPO_ROOT, ".env.local");
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return out;
}

async function freePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            if (addr === null || typeof addr === "string") {
                reject(new Error("could not allocate a port"));
                return;
            }
            const port = addr.port;
            srv.close(() => resolve(port));
        });
    });
}

async function reachable(url: string, timeoutMs: number): Promise<boolean> {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), timeoutMs);
        await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        return true;
    } catch {
        return false;
    }
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await reachable(url, 2000)) return;
        await new Promise((r) => setTimeout(r, 400));
    }
    throw new FatalError(
        `the dev server never answered on ${url} within ${Math.round(timeoutMs / 1000)}s`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

async function startViteServer(port: number): Promise<ChildProcess> {
    // `bun run dev` = catalogue:ensure && vite. Run the first half up front so
    // the asset is present, then own the server process ourselves — the repo's
    // `dev` script keeps its default host/port for humans.
    const ensured = spawnSync(
        "node",
        [path.join("scripts", "ensure-full-catalogue.mjs")],
        { cwd: REPO_ROOT, encoding: "utf8" }
    );
    if (ensured.status !== 0) {
        throw new FatalError(
            `catalogue:ensure failed — ${(ensured.stderr || ensured.stdout || "").trim().slice(0, 400)}`
        );
    }

    const child = spawn(
        "bunx",
        [
            "vite",
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--strictPort",
            "--clearScreen",
            "false",
        ],
        { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (/error/i.test(text)) process.stderr.write(`[vite] ${text}`);
    });
    return child;
}

async function launchBrowser(headed: boolean): Promise<Browser> {
    const { chromium } = await import("playwright");
    try {
        return await chromium.launch({ headless: !headed });
    } catch (err) {
        throw new FatalError(
            `could not launch Chromium: ${(err as Error).message}\n` +
                `  Install the browser binary with:  bunx playwright install chromium`
        );
    }
}

/**
 * Sign in ON THIS PAGE if the auth gate is showing.
 *
 * Once per viewport context, NOT once per run reusing `storageState`: Convex
 * auth rotates its refresh token on use, so a storage state captured in one
 * context is already spent by the time the second context loads it. The
 * symptom was not an error — every mobile viewport silently probed the SIGN-IN
 * form and reported four controls and no cards, which is exactly the shape of
 * "green because we measured the wrong screen" this lane exists to prevent.
 */
async function ensureSignedIn(
    page: Page,
    baseUrl: string,
    email: string,
    password: string
): Promise<void> {
    await page.goto(baseUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
    });

    const emailInput = page.locator("input[type=email]").first();
    const signedOut = await emailInput
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);

    if (signedOut) {
        await emailInput.fill(email);
        await page.locator("input[type=password]").first().fill(password);
        await page.locator("button[type=submit]").first().click();
        const ok = await page
            .locator("input[type=email]")
            .first()
            .waitFor({ state: "detached", timeout: 30_000 })
            .then(() => true)
            .catch(() => false);
        if (!ok) {
            const banner = await page
                .locator("[role=alert]")
                .first()
                .textContent()
                .catch(() => null);
            throw new FatalError(
                `sign-in failed for the run's lane account ${email}${banner ? ` — ${banner.trim()}` : ""}. ` +
                    `Bootstrap registered it moments ago, so this is the auth backend, not credentials.`
            );
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Measurement
// ─────────────────────────────────────────────────────────────────────────────

// `ProbeCounts`/`ProbeResult`/`AxeCount`/`metricsOf` live in `budgets.ts`
// (issue #2658) so the `small: probe.smallN` mapping is unit-testable without
// a browser — see `metricsOf`'s doc comment there.

/**
 * THE ONE AXE EXEMPTION, AND IT IS AN ATTRIBUTE, NOT A NUMBER (issue #2593).
 *
 * The hard floor is `axeSerious`/`axeCritical` 0 on every walked surface. One
 * surface cannot honour it as written: `/admin/design-system` is the reference
 * page, and part of what it documents is what a FAILING token looks like — the
 * retired `#6f6244` disabled label beside its replacement, the retired
 * danger-as-text hex beside `danger-strong`, the board's raw counter fills
 * whose own Specimen note reads "white text ≤3:1". Deleting those deletes the
 * comparison; carrying a nonzero budget row instead makes the surface's floor a
 * standing lie that a REAL regression could then hide behind.
 *
 * So the exemption is expressed where the violation is: `data-axe-exempt="<why>"`
 * on the smallest element containing the specimen. It names the exact node, it
 * is reviewable in the diff that adds it, and it cannot silently widen — the
 * count of exempted subtrees is printed on the surface's own line of every run,
 * and `design-system-axe-exemptions.test.ts` fails when the attribute appears
 * outside the reference page.
 */
const AXE_EXEMPT_SELECTOR = "[data-axe-exempt]";

const PROBE_SOURCE = fs.readFileSync(PROBE_PATH, "utf8");

async function runProbe(page: Page): Promise<ProbeResult> {
    await page.addScriptTag({ content: PROBE_SOURCE });
    return (await page.evaluate("window.__tolariaProbe()")) as ProbeResult;
}

async function runAxe(page: Page): Promise<AxeCount> {
    await page.addScriptTag({ path: AXE_PATH });
    const result = (await page.evaluate(
        `(async () => {
            const exempt = document.querySelectorAll(${JSON.stringify(AXE_EXEMPT_SELECTOR)}).length;
            const r = await window.axe.run(
                { exclude: [[${JSON.stringify(AXE_EXEMPT_SELECTOR)}]] },
                { resultTypes: ["violations"] }
            );
            return {
                exempt,
                violations: r.violations.map((v) => ({
                    id: v.id,
                    impact: v.impact,
                    // Kept for the operator, not for the budget: a red line
                    // that only names a rule id sends the reader back to a
                    // browser to find the node.
                    node: (v.nodes[0] && v.nodes[0].html || "").slice(0, 120),
                })),
            };
        })()`
    )) as {
        exempt: number;
        violations: { id: string; impact: string | null; node: string }[];
    };
    const serious = result.violations.filter((v) => v.impact === "serious");
    const critical = result.violations.filter((v) => v.impact === "critical");
    return {
        serious: serious.length,
        critical: critical.length,
        ids: [...new Set([...critical, ...serious].map((v) => v.id))],
        exempt: result.exempt,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface Options {
    surfaces: string[] | null;
    headed: boolean;
    record: boolean;
    /** `${surface}.${viewport}.${key}` tokens naming exactly which
     *  regression/tightening this run is allowed to record (issue #2673) —
     *  see `recordBudgets`. Empty unless `--accept=` is passed. */
    accept: Set<string>;
    /** Skip the lane account's teardown and print its credentials. */
    keepUser: boolean;
    /** Print the diff's scope and exit, before any browser or deployment. */
    scopeOnly: boolean;
    /** Force the full scope whatever the diff. */
    all: boolean;
    /** The ref the diff is taken against; the configured base branch unless
     *  `--base=` names another (same flag as `check:lane`). */
    base: string;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        surfaces: null,
        headed: false,
        record: false,
        accept: new Set(),
        keepUser: false,
        scopeOnly: false,
        all: false,
        base: ORIGIN_BASE,
    };
    for (const arg of argv) {
        if (arg === "--headed") opts.headed = true;
        else if (arg === "--record") opts.record = true;
        else if (arg === "--keep-user") opts.keepUser = true;
        else if (arg === "--scope-only") opts.scopeOnly = true;
        else if (arg === "--all") opts.all = true;
        else if (arg.startsWith("--base=")) {
            opts.base = arg.slice("--base=".length);
        } else if (arg.startsWith("--surface=")) {
            opts.surfaces = arg
                .slice("--surface=".length)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg.startsWith("--accept=")) {
            for (const token of arg
                .slice("--accept=".length)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)) {
                opts.accept.add(token);
            }
        } else if (arg.startsWith("--")) {
            throw new FatalError(`unknown flag ${arg}`);
        }
    }
    return opts;
}

// The actual load moved to `budgets.ts` (issue #2760 review, finding 1) so
// `verify-receipt.ts` can read the same file without importing this module —
// which has no `import.meta.main` guard and boots the whole CLI (Vite,
// Playwright) on import. Wrapped here only to keep this CLI's existing
// `FatalError` presentation (a friendly one-liner, not a raw stack trace).
function loadBudgets(): BudgetFile {
    try {
        return loadBudgetsFromDisk(BUDGETS_PATH);
    } catch (err) {
        throw new FatalError((err as Error).message);
    }
}

function fmtChange(c: RecordChange): string {
    const loc = `${c.surface.padEnd(20)} ${c.viewport.padEnd(12)} ${c.key}`;
    if (c.kind === "new") return `NEW         ${loc}: (absent) → ${c.measured}`;
    const arrow = `${c.prior} → ${c.measured}`;
    if (c.accepted) {
        return `${c.kind.toUpperCase().padEnd(11)} ${loc}: ${arrow}  [recorded — accepted]`;
    }
    const token = `${c.surface}.${c.viewport}.${c.key}`;
    return `${c.kind.toUpperCase().padEnd(11)} ${loc}: ${arrow}  [NOT recorded — pass --accept=${token} to accept]`;
}

/**
 * `--record`: fold this run's measurements back into the budget file.
 * Mutates `budgets` in place (including when nothing is written to disk) so
 * the `evaluateRun` call right after this one sees the SAME ceilings a
 * written file would have — a refused regression therefore still fails the
 * run, exactly as it should: the point of refusing is that the gate keeps
 * catching it, not that `--record` quietly no-ops on it.
 *
 * Three cases, per surface × viewport × `BudgetKey` (issue #2673 — see
 * `planRecord`'s doc comment for the full rationale):
 *   - absent from the prior row → always recorded (the flag's actual job,
 *     #2658's `small` rollout)
 *   - measured worse than the prior ceiling (regression) → refused unless
 *     its exact token is named in `--accept=`
 *   - measured better than the prior ceiling (tightening) → refused unless
 *     named in `--accept=` — it must never ride along in a run recorded for
 *     an unrelated reason (PR #2660)
 *
 * Every difference this run observed is printed, recorded or not — "review
 * before committing" is worthless against a diff nobody named. A `knownDebt`
 * note whose ceiling moved is dropped, never carried forward stale. The file
 * is written, and `recordedOn` bumped, ONLY when something actually changed.
 */
function recordBudgets(
    budgets: BudgetFile,
    walks: SurfaceWalk[],
    accept: ReadonlySet<string>
): void {
    const plan = planRecord(
        budgets,
        walks,
        accept,
        (id) => SURFACES.find((s) => s.id === id)?.label
    );

    budgets.surfaces = plan.surfaces;

    if (plan.changes.length > 0) {
        log("\n─── check:ui --record ──────────────────────────────────────");
        for (const c of plan.changes) log(`  ${fmtChange(c)}`);
    }
    if (plan.droppedKnownDebt.length > 0) {
        log("\ndropped stale knownDebt (the ceiling it describes moved):");
        for (const d of plan.droppedKnownDebt) log(`  · ${d}`);
    }

    if (!plan.changed) {
        log("\nno changes to record — budgets.json left untouched");
        return;
    }

    budgets.recordedOn = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(BUDGETS_PATH, `${JSON.stringify(budgets, null, 4)}\n`);
    log(
        `\nwrote measured values to ${path.relative(REPO_ROOT, BUDGETS_PATH)} — review before committing`
    );
}

function git(args: string[]): string {
    const r = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
    if (r.status !== 0) {
        throw new FatalError(
            `git ${args.join(" ")} failed: ${(r.stderr || "").trim()}`
        );
    }
    return r.stdout;
}

/**
 * Every path this checkout differs in from the base branch: committed since
 * the merge-base, uncommitted, and untracked — the tree Vite actually serves.
 * Deletions are kept: the scoper places them fail-closed. `-z` for the
 * non-ASCII symbol filenames under `public/` (same reason as `check:lane`).
 */
function changedSinceBase(base: string): string[] {
    const mergeBase = git(["merge-base", base, "HEAD"]).trim();
    const tracked = git(["diff", "-z", "--name-only", mergeBase]);
    const untracked = git(["ls-files", "-z", "--others", "--exclude-standard"]);
    const paths = `${tracked}\0${untracked}`.split("\0").filter(Boolean);
    return [...new Set(paths)];
}

function computeRunScope(opts: Options): UiScope {
    if (opts.all) return { kind: "full", reason: "--all" };
    // A scope that cannot be computed walks MORE, never less: an unfetched
    // base ref or a shallow clone degrades to FULL, never to an empty scope.
    let changed: string[];
    try {
        changed = changedSinceBase(opts.base);
    } catch (err) {
        return {
            kind: "full",
            reason: `scope unavailable: ${(err as Error).message}`,
        };
    }
    // The same derivation `land` re-runs on the PR's diff (issue #3628).
    return landingDiffScope(changed, REPO_ROOT);
}

async function main(): Promise<number> {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.all && opts.surfaces) {
        throw new FatalError(
            "--all and --surface= contradict each other: one forces every surface, the other picks a subset"
        );
    }
    const loadAtStart = loadAverage();
    const scope = computeRunScope(opts);
    log(renderUiScope(scope, opts.base));
    if (opts.scopeOnly) return 0;
    const budgets = loadBudgets();

    // A run the diff scoped walks exactly its scope and prints SCOPED; a
    // hand-picked `--surface=` subset never carries a diff scope, so it stays
    // DIAGNOSTIC even when it names the same surfaces (issue #3628).
    const diffScope: DiffScope | null =
        !opts.surfaces && scope.kind === "scoped"
            ? { base: opts.base, surfaces: scope.surfaces }
            : null;
    const selected = opts.surfaces
        ? SURFACES.filter((s) => opts.surfaces!.includes(s.id))
        : diffScope
          ? SURFACES.filter((s) => diffScope.surfaces.includes(s.id))
          : SURFACES;
    if (opts.surfaces && selected.length === 0) {
        throw new FatalError(
            `--surface matched nothing. Known surfaces: ${SURFACE_IDS.join(", ")}`
        );
    }
    const knownIds = selected.map((s) => s.id);

    if (selected.length === 0) {
        // An empty scope owes no browser time: the receipt says so, and the
        // budget file's stale-entry guard still runs.
        const ev = evaluateRun(budgets, [], [], SURFACE_IDS, diffScope);
        log(
            "\n─── check:ui ───────────────────────────────────────────────────"
        );
        log(receiptKindLine(ev));
        log(coverageLine(ev));
        log(machineLoadLine(loadAtStart, loadAverage()));
        if (ev.failures.length > 0) {
            log("\n✗ check:ui FAILED");
            for (const f of ev.failures) log(`  · ${f}`);
            return 1;
        }
        log("\n✓ check:ui passed — nothing to walk");
        return 0;
    }

    const env = { ...readEnvLocal(), ...process.env } as Record<string, string>;
    const convexUrl = env.VITE_CONVEX_URL;
    if (!convexUrl) {
        throw new FatalError("VITE_CONVEX_URL is unset (.env.local)");
    }
    if (!(await reachable(convexUrl, 5000))) {
        throw new FatalError(
            `the Convex deployment at ${convexUrl} did not answer. Start it with ` +
                `\`bunx convex dev\` (this lane never starts one — a second backend ` +
                `on the same deployment is worse than a clear failure).`
        );
    }
    if (!fs.existsSync(AXE_PATH)) {
        throw new FatalError(
            `axe-core is not installed at ${AXE_PATH} — run \`bun install\``
        );
    }

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // The run's own account (issue #3626). Teardown runs from `withLaneAccount`'s
    // `finally` on every normal exit and from the signal handler on SIGINT /
    // SIGTERM, which never reach a `finally`.
    const lane = createLaneLifecycle({
        account: newLaneAccount(),
        run: localConvexRunner(),
        signUp: passwordSignUp(convexUrl),
        keepUser: opts.keepUser,
        log,
    });
    const shotDir = runScreenshotDir(SHOT_ROOT, lane.account.runId);

    // Not `let vite: ChildProcess | null = null`: it is assigned inside the
    // `withLaneAccount` callback, and an annotated `null` initialiser narrows
    // the outer `finally`'s read to `never`.
    let vite = null as ChildProcess | null;
    let browser: Browser | null = null;
    const startedAt = Date.now();
    const uninstallSignals = installSignalTeardown(
        process,
        () => {
            lane.teardown();
            vite?.kill("SIGTERM");
        },
        (code) => process.exit(code)
    );

    try {
        return await withLaneAccount(lane, async () => {
            try {
                log(`ui-gate: starting vite on ${baseUrl}`);
                vite = await startViteServer(port);
                await waitForServer(baseUrl, 90_000);

                browser = await launchBrowser(opts.headed);

                // The settle predicate, proven in THIS Chromium before any
                // reading depends on it (issue #3644): a predicate that returns
                // early would turn every measurement back into a flap.
                try {
                    log(`ui-gate: ${await runSettleSelfCheck(browser)}`);
                } catch (err) {
                    throw new FatalError(
                        `settle self-check failed — ${(err as Error).message}`
                    );
                }

                // Compile the app once before anything is timed. `waitForServer` only
                // proves the dev server answers for index.html; the first REAL
                // navigation still pays Vite's cold transform of the whole module
                // graph, and that used to land on `ensureSignedIn`'s 30s budget. With
                // signed-out surfaces walked first it lands on a 20s `goto` instead,
                // and the first surface of the run reported UNWALKED on a screen that
                // renders fine. Warming here keeps which surface goes first from
                // deciding whether the run is green.
                {
                    const warm = await browser.newPage();
                    await warm
                        .goto(baseUrl, {
                            waitUntil: "domcontentloaded",
                            timeout: 90_000,
                        })
                        .catch(() => {});
                    await warm.waitForTimeout(1500);
                    await warm.close();
                }

                const ctx: WalkContext = {
                    baseUrl,
                    stressScenarioLabel: STRESS_SCENARIO_LABEL,
                    yieldsScenarioLabel: YIELDS_SCENARIO_LABEL,
                    fixtureLabels: lane.labels,
                    createdGame: false,
                    log: () => {},
                };

                const perSurface = new Map<string, Measurement[]>();
                const unreachable = new Map<string, string>();
                /** Cells that stood as an Infra Verdict, per surface (issue #3644). */
                const infra = new Map<string, InfraCell[]>();
                const consoleErrors: string[] = [];
                /** Every walk on which the SHELL RETURN BAND was mounted, and how many
                 *  controls `probe.js` culled for it (issue #3337). Reported after the
                 *  coverage line — deliberately OUTSIDE the region `verify-receipt.ts`
                 *  re-renders (banner..rows..coverage), so a new line here can never
                 *  invalidate a pasted receipt. */
                const bandWalks: { where: string; excluded: number }[] = [];

                for (const viewport of VIEWPORTS) {
                    const context: BrowserContext = await browser.newContext({
                        viewport: {
                            width: viewport.width,
                            height: viewport.height,
                        },
                        deviceScaleFactor: viewport.dpr,
                        isMobile: viewport.mobile,
                        hasTouch: viewport.mobile,
                    });
                    // Before any app code: the settle predicate counts the Convex
                    // requests in flight through this (`settle.ts`).
                    await context.addInitScript(NETWORK_INSTRUMENT_SOURCE);
                    const page = await context.newPage();
                    trackPageRequests(page);
                    /** The console errors of the CURRENT walk attempt, untruncated —
                     *  what `classifyWalkFailure` reads a signature from. */
                    const attemptConsole: string[] = [];
                    page.on("console", (msg) => {
                        if (msg.type() === "error") {
                            attemptConsole.push(msg.text());
                            consoleErrors.push(
                                `${viewport.id}: ${msg.text().slice(0, 160)}`
                            );
                        }
                    });
                    /**
                     * Walk one surface to a Settled Screen on the CURRENT page,
                     * retrying an Infra Verdict (issue #3644). True when the
                     * screen is ready to measure. Otherwise the outcome is
                     * recorded — UNWALKED for the whole surface, or an INFRA
                     * cell for this viewport — and the answer is false.
                     */
                    const walkToSettled = async (
                        surface: Surface
                    ): Promise<boolean> => {
                        const cell = `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)}`;
                        for (let attempts = 1; ; attempts++) {
                            // Console events arrive asynchronously; a round trip
                            // through the page flushes the ones the previous
                            // attempt (or surface) logged before they are cleared,
                            // so none can land in this attempt's signature.
                            await page.evaluate("0").catch(() => {});
                            attemptConsole.length = 0;
                            try {
                                await surface.walk(page, ctx);
                                await waitForSettledScreen(page, {
                                    targets: surface.settleTargets,
                                });
                                // A backend function that timed out can still
                                // leave a screen that settles — an error panel,
                                // held data, an empty list — and measuring it
                                // would report the machine as a UI failure. Only
                                // this signature: a `Server Error` can be logged
                                // harmlessly on a quiet machine.
                                await page.evaluate("0").catch(() => {});
                                const timedOut = attemptConsole.find((line) => {
                                    const c = classifyWalkFailure({
                                        message: "",
                                        consoleErrors: [line],
                                    });
                                    return (
                                        c.kind === "INFRA" &&
                                        c.signature === "function-timeout"
                                    );
                                });
                                if (timedOut) {
                                    throw new Error(
                                        `the screen settled, but a backend function timed out while it loaded: ${timedOut.split("\n").slice(-1)[0]}`
                                    );
                                }
                                return true;
                            } catch (err) {
                                const message = (err as Error).message;
                                const reason =
                                    err instanceof Unreachable
                                        ? message
                                        : `walk threw: ${message.split("\n")[0]}`;
                                const failure = classifyWalkFailure({
                                    message,
                                    consoleErrors: attemptConsole,
                                });
                                if (failure.kind === "UNWALKED") {
                                    unreachable.set(surface.id, reason);
                                    log(`${cell} UNWALKED — ${reason}`);
                                    return false;
                                }

                                const failedAt = loadAverage();
                                const said = infraDetail(
                                    failure.signature,
                                    failedAt
                                );
                                const samples: number[] = [];
                                let step = retryStep(
                                    attempts,
                                    samples,
                                    RETRY_POLICY
                                );
                                while (step.action === "wait") {
                                    if (step.ms > 0) await sleep(step.ms);
                                    samples.push(loadAverage());
                                    step = retryStep(
                                        attempts,
                                        samples,
                                        RETRY_POLICY
                                    );
                                }

                                if (step.action === "give-up") {
                                    const firstLine = reason.split("\n")[0];
                                    if (
                                        standingVerdict(
                                            failedAt,
                                            RETRY_POLICY
                                        ) === "UNWALKED"
                                    ) {
                                        const quiet = `${firstLine} (${said}, under the retry threshold: the walk itself failed)`;
                                        unreachable.set(surface.id, quiet);
                                        log(`${cell} UNWALKED — ${quiet}`);
                                        return false;
                                    }
                                    const cells = infra.get(surface.id) ?? [];
                                    cells.push({
                                        viewport: viewport.id,
                                        signature: failure.signature,
                                        load: failedAt,
                                        reason: firstLine,
                                    });
                                    infra.set(surface.id, cells);
                                    log(
                                        `${cell} INFRA — ${said} after ${attempts} attempt(s): ${firstLine}`
                                    );
                                    return false;
                                }

                                log(
                                    `${cell} infra attempt ${attempts}/${RETRY_POLICY.maxAttempts} — ${said}; retrying at load ${(samples.at(-1) ?? failedAt).toFixed(1)}`
                                );
                                // Undo what the failed attempt created (the
                                // `deck-builder` fixture's `userDecks` row, issue
                                // #2671) before the retry overwrites the record of
                                // it; `measure()` cleans up only after the last.
                                if (surface.cleanup) {
                                    try {
                                        await surface.cleanup(page, ctx);
                                    } catch (e) {
                                        log(
                                            `${cell} CLEANUP FAILED before the retry — ${(e as Error).message.split("\n")[0]}`
                                        );
                                    }
                                }
                                if (surface.needsGame) {
                                    await recreateLaneGame(page, ctx).catch(
                                        (e) =>
                                            log(
                                                `${cell} could not recreate the lane's game before the retry — ${(e as Error).message.split("\n")[0]}`
                                            )
                                    );
                                }
                            }
                        }
                    };

                    /**
                     * Walk + probe one surface on the CURRENT page.
                     *
                     * Extracted so the `preAuth` surfaces can run through exactly the
                     * same measurement before `ensureSignedIn` — a second copy of this
                     * block is how one of the two groups would quietly stop being
                     * probed, screenshotted or budget-checked.
                     */
                    const measure = async (surface: Surface): Promise<void> => {
                        const budget = budgets.surfaces[surface.id];
                        if (budget?.status === "unwalked") return;
                        if (unreachable.has(surface.id)) return;

                        let walked = await walkToSettled(surface);

                        // The page can still navigate between the settle and
                        // the last evaluate — the document the probe measured
                        // is then gone before axe reads it, and the error used
                        // to take the whole run down (measured on this branch,
                        // `game-debug-sheet` @ 1440x900x2). Re-settle and
                        // measure again; a page that will not hold still for
                        // a measurement is a surface the lane could not
                        // measure, said as such.
                        let measured: {
                            probe: ProbeResult;
                            axe: AxeCount;
                        } | null = null;
                        for (let tries = 1; walked && !measured; tries++) {
                            try {
                                const probe = await runProbe(page);
                                const axe = await runAxe(page);
                                measured = { probe, axe };
                            } catch (err) {
                                const first = (err as Error).message.split(
                                    "\n"
                                )[0];
                                const navigated =
                                    /Execution context was destroyed|navigat/i.test(
                                        first
                                    );
                                if (!navigated || tries >= 3) {
                                    const reason = navigated
                                        ? `the page navigated during the measurement ${tries} time(s) in a row: ${first}`
                                        : `the measurement threw: ${first}`;
                                    unreachable.set(surface.id, reason);
                                    log(
                                        `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} UNWALKED — ${reason}`
                                    );
                                    walked = false;
                                    break;
                                }
                                await waitForSettledScreen(page, {
                                    targets: surface.settleTargets,
                                }).catch(() => {});
                            }
                        }

                        if (walked && measured) {
                            const { probe, axe } = measured;
                            const metrics = metricsOf(probe, axe);
                            if (probe.shellBand.mounted) {
                                bandWalks.push({
                                    where: `${surface.id} @ ${viewport.id}`,
                                    excluded: probe.shellBand.excluded,
                                });
                            }
                            const shot = path.join(
                                shotDir,
                                `${surface.id}__${viewport.id}.png`
                            );
                            await page.screenshot({ path: shot });

                            // `cardsSquare` names its offenders inline (issue #2724):
                            // "5 cards are square" is not actionable, and the whole
                            // point of a shape check is that the reader cannot see the
                            // shape from a count.
                            // `cardsSoft` names its offenders inline for the same
                            // reason `cardsSquare` does (issue #3553): "3 cards are
                            // soft" tells a reader nothing they can act on, while
                            // "Brainstorm 208px needs 416, has 146 (thumb)" names the
                            // slot, the deficit and the rendition that lost.
                            const softEx = probe.cardsSoftN
                                ? ` soft${probe.cardsSoftN}[` +
                                  (probe.cardsSoft as SoftExample[])
                                      .map(
                                          (c) =>
                                              `${c.t} ${c.w}px dec${c.dec} needs${c.need} has${c.have} ${c.src}`
                                      )
                                      .join("; ") +
                                  `]`
                                : ` soft0`;
                            const squareEx = probe.cardsSquareN
                                ? ` square${probe.cardsSquareN}[` +
                                  (probe.cardsSquare as SquareExample[])
                                      .map(
                                          (c) =>
                                              `${c.t} ${c.w}x${c.h} r${c.r} "${c.cls}"`
                                      )
                                      .join("; ") +
                                  `]`
                                : ` square0`;
                            const detail =
                                `cards n${probe.cards.n} zero${probe.cards.zero} occ${probe.cards.occ} ` +
                                `stranded${probe.cards.stranded} reach${probe.cards.reachable}` +
                                `${squareEx}${softEx}` +
                                `${probe.cardsSoftPending ? ` softPending${probe.cardsSoftPending}` : ""}` +
                                `${probe.cardsSoftUnknown ? ` softUnknown${probe.cardsSoftUnknown}` : ""} | ` +
                                `ctrls n${probe.ctrls.n} zero${probe.ctrls.zero} occ${probe.ctrls.occ} ` +
                                `stranded${probe.ctrls.stranded} | starved${probe.starvedN} | ` +
                                `axe s${axe.serious}/c${axe.critical}${axe.ids.length ? ` (${axe.ids.join(",")})` : ""}` +
                                `${axe.exempt ? ` exempt${axe.exempt}` : ""} | ` +
                                `small${probe.smallN} tiny${probe.tinyText} hOverflow${probe.hOverflow}`;
                            log(
                                `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} ${detail}`
                            );

                            const list = perSurface.get(surface.id) ?? [];
                            list.push({
                                viewport: viewport.id,
                                metrics,
                                screenshot: path.relative(REPO_ROOT, shot),
                                detail,
                            });
                            perSurface.set(surface.id, list);
                        }

                        // Issue #2671 review round 2 MUST-FIX: this used to sit inside
                        // the happy path above (and the original `catch` block above
                        // `return`ed before ever reaching it), so a walk that threw
                        // AFTER the fixture import — for `deck-builder` that is the
                        // one `Unreachable` site past the Import confirm click, the
                        // sideboard check — left the `userDecks` row it created
                        // permanently on the deployment.
                        // Runs on BOTH the happy path and the failure path now (on the
                        // SAME page), undoing state the walk had to create for the
                        // probe to see (the `deck-builder` fixture's real `userDecks`
                        // row) without touching what was just measured. Best-effort:
                        // a cleanup failure is hygiene debt, not a measurement defect,
                        // so it is logged rather than failing the surface.
                        if (surface.cleanup) {
                            try {
                                await surface.cleanup(page, ctx);
                            } catch (err) {
                                log(
                                    `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} CLEANUP FAILED — ${(err as Error).message.split("\n")[0]}`
                                );
                            }
                        }
                    };

                    // Signed-out surfaces FIRST: `<AuthGate>` makes them unreachable
                    // once a session exists, and `ensureSignedIn` navigates back to
                    // the app root itself, so this costs the signed-in walks nothing.
                    for (const surface of selected.filter((s) => s.preAuth)) {
                        await measure(surface);
                    }

                    await ensureSignedIn(
                        page,
                        baseUrl,
                        lane.account.email,
                        lane.account.password
                    );
                    log(
                        `ui-gate: ${viewport.id} (${viewport.label}) — signed in`
                    );

                    for (const surface of selected.filter((s) => !s.preAuth)) {
                        await measure(surface);
                    }

                    await context.close();
                }

                const walks: SurfaceWalk[] = [];
                for (const id of knownIds) {
                    const reason = unreachable.get(id);
                    if (reason) {
                        walks.push({
                            surface: id,
                            status: "unreachable",
                            reason,
                        });
                    } else if (perSurface.has(id) || infra.has(id)) {
                        walks.push({
                            surface: id,
                            status: "measured",
                            measurements: perSurface.get(id) ?? [],
                            infra: infra.get(id),
                        });
                    }
                }

                if (opts.record) recordBudgets(budgets, walks, opts.accept);

                const ev = evaluateRun(
                    budgets,
                    knownIds,
                    walks,
                    SURFACE_IDS,
                    diffScope
                );

                log(
                    "\n─── check:ui ───────────────────────────────────────────────────"
                );
                log(receiptKindLine(ev));
                for (const row of ev.rows) {
                    log(formatResultRow(row));
                }
                log(coverageLine(ev));
                log(machineLoadLine(loadAtStart, loadAverage()));
                // The shell return band's attribution (issue #3337). `probe.js` culls
                // it out of every control count because its presence is a function of
                // the gate ACCOUNT's state — a game or Limited event in flight — and
                // not of the tree; the point of the line is that the exclusion is
                // never silent, so it prints on both branches.
                if (bandWalks.length === 0) {
                    log(
                        "shell return band: absent on every walk — no controls excluded"
                    );
                } else {
                    const excluded = bandWalks.reduce(
                        (n, w) => n + w.excluded,
                        0
                    );
                    log(
                        `shell return band: MOUNTED on ${bandWalks.length} walk(s) — ${excluded} control(s) excluded from those counts (the run's lane account has a game or event in flight; issue #3337)`
                    );
                }
                log(
                    `console errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.length}`
                );
                for (const line of consoleErrors.slice(0, 10)) log(`  ${line}`);
                if (ev.knownDebt.length > 0) {
                    log(
                        "\nknown debt carried by the budgets (a later slice owns these):"
                    );
                    for (const d of ev.knownDebt) log(`  · ${d}`);
                }
                log(`screenshots: ${path.relative(REPO_ROOT, shotDir)}/`);
                log(
                    `wall time: ${Math.round((Date.now() - startedAt) / 1000)}s`
                );

                if (ev.failures.length > 0) {
                    log("\n✗ check:ui FAILED");
                    for (const f of ev.failures) log(`  · ${f}`);
                    return 1;
                }
                log("\n✓ check:ui passed");
                return 0;
            } finally {
                // Closed BEFORE the account is torn down, so no page is still
                // subscribed to rows the teardown is deleting.
                if (browser) await browser.close().catch(() => {});
            }
        });
    } finally {
        if (vite) vite.kill("SIGTERM");
        uninstallSignals();
    }
}

try {
    process.exit(await main());
} catch (err) {
    if (err instanceof FatalError || err instanceof LaneAccountError) {
        process.stderr.write(`\n✗ check:ui: ${err.message}\n`);
        process.exit(2);
    }
    throw err;
}
