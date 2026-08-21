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
 *   3. signs in once with the dev account and reuses the storage state;
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
 * NOT PART OF `check:all`. The full gate is offline by contract and already
 * mutex-held; booting a browser inside it would tax every session that never
 * touches the DOM. This is a standalone command a UI diff runs, and its output
 * is the receipt that goes in the PR.
 *
 * Usage:
 *   bun run check:ui
 *   bun run check:ui -- --surface=lobby,deck-builder     # subset, same rules
 *   bun run check:ui -- --record                         # rewrite budgets.json
 *                                                        # from this run (review it!)
 *
 * Env:
 *   TOLARIA_UI_EMAIL / TOLARIA_UI_PASSWORD   dev-account credentials. Read
 *       from the environment, else from the gitignored `.env.local`. Never
 *       committed, never printed.
 *   VITE_CONVEX_URL                          the deployment to talk to.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import {
    coverageLine,
    evaluateRun,
    metricsOf,
    type AxeCount,
    type BudgetFile,
    type Measurement,
    type ProbeResult,
    type SurfaceWalk,
    type ViewportBudget,
} from "./budgets.ts";
import {
    SURFACES,
    SURFACE_IDS,
    Unreachable,
    type WalkContext,
} from "./surfaces.ts";
import { VIEWPORTS } from "./viewports.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const BUDGETS_PATH = path.join(HERE, "budgets.json");
const PROBE_PATH = path.join(HERE, "probe.js");
const AXE_PATH = path.join(REPO_ROOT, "node_modules", "axe-core", "axe.min.js");
const SHOT_DIR = path.join(REPO_ROOT, ".claude", "telemetry", "ui-gate");

const STRESS_SCENARIO_LABEL = "UI stress — full board, full hand, deep piles";

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
                `sign-in failed for the dev account${banner ? ` — ${banner.trim()}` : ""}. ` +
                    `Set TOLARIA_UI_EMAIL / TOLARIA_UI_PASSWORD (environment or .env.local).`
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
}

function parseArgs(argv: string[]): Options {
    const opts: Options = { surfaces: null, headed: false, record: false };
    for (const arg of argv) {
        if (arg === "--headed") opts.headed = true;
        else if (arg === "--record") opts.record = true;
        else if (arg.startsWith("--surface=")) {
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

function loadBudgets(): BudgetFile {
    if (!fs.existsSync(BUDGETS_PATH)) {
        throw new FatalError(`budget file missing: ${BUDGETS_PATH}`);
    }
    return JSON.parse(fs.readFileSync(BUDGETS_PATH, "utf8")) as BudgetFile;
}

/** `--record`: fold this run's measurements back into the budget file,
 *  preserving every `knownDebt` note and every declared-unwalked row. Written
 *  for review, never as an auto-heal — the whole point of a budget is that a
 *  human agreed to the number. */
function recordBudgets(budgets: BudgetFile, walks: SurfaceWalk[]): void {
    for (const walk of walks) {
        if (walk.status !== "measured") continue;
        const existing = budgets.surfaces[walk.surface];
        if (existing && existing.status === "unwalked") continue;
        const surface = SURFACES.find((s) => s.id === walk.surface);
        const viewports: Record<string, ViewportBudget> = {};
        for (const m of walk.measurements) {
            const prior = existing?.viewports?.[m.viewport];
            viewports[m.viewport] = {
                ...m.metrics,
                ...(prior?.knownDebt ? { knownDebt: prior.knownDebt } : {}),
            };
        }
        budgets.surfaces[walk.surface] = {
            label: existing?.label ?? surface?.label ?? walk.surface,
            status: "budgeted",
            viewports,
        };
    }
    budgets.recordedOn = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(BUDGETS_PATH, `${JSON.stringify(budgets, null, 4)}\n`);
    log(
        `\nwrote measured values to ${path.relative(REPO_ROOT, BUDGETS_PATH)} — review before committing`
    );
}

async function main(): Promise<number> {
    const opts = parseArgs(process.argv.slice(2));
    const budgets = loadBudgets();

    const selected = opts.surfaces
        ? SURFACES.filter((s) => opts.surfaces!.includes(s.id))
        : SURFACES;
    if (selected.length === 0) {
        throw new FatalError(
            `--surface matched nothing. Known surfaces: ${SURFACE_IDS.join(", ")}`
        );
    }
    const knownIds = selected.map((s) => s.id);

    const env = { ...readEnvLocal(), ...process.env } as Record<string, string>;
    const email = env.TOLARIA_UI_EMAIL;
    const password = env.TOLARIA_UI_PASSWORD;
    if (!email || !password) {
        throw new FatalError(
            "TOLARIA_UI_EMAIL / TOLARIA_UI_PASSWORD are unset. Put the dev-account " +
                "credentials in the environment or in the gitignored .env.local " +
                "(they are deliberately not in the repo)."
        );
    }
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
    fs.mkdirSync(SHOT_DIR, { recursive: true });

    let vite: ChildProcess | null = null;
    let browser: Browser | null = null;
    const startedAt = Date.now();

    try {
        log(`ui-gate: starting vite on ${baseUrl}`);
        vite = await startViteServer(port);
        await waitForServer(baseUrl, 90_000);

        browser = await launchBrowser(opts.headed);

        const ctx: WalkContext = {
            baseUrl,
            stressScenarioLabel: STRESS_SCENARIO_LABEL,
            createdGame: false,
            log: () => {},
        };

        const perSurface = new Map<string, Measurement[]>();
        const unreachable = new Map<string, string>();
        const consoleErrors: string[] = [];

        for (const viewport of VIEWPORTS) {
            const context: BrowserContext = await browser.newContext({
                viewport: { width: viewport.width, height: viewport.height },
                deviceScaleFactor: viewport.dpr,
                isMobile: viewport.mobile,
                hasTouch: viewport.mobile,
            });
            const page = await context.newPage();
            page.on("console", (msg) => {
                if (msg.type() === "error") {
                    consoleErrors.push(
                        `${viewport.id}: ${msg.text().slice(0, 160)}`
                    );
                }
            });
            await ensureSignedIn(page, baseUrl, email, password);
            log(`ui-gate: ${viewport.id} (${viewport.label}) — signed in`);

            for (const surface of selected) {
                const budget = budgets.surfaces[surface.id];
                if (budget?.status === "unwalked") continue;
                if (unreachable.has(surface.id)) continue;

                try {
                    await surface.walk(page, ctx);
                } catch (err) {
                    const reason =
                        err instanceof Unreachable
                            ? err.message
                            : `walk threw: ${(err as Error).message.split("\n")[0]}`;
                    unreachable.set(surface.id, reason);
                    log(
                        `  ${surface.id.padEnd(20)} ${viewport.id.padEnd(12)} UNWALKED — ${reason}`
                    );
                    continue;
                }

                const probe = await runProbe(page);
                const axe = await runAxe(page);
                const metrics = metricsOf(probe, axe);
                const shot = path.join(
                    SHOT_DIR,
                    `${surface.id}__${viewport.id}.png`
                );
                await page.screenshot({ path: shot });

                const detail =
                    `cards n${probe.cards.n} zero${probe.cards.zero} occ${probe.cards.occ} ` +
                    `stranded${probe.cards.stranded} reach${probe.cards.reachable} | ` +
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

            await context.close();
        }

        const walks: SurfaceWalk[] = [];
        for (const id of knownIds) {
            const reason = unreachable.get(id);
            if (reason) {
                walks.push({ surface: id, status: "unreachable", reason });
            } else if (perSurface.has(id)) {
                walks.push({
                    surface: id,
                    status: "measured",
                    measurements: perSurface.get(id)!,
                });
            }
        }

        if (opts.record) recordBudgets(budgets, walks);

        const ev = evaluateRun(budgets, knownIds, walks, SURFACE_IDS);

        log(
            "\n─── check:ui ───────────────────────────────────────────────────"
        );
        for (const row of ev.rows) {
            log(
                `${row.verdict.padEnd(8)} ${row.surface.padEnd(20)} ${(row.viewport ?? "—").padEnd(12)} ${row.detail}`
            );
        }
        log(coverageLine(ev));
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
        log(`screenshots: ${path.relative(REPO_ROOT, SHOT_DIR)}/`);
        log(`wall time: ${Math.round((Date.now() - startedAt) / 1000)}s`);

        if (ev.failures.length > 0) {
            log("\n✗ check:ui FAILED");
            for (const f of ev.failures) log(`  · ${f}`);
            return 1;
        }
        log("\n✓ check:ui passed");
        return 0;
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (vite) vite.kill("SIGTERM");
    }
}

try {
    process.exit(await main());
} catch (err) {
    if (err instanceof FatalError) {
        process.stderr.write(`\n✗ check:ui: ${err.message}\n`);
        process.exit(2);
    }
    throw err;
}
