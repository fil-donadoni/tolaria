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
 *   5. holds every Floor at zero (`floors.ts`, ADR 0132) and exits non-zero on
 *      a broken Floor OR on a coverage hole. Shape Readings are printed, never
 *      compared.
 *
 * COVERAGE IS AN ASSERTION, NOT A BEST EFFORT. A surface that could not be
 * reached — the scenario row is missing, an active game blocks the route,
 * login failed — prints UNWALKED and fails the run. The only surface skipped is
 * one `UNWALKED_SURFACES` declares, in code, with its issue. The one thing that
 * never happens is a silent green. The shapes and their handling are
 * documented in `receipt.ts`.
 *
 * THE RECEIPT HAS TWO BLOCKS (ADR 0132 §6): the verdict block — banner, one
 * line per surface × viewport, coverage line — which `land` re-derives from the
 * diff's scope, then `DIAGNOSTIC_SEPARATOR` and the diagnostic block — Shape
 * Readings, infra signatures, load, console errors, wall time — which it never
 * reads.
 *
 * THE MACHINE IS NOT THE TREE (issue #3644). A walk cut short by the machine —
 * a backend function past its execution limit, a Convex server error, a
 * navigation or step timeout, a screen that never settled — is classified by
 * its signature (`infra-verdict.ts`) and retried after the 1-minute load drops,
 * recreating the lane's game when the surface plays in one. A cell that still
 * fails on a busy machine stands as `INFRA — <signature>, load <n>`: unproven,
 * never green, never a UI failure. Nothing is measured before it is a Settled
 * Screen (`settle.ts`), and the diagnostic block prints the machine load at the
 * start and end of the run.
 *
 * NOT PART OF `check:all`. The full gate is offline by contract and already
 * mutex-held; booting a browser inside it would tax every session that never
 * touches the DOM. This is a standalone command a UI diff runs, and its output
 * is the receipt that goes in the PR.
 *
 * Usage:
 *   bun run check:ui
 *   bun run check:ui -- --surface=lobby,deck-builder     # subset, same rules
 *   bun run check:ui -- --keep-user                     # leave the run's
 *                                                        # account in place and
 *                                                        # print its credentials
 *   bun run check:ui -- --scope-only                     # print the diff's
 *                                                        # scope, no browser
 *   bun run check:ui -- --all                            # force the full scope
 *   bun run check:ui -- --parallel=1                     # override the count
 *                                                        # the machine sized
 *   bun run check:ui -- --scope-only --base=<ref>        # scope of the diff
 *                                                        # against another ref
 *
 * SPEED IS SIZED TO THE MACHINE (issue #3653, re-sized in #4687). The five
 * viewports are walked `viewportParallelism(ncpu, totalMemory)` at a time —
 * five contexts on an 8-core box, never fewer than two (`MIN_PARALLELISM`),
 * the load average not consulted — each in its own browser context, each parallel LANE
 * signed in as its own lane account (a lane walks its viewports one after
 * another, so the account is the LANE's), because the one-game-per-account
 * lobby gate would otherwise serialise the contexts. The count changes the
 * WALL TIME and nothing else: cells are
 * collected and printed in the fixed Viewport Matrix order (`parallel.ts`), so
 * the verdict block `land` re-derives is byte-identical whatever N was.
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
    readingsOf,
    UNWALKED_SURFACES,
    type AxeCount,
    type ProbeResult,
    type Readings,
    type SquareExample,
    type SoftExample,
} from "./floors.ts";
import {
    DIAGNOSTIC_SEPARATOR,
    DIGEST_HEADER,
    diagnosticLines,
    evaluateRun,
    verdictBlockLines,
    verdictDigestLines,
    type Evaluation,
    type DiffScope,
    type InfraCell,
    type SurfaceWalk,
} from "./receipt.ts";
import { landingDiffScope } from "./verify-receipt.ts";
import {
    assertLabelsBySurface,
    evaluateAssertions,
    type AssertResult,
} from "./assertions.ts";
import {
    SURFACES,
    SURFACE_IDS,
    Unreachable,
    recreateLaneGame,
    type Surface,
    type WalkContext,
} from "./surfaces.ts";
import { VIEWPORTS, VIEWPORT_IDS, type Viewport } from "./viewports.ts";
import {
    createLaneFleet,
    installSignalTeardown,
    LaneAccountError,
    localConvexRunner,
    newLaneAccount,
    newRunId,
    passwordSeedDeck,
    passwordSignUp,
    runScreenshotDir,
    withLaneFleet,
    type LaneMember,
} from "./lane-account.ts";
import {
    collectRun,
    parseParallelOverride,
    runPool,
    viewportParallelism,
    type ViewportResult,
} from "./parallel.ts";
import { ORIGIN_BASE } from "../lib/branches.ts";
import { renderUiScope, type UiScope } from "../lib/ui-scope.ts";
import { acquireUiLane, gateLockRoot } from "../lib/ui-admission.ts";
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
import {
    cellTimingSuffix,
    emptyTimings,
    phaseSummaryLines,
    timed,
    type CellTiming,
    type PhaseTimings,
} from "./phase-timing.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PROBE_PATH = path.join(HERE, "probe.js");
const AXE_PATH = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
/** Each run writes under `<root>/<runId>/` (issue #3626). */
const SHOT_ROOT = path.join(REPO_ROOT, ".claude", "telemetry", "ui-gate");

const STRESS_SCENARIO_LABEL = "UI stress — full board, full hand, deep piles";
const YIELDS_SCENARIO_LABEL = "UI yields — two spells on the stack";
const AI_TRACE_SCENARIO_LABEL =
    "UI AI trace — quiet board, priority on the human seat";
const BOARD_SCENARIO_LABEL = "UI board — ordinary mid-game position";
const COMBAT_SCENARIO_LABEL = "UI combat — blocks owed on a confirmed attack";
const CHOICE_SCENARIO_LABEL =
    "UI choice — a card pick over the board, seven candidates";

/**
 * The Infra Verdict's retry policy (issue #3644): three attempts per cell, and
 * before each retry a wait, sampled every 5s, for the 1-minute load average to
 * drop under the threshold — continued only while the load is FALLING and for
 * at most 30s (issue #4687; it was 90s spent in full on a load that never
 * moved). The threshold is the CPU count — at or over it every core has a
 * queue — unless `TOLARIA_UI_GATE_LOAD_THRESHOLD` says otherwise.
 */
const RETRY_POLICY: RetryPolicy = {
    maxAttempts: 3,
    loadThreshold:
        Number(process.env.TOLARIA_UI_GATE_LOAD_THRESHOLD) || os.cpus().length,
    pollMs: 5_000,
    maxWaitMs: 30_000,
};

function loadAverage(): number {
    return os.loadavg()[0];
}

/** Printed in the diagnostic block, which `land` never reads: the load is what
 *  a reader needs to judge an INFRA cell, and it differs between two runs of
 *  one tree without meaning anything. */
function machineLoadLine(start: number, end: number): string {
    return `machine load: start ${start.toFixed(1)}, end ${end.toFixed(1)} (1-minute average, ${os.cpus().length} cpus, retry threshold ${RETRY_POLICY.loadThreshold})`;
}

/** The run's evaluation against the real surface table, viewport matrix and
 *  declared-unwalked list. */
function evaluate(
    knownIds: readonly string[],
    walks: readonly SurfaceWalk[],
    diffScope: DiffScope | null
): Evaluation {
    return evaluateRun({
        knownSurfaceIds: knownIds,
        walks,
        definedSurfaceIds: SURFACE_IDS,
        viewportIds: VIEWPORT_IDS,
        unwalked: UNWALKED_SURFACES,
        diffScope,
        assertsBySurface: assertLabelsBySurface(SURFACES),
    });
}

/**
 * Print the receipt — the verdict block, the separator, the diagnostic block
 * closed by this run's own facts — then the summary. Returns the exit code.
 */
function printReceipt(
    ev: Evaluation,
    runFacts: readonly string[],
    passed: string
): number {
    log("\n─── check:ui ───────────────────────────────────────────────────");
    for (const line of verdictBlockLines(ev)) log(line);
    // The digest form, right under the block it stands for (issue #4419).
    // The block outgrew GitHub's 65,536-character pull-request body at 52
    // surfaces, and the PR paste is this lane's whole enforcement; these
    // three lines carry the same claim, and `verify-receipt` accepts either.
    log(DIGEST_HEADER);
    for (const line of verdictDigestLines(ev)) log(line);
    log(DIAGNOSTIC_SEPARATOR);
    for (const line of diagnosticLines(ev)) log(line);
    for (const line of runFacts) log(line);
    if (ev.failures.length > 0) {
        log("\n✗ check:ui FAILED");
        for (const f of ev.failures) log(`  · ${f}`);
        return 1;
    }
    log(`\n✓ check:ui passed${passed}`);
    return 0;
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
        `the app server never answered on ${url} within ${Math.round(timeoutMs / 1000)}s`
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

/** How the app is served to the browser (issue #4687, `--serve=`). */
type ServeMode = "dev" | "build";

/** The default is the mode the phase timings picked (a full lane in 480s
 *  against 1130s on the dev server, same tree, same load): see
 *  `docs/agents/quality-gates.md` § Affordability. */
const DEFAULT_SERVE: ServeMode = "build";

interface AppServer {
    child: ChildProcess;
    /** The diagnostic block's line for how the app was served. */
    line: string;
    /** Remove what the server left on disk (the built bundle's outDir). */
    dispose(): void;
}

function ensureCatalogue(): void {
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
}

function spawnVite(args: string[]): ChildProcess {
    const child = spawn("bunx", ["vite", ...args], {
        cwd: REPO_ROOT,
        stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", () => {});
    child.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        if (/error/i.test(text)) process.stderr.write(`[vite] ${text}`);
    });
    return child;
}

/**
 * Serve the app on `port`, either from Vite's dev server (every navigation
 * re-requests the unbundled module graph, transformed on demand) or from a
 * bundle built once and served statically by `vite preview` (issue #4687).
 * The build costs its own wall time once (~12s), printed on the served line
 * so the trade is visible in every receipt.
 *
 * THE BUNDLE IS A DEVELOPMENT-MODE BUILD, not a production one: `NODE_ENV`
 * and `--mode` both `development`, so `import.meta.env.DEV` is true and React
 * is its development build. The lane must measure the SAME app the dev server
 * serves — `game-debug-sheet-ai` walks a seam installed only under
 * `import.meta.env.DEV` (`src/lib/ai/dev-trace-seam.ts`), and the Infra
 * Verdict reads React's development warnings off the console. A production
 * build dropped both (measured: the surface UNWALKED, 65/68). `--mode` alone
 * is not enough: Vite pins `NODE_ENV=production` for `build` unless the
 * environment already set it, and the seam was dead-code-eliminated.
 */
async function startAppServer(
    mode: ServeMode,
    port: number
): Promise<AppServer> {
    ensureCatalogue();
    const listen = [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
    ];
    if (mode === "dev") {
        return {
            child: spawnVite([...listen, "--clearScreen", "false"]),
            line: "served: vite dev server (--serve=dev)",
            dispose: () => {},
        };
    }
    const outDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tolaria-ui-gate-dist-")
    );
    const t0 = Date.now();
    const built = spawnSync(
        "bunx",
        [
            "vite",
            "build",
            "--mode",
            "development",
            "--outDir",
            outDir,
            "--emptyOutDir",
            "--logLevel",
            "error",
        ],
        {
            cwd: REPO_ROOT,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            env: { ...process.env, NODE_ENV: "development" },
        }
    );
    if (built.status !== 0) {
        fs.rmSync(outDir, { recursive: true, force: true });
        throw new FatalError(
            `vite build failed — ${(built.stderr || built.stdout || "").trim().slice(0, 600)}`
        );
    }
    const buildSecs = Math.round((Date.now() - t0) / 1000);
    return {
        child: spawnVite(["preview", "--outDir", outDir, ...listen]),
        line: `served: development-mode bundle via vite preview (--serve=build; vite build took ${buildSecs}s)`,
        dispose: () => fs.rmSync(outDir, { recursive: true, force: true }),
    };
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

// `ProbeCounts`/`ProbeResult`/`AxeCount`/`readingsOf` live in `floors.ts`
// (issue #2658) so the probe → Readings mapping is unit-testable without a
// browser — see `readingsOf`'s doc comment there.

/**
 * THE ONE AXE EXEMPTION, AND IT IS AN ATTRIBUTE, NOT A NUMBER (issue #2593).
 *
 * The Floor is `axeSerious`/`axeCritical` 0 on every walked surface. One
 * surface cannot honour it as written: `/admin/design-system` is the reference
 * page, and part of what it documents is what a FAILING token looks like — the
 * retired `#6f6244` disabled label beside its replacement, the retired
 * danger-as-text hex beside `danger-strong`, the board's raw counter fills
 * whose own Specimen note reads "white text ≤3:1". Deleting those deletes the
 * comparison; a per-surface exception to the count instead makes the surface's
 * Floor a standing lie that a REAL regression could then hide behind.
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

/** `axe-core` in the page. Shared with the Named Assertions' `contrast` check
 *  (`assertions.ts`), which runs the same library over one subtree. */
async function injectAxe(page: Page): Promise<void> {
    // Once per document: `runAxe` has already injected it for this cell, and
    // ~600KB of script tag per contrast promise per viewport is pure waste.
    // A navigation drops `window.axe`, which is exactly when it is re-added.
    const present = await page
        .evaluate("typeof window.axe !== 'undefined'")
        .catch(() => false);
    if (present === true) return;
    await page.addScriptTag({ path: AXE_PATH });
}

async function runAxe(page: Page): Promise<AxeCount> {
    await injectAxe(page);
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
                    // Kept for the operator, not for the Floor: a red line
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
    /** Skip the lane account's teardown and print its credentials. */
    keepUser: boolean;
    /** Print the diff's scope and exit, before any browser or deployment. */
    scopeOnly: boolean;
    /** Force the full scope whatever the diff. */
    all: boolean;
    /** `--parallel=N`: walk N viewports at once instead of the count the
     *  machine's cores and memory size (issue #3653, re-sized in #4687). */
    parallel: number | null;
    /** The ref the diff is taken against; the configured base branch unless
     *  `--base=` names another (same flag as `check:lane`). */
    base: string;
    /** `--serve=dev|build`: the dev server or a production build (issue #4687). */
    serve: ServeMode;
}

function parseArgs(argv: string[]): Options {
    const opts: Options = {
        surfaces: null,
        headed: false,
        keepUser: false,
        scopeOnly: false,
        all: false,
        parallel: null,
        base: ORIGIN_BASE,
        serve: DEFAULT_SERVE,
    };
    for (const arg of argv) {
        // `--record` and `--accept=` died with the budget file (ADR 0132): a
        // Floor has no number to record, so they fall through to `unknown flag`.
        if (arg === "--headed") opts.headed = true;
        else if (arg === "--keep-user") opts.keepUser = true;
        else if (arg === "--scope-only") opts.scopeOnly = true;
        else if (arg === "--all") opts.all = true;
        else if (arg.startsWith("--base=")) {
            opts.base = arg.slice("--base=".length);
        } else if (arg.startsWith("--serve=")) {
            const mode = arg.slice("--serve=".length);
            if (mode !== "dev" && mode !== "build") {
                throw new FatalError(
                    `--serve=${mode} is not a serve mode: it takes dev or build`
                );
            }
            opts.serve = mode;
        } else if (arg.startsWith("--parallel=")) {
            try {
                opts.parallel = parseParallelOverride(
                    arg.slice("--parallel=".length)
                );
            } catch (err) {
                throw new FatalError((err as Error).message);
            }
        } else if (arg.startsWith("--surface=")) {
            opts.surfaces = arg
                .slice("--surface=".length)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        } else if (arg.startsWith("--")) {
            throw new FatalError(`unknown flag ${arg}`);
        }
    }
    return opts;
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
    // Re-sampled once the lane lock is held (below): after a queue wait the
    // load this run met is not the load it was launched into.
    let loadAtStart = loadAverage();
    const scope = computeRunScope(opts);
    log(renderUiScope(scope, opts.base));
    if (opts.scopeOnly) return 0;

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
    const unwalkedIds = new Set(UNWALKED_SURFACES.map((u) => u.surface));
    const walkable = selected.filter((s) => !unwalkedIds.has(s.id));

    if (walkable.length === 0) {
        // Nothing to walk — an empty scope, or one made only of declared
        // unwalked surfaces — owes no browser time: the receipt says so.
        return printReceipt(
            evaluate(knownIds, [], diffScope),
            [machineLoadLine(loadAtStart, loadAverage())],
            " — nothing to walk"
        );
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

    // One browser run at a time on this machine (issue #4687): concurrent runs
    // share one Convex backend, and contention there reads as UI failures. Taken
    // only now, so `--scope-only` and an empty scope never queue; released by
    // the hold's own exit / signal handlers on every path out.
    await acquireUiLane({
        root: gateLockRoot(),
        label: `check:ui ${process.argv.slice(2).join(" ")}`.trim(),
        announce: log,
    });
    loadAtStart = loadAverage();

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;

    // How many viewports at once (issue #3653), sized ONCE from the machine's
    // cores and memory — never from the load, which on a shared machine is the
    // neighbours' (issue #4687): the lane just acquired the one browser slot.
    const ncpu = os.cpus().length;
    const totalMem = os.totalmem();
    const parallel = opts.parallel ?? viewportParallelism(ncpu, totalMem);
    const parallelLine =
        `viewport parallelism: ${parallel} of ${VIEWPORTS.length} at a time, ` +
        `${parallel} lane account(s) — ` +
        (opts.parallel === null
            ? `sized from ${ncpu} cpus and ${(totalMem / 1024 ** 3).toFixed(0)} GiB (load ${loadAtStart.toFixed(1)} not consulted)`
            : `--parallel=${opts.parallel}`);
    log(`ui-gate: ${parallelLine}`);

    // The run's own accounts (issue #3626, one per lane since issue #3653).
    // Teardown runs from `withLaneFleet`'s `finally` on every normal exit and
    // from the signal handler on SIGINT / SIGTERM, which never reach a
    // `finally`.
    const fleet = createLaneFleet({
        accounts: Array.from({ length: parallel }, () => newLaneAccount()),
        run: localConvexRunner(),
        signUp: passwordSignUp(convexUrl),
        seedDeck: passwordSeedDeck(convexUrl),
        keepUser: opts.keepUser,
        log,
    });
    // The RUN's id, not an account's: the screenshots outlive every account the
    // run owned, and there are `parallel` of those.
    const shotDir = runScreenshotDir(SHOT_ROOT, newRunId());

    // Not `let server: AppServer | null = null`: it is assigned inside the
    // `withLaneAccount` callback, and an annotated `null` initialiser narrows
    // the outer `finally`'s read to `never`.
    let server = null as AppServer | null;
    let browser: Browser | null = null;
    const startedAt = Date.now();
    const uninstallSignals = installSignalTeardown(
        process,
        () => {
            fleet.teardown();
            server?.child.kill("SIGTERM");
            server?.dispose();
        },
        (code) => process.exit(code)
    );

    try {
        return await withLaneFleet(fleet, async () => {
            try {
                log(`ui-gate: serving the app (${opts.serve}) on ${baseUrl}`);
                server = await startAppServer(opts.serve, port);
                log(`ui-gate: ${server.line}`);
                await waitForServer(baseUrl, 90_000);

                // Const-bound for the viewport walks: the outer `browser` is a
                // `let` the `finally` closes, and a closure that read it would
                // see `Browser | null`.
                const openBrowser = await launchBrowser(opts.headed);
                browser = openBrowser;

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

                /**
                 * One viewport, in its own browser context, signed in as its
                 * LANE's own account (issue #3653).
                 *
                 * Everything it finds is returned rather than written into
                 * shared state as it goes: `collectRun` is the only place the
                 * viewports meet, and it meets them in the fixed matrix order.
                 * That is what makes the verdict block independent of how many
                 * of these ran at once — and it is why the cell lines are
                 * buffered here instead of logged, which under parallelism
                 * would interleave five viewports into one unreadable column.
                 */
                const walkViewport = async (
                    viewport: Viewport,
                    member: LaneMember
                ): Promise<ViewportResult> => {
                    const ctx: WalkContext = {
                        baseUrl,
                        stressScenarioLabel: STRESS_SCENARIO_LABEL,
                        yieldsScenarioLabel: YIELDS_SCENARIO_LABEL,
                        aiTraceScenarioLabel: AI_TRACE_SCENARIO_LABEL,
                        boardScenarioLabel: BOARD_SCENARIO_LABEL,
                        combatScenarioLabel: COMBAT_SCENARIO_LABEL,
                        choiceScenarioLabel: CHOICE_SCENARIO_LABEL,
                        fixtureLabels: member.labels,
                        laneDeckId: member.deckId,
                        createdGame: false,
                        // Buffered with the cells (never logged live: five
                        // viewports would interleave); diagnostic, unread by
                        // `land`.
                        log: (message) => lines.push(`    · ${message}`),
                    };
                    const lines: string[] = [];
                    const measurements: {
                        surface: string;
                        readings: Readings;
                        asserts?: readonly AssertResult[];
                    }[] = [];
                    /**
                     * Surfaces THIS viewport could not reach. It used to be
                     * one map for the whole run, which let a surface that
                     * failed at the first viewport skip the other four — and
                     * that is exactly what cannot survive parallelism: which
                     * viewport fails FIRST is a function of the machine, so the
                     * reason printed on the surface's UNWALKED row would differ
                     * between an N=1 and an N=5 run of one tree, and `land`
                     * byte-compares that row.
                     *
                     * The price, paid only on the failure path, is that a
                     * broadly broken surface now spends its INFRA retry budget
                     * once per viewport instead of once per run (issue #3653
                     * review). A red run gets slower; a green one does not, and
                     * the verdict is identical either way.
                     */
                    const unreachable = new Map<string, string>();
                    /** Cells that stood as an Infra Verdict (issue #3644). */
                    const infra: { surface: string; cell: InfraCell }[] = [];
                    const consoleErrors: string[] = [];
                    /** Every walk on which the SHELL RETURN BAND was mounted, and how many
                     *  controls `probe.js` culled for it (issue #3337). Reported in the
                     *  diagnostic block, which `land` never reads, so a new line here can
                     *  never invalidate a pasted receipt. */
                    const bandWalks: { where: string; excluded: number }[] = [];
                    /** Every cell's phase timings (issue #4687), diagnostic. */
                    const timings: CellTiming[] = [];

                    const context: BrowserContext =
                        await openBrowser.newContext({
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
                        surface: Surface,
                        t: PhaseTimings
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
                                await timed(t, "walk", () =>
                                    surface.walk(page, ctx)
                                );
                                await timed(t, "settle", () =>
                                    waitForSettledScreen(page, {
                                        targets: surface.settleTargets,
                                    })
                                );
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
                                    lines.push(`${cell} UNWALKED — ${reason}`);
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
                                        lines.push(
                                            `${cell} UNWALKED — ${quiet}`
                                        );
                                        return false;
                                    }
                                    infra.push({
                                        surface: surface.id,
                                        cell: {
                                            viewport: viewport.id,
                                            signature: failure.signature,
                                            load: failedAt,
                                            reason: firstLine,
                                        },
                                    });
                                    lines.push(
                                        `${cell} INFRA — ${said} after ${attempts} attempt(s): ${firstLine}`
                                    );
                                    return false;
                                }

                                lines.push(
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
                                        lines.push(
                                            `${cell} CLEANUP FAILED before the retry — ${(e as Error).message.split("\n")[0]}`
                                        );
                                    }
                                }
                                if (surface.needsGame) {
                                    await recreateLaneGame(page, ctx).catch(
                                        (e) =>
                                            lines.push(
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
                     * probed, screenshotted or held to the Floors.
                     */
                    const measure = async (surface: Surface): Promise<void> => {
                        const t = emptyTimings();
                        timings.push({
                            surface: surface.id,
                            viewport: viewport.id,
                            ms: t,
                        });
                        let walked = await walkToSettled(surface, t);
                        /** The measured cell's line body and its failed
                         *  assertions, written after the cleanup (below). */
                        let cellDetail: string | null = null;
                        let assertLines: string[] = [];

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
                                const probe = await timed(t, "probe", () =>
                                    runProbe(page)
                                );
                                const axe = await timed(t, "axe", () =>
                                    runAxe(page)
                                );
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
                                    lines.push(
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
                            const readings = readingsOf(probe, axe);
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
                            await timed(t, "screenshot", () =>
                                page.screenshot({ path: shot })
                            );

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

                            // AFTER the probe, axe and the screenshot, never
                            // before: a `reachable` check scrolls its element
                            // into view, and the measurement above has to be
                            // taken on the screen as the walk found it.
                            const asserts = await timed(t, "assertions", () =>
                                evaluateAssertions(
                                    page,
                                    surface.asserts ?? [],
                                    {
                                        viewport: {
                                            width: viewport.width,
                                            height: viewport.height,
                                        },
                                        ensureAxe: () => injectAxe(page),
                                    }
                                )
                            );
                            // The cell line carries its phase timings (issue
                            // #4687), so it is written only after the cleanup
                            // below has run — the last phase it accounts for.
                            cellDetail = detail;
                            assertLines = asserts
                                .filter((r) => !r.ok)
                                .map(
                                    (a) =>
                                        `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} ASSERT FAIL ${a.label} — ${a.detail}`
                                );

                            measurements.push({
                                surface: surface.id,
                                readings,
                                asserts,
                            });
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
                        let cleanupLine: string | null = null;
                        if (surface.cleanup) {
                            try {
                                await timed(t, "cleanup", () =>
                                    surface.cleanup!(page, ctx)
                                );
                            } catch (err) {
                                cleanupLine = `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} CLEANUP FAILED — ${(err as Error).message.split("\n")[0]}`;
                            }
                        }
                        // Same order as before the timings: the cell, its
                        // failed assertions, then the cleanup's failure.
                        if (cellDetail !== null) {
                            lines.push(
                                `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} ${cellDetail}${cellTimingSuffix(t)}`
                            );
                            lines.push(...assertLines);
                        }
                        if (cleanupLine !== null) lines.push(cleanupLine);
                    };

                    // Signed-out surfaces FIRST: `<AuthGate>` makes them unreachable
                    // once a session exists, and `ensureSignedIn` navigates back to
                    // the app root itself, so this costs the signed-in walks nothing.
                    for (const surface of walkable.filter((s) => s.preAuth)) {
                        await measure(surface);
                    }

                    await ensureSignedIn(
                        page,
                        baseUrl,
                        member.account.email,
                        member.account.password
                    );
                    lines.push(
                        `ui-gate: ${viewport.id} (${viewport.label}) — signed in`
                    );

                    for (const surface of walkable.filter((s) => !s.preAuth)) {
                        await measure(surface);
                    }

                    await context.close();
                    return {
                        viewport: viewport.id,
                        lines,
                        measured: measurements,
                        unreachable: [...unreachable].map(
                            ([surface, reason]) => ({ surface, reason })
                        ),
                        infra,
                        consoleErrors,
                        bandWalks,
                        timings,
                    };
                };

                // One account per LANE, one context per viewport. The account
                // is keyed off the lane and not the viewport because the gate
                // it exists to dodge — one game per account — is held for as
                // long as a walk is playing, and a lane is the only thing that
                // is provably not walking two viewports at once.
                const results = await runPool(
                    VIEWPORTS,
                    parallel,
                    async (viewport, _index, lane) => {
                        const walked = await walkViewport(
                            viewport,
                            fleet.members[lane]
                        );
                        // The only live progress a parallel run can honestly
                        // give: its cells are printed in matrix order below.
                        log(
                            `ui-gate: ${viewport.id} (${viewport.label}) — walked`
                        );
                        return walked;
                    }
                );
                const collected = collectRun({
                    knownSurfaceIds: knownIds,
                    viewportIds: VIEWPORT_IDS,
                    results,
                });
                for (const line of collected.lines) log(line);

                // The shell return band's attribution (issue #3337). `probe.js` culls
                // it out of every control count because its presence is a function of
                // the gate ACCOUNT's state — a game or Limited event in flight — and
                // not of the tree; the point of the line is that the exclusion is
                // never silent, so it prints on both branches.
                const { bandWalks, consoleErrors } = collected;
                const excluded = bandWalks.reduce((n, w) => n + w.excluded, 0);
                const bandLine =
                    bandWalks.length === 0
                        ? "shell return band: absent on every walk — no controls excluded"
                        : `shell return band: MOUNTED on ${bandWalks.length} walk(s) — ${excluded} control(s) excluded from those counts (the run's lane account has a game or event in flight; issue #3337)`;
                const wallMs = Date.now() - startedAt;
                return printReceipt(
                    evaluate(knownIds, collected.walks, diffScope),
                    [
                        machineLoadLine(loadAtStart, loadAverage()),
                        parallelLine,
                        server.line,
                        bandLine,
                        `console errors: ${consoleErrors.length === 0 ? "none" : consoleErrors.length}`,
                        ...consoleErrors
                            .slice(0, 10)
                            .map((line) => `  ${line}`),
                        `screenshots: ${path.relative(REPO_ROOT, shotDir)}/`,
                        ...phaseSummaryLines(collected.timings, wallMs),
                        `wall time: ${Math.round(wallMs / 1000)}s`,
                    ],
                    ""
                );
            } finally {
                // Closed BEFORE the account is torn down, so no page is still
                // subscribed to rows the teardown is deleting.
                if (browser) await browser.close().catch(() => {});
            }
        });
    } finally {
        if (server) {
            server.child.kill("SIGTERM");
            server.dispose();
        }
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
