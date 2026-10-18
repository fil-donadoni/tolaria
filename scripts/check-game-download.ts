#!/usr/bin/env bun
/**
 * `bun run check:game-download` — a game's card-data download is bounded by
 * its own cards, measured in a real browser on a PRODUCTION build (issue
 * #5618, PRD #5602).
 *
 * `check:bundle` proves the built asset graph holds no static path to card
 * data; this proves what a game actually FETCHES. For each of two games —
 * Solo, and against the Bot (whose worker installs its own Manifest, issue
 * #5617) — it signs a fresh lane account in, walks the Setup flow to Start
 * match and the board in a cold browser context, and records every card-data
 * asset the page and the worker fetched (Set chunks, compiled shards, the
 * compiled index, the dictionary: `scripts/lib/game-download.ts`). The budget
 * is the gzip bytes of what the game's own Definition Manifests name, read
 * from the deployment once the board is up — never a number derived from
 * the catalogue. Over it, or no card data at all (the check went vacuous),
 * is a red.
 *
 * Proof of failure (issue #5618): `catalogue: "game"` → `"whole"` on the
 * game route (`src/router.tsx`) makes both games fetch every Set and every
 * shard, and reds both lines.
 *
 * Needs the local deployment (`bun run convex:ensure`) and Chromium; takes
 * the machine's one browser lane (`acquireUiLane`), like `check:ui`, because
 * both drive the same backend. Tier: health (`HEALTH_ONLY_GUARDS` in
 * `lib/health-step.ts`, with its measured cost) — a production `vite build`
 * and two games are far past the lane's 10 s.
 *
 * Exit (`check:ui`'s contract, read by `walkRunVerdict`): 0 green; 1 the
 * TREE failed — over budget, or a build, a board or a Manifest the tree
 * broke; 2 the environment kept the run from measuring (sign-up, sign-in,
 * preview, browser, an unseeded deployment); 3 `DEPLOYMENT_DOWN_EXIT`.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { createServer } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, Page } from "playwright";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import {
    DEPLOYMENT_DOWN_EXIT,
    reachable,
    readEnvLocal,
} from "./lib/convex-reachable";
import { acquireUiLane, gateLockRoot } from "./lib/ui-admission";
import { BRAIN_WORKER_CHUNK_PREFIX } from "./lib/asset-graph";
import {
    cardDataKind,
    cardDataSizes,
    catalogueGzipBytes,
    handWrittenSetCodes,
    judgeGameDownload,
    manifestBudget,
    type GameDownloadReport,
    type ManifestEntry,
} from "./lib/game-download";
import {
    installSignalTeardown,
    localConvexRunner,
    newLaneAccount,
    passwordSignUp,
    type LaneAccount,
} from "./ui-gate/lane-account";
import {
    MATCH_SETUP_KEY,
    MULLIGAN_KEEP,
    PREGAME_PLAY,
    START_MATCH,
    chooseSetup,
    currentSetupStep,
    pickPlayableDeck,
} from "./ui-gate/surfaces";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STEP_TIMEOUT = 8_000;
const BOARD_TIMEOUT = 60_000;
/** Card data still arriving this late after the board is up (the Bot
 *  worker installs its Manifest after the page) is still the game's; the
 *  run waits for this much quiet before it reads the total. */
const QUIET_MS = 5_000;
/** Card data still arriving this long after the board is a download that
 *  never settles — the tree's fault, never waited out. */
const SETTLE_DEADLINE_MS = 60_000;

type GameKind = "solo" | "bot";

/** The environment kept the run from measuring: exit 2, INFRA. */
class FatalError extends Error {}
class DeploymentDownError extends FatalError {}
/** The tree broke what the run measures — a build, a board, a Manifest:
 *  exit 1, RED, like a game over budget. */
class TreeFailure extends Error {}

function log(line: string): void {
    console.log(`[check:game-download] ${line}`);
}

async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.unref();
        srv.on("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            srv.close(() =>
                typeof addr === "object" && addr
                    ? resolve(addr.port)
                    : reject(new Error("no port"))
            );
        });
    });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            if ((await fetch(url)).ok) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 300));
    }
    throw new FatalError(`vite preview did not answer at ${url}`);
}

/** A PRODUCTION build — what a player downloads — into its own directory, so
 *  a concurrent `check:bundle` or `check:ui` never sees it. */
function buildProduction(outDir: string): number {
    const ensured = spawnSync(
        "node",
        [path.join("scripts", "ensure-full-catalogue.mjs")],
        { cwd: ROOT, encoding: "utf8" }
    );
    if (ensured.status !== 0) {
        throw new FatalError(
            `catalogue:ensure failed — ${(ensured.stderr || ensured.stdout || "").trim().slice(0, 400)}`
        );
    }
    const t0 = Date.now();
    const env = { ...process.env };
    delete env.NODE_ENV;
    const built = spawnSync(
        "bunx",
        [
            "vite",
            "build",
            "--outDir",
            outDir,
            "--emptyOutDir",
            "--logLevel",
            "error",
        ],
        { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env }
    );
    if (built.status !== 0) {
        throw new TreeFailure(
            `vite build failed — ${(built.stderr || built.stdout || "").trim().slice(0, 600)}`
        );
    }
    return Math.round((Date.now() - t0) / 1000);
}

function servePreview(outDir: string, port: number): ChildProcess {
    return spawn(
        "bunx",
        [
            "vite",
            "preview",
            "--outDir",
            outDir,
            "--host",
            "127.0.0.1",
            "--port",
            String(port),
            "--strictPort",
        ],
        // Its own process group: `bunx` forks the vite server, and a kill
        // of the group reaches both (`stopPreview`).
        { cwd: ROOT, stdio: "ignore", detached: true }
    );
}

function stopPreview(preview: ChildProcess | null): void {
    if (preview?.pid === undefined) return;
    try {
        process.kill(-preview.pid, "SIGTERM");
    } catch {
        // already gone
    }
}

async function signIn(
    page: Page,
    baseUrl: string,
    account: LaneAccount
): Promise<void> {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    const email = page.locator("input[type=email]").first();
    await email.waitFor({ state: "visible", timeout: 30_000 });
    await email.fill(account.email);
    await page.locator("input[type=password]").first().fill(account.password);
    await page.locator("button[type=submit]").first().click();
    await page
        .locator("input[type=email]")
        .first()
        .waitFor({ state: "detached", timeout: 30_000 })
        .catch(() => {
            throw new FatalError(`sign-in failed for ${account.email}`);
        });
}

/** Click `selector` once it shows within `timeoutMs`; `false` if it never
 *  does. */
async function clickIfVisible(
    page: Page,
    selector: string,
    timeoutMs: number
): Promise<boolean> {
    const target = page.locator(selector).first();
    const shown = await target
        .waitFor({ state: "visible", timeout: timeoutMs })
        .then(() => true)
        .catch(() => false);
    // A pregame button re-renders disabled while its answer is in flight, and
    // detaches once the next seat's prompt replaces it: a click that loses
    // that race has still answered.
    if (shown) await target.click({ timeout: STEP_TIMEOUT }).catch(() => {});
    return shown;
}

/** Arena → Solo | Bot → Freeform → a preset deck → (the Bot's deck stays
 *  on its default) → Start match → the board. */
async function startGame(
    page: Page,
    baseUrl: string,
    kind: GameKind
): Promise<void> {
    await page.goto(`${baseUrl}/play/constructed`);
    await page.evaluate((key) => localStorage.removeItem(key), MATCH_SETUP_KEY);
    await page.goto(`${baseUrl}/play/constructed`);
    await page
        .locator("h1:has-text('Constructed')")
        .waitFor({ state: "visible", timeout: 20_000 });
    for (let i = 0; i < 8; i++) {
        const step = await currentSetupStep(page);
        if (step === "mode") await chooseSetup(page, "Arena");
        else if (step === "opponent")
            await chooseSetup(page, kind === "bot" ? "Bot" : "Solo");
        else if (step === "format") await chooseSetup(page, "Freeform");
        else if (step === "myDeck") await pickPlayableDeck(page);
        else break;
    }
    await page
        .locator(START_MATCH)
        .first()
        .click({ timeout: STEP_TIMEOUT })
        .catch(() => {
            throw new FatalError(
                `${kind}: the Setup flow left Start match disabled — is the deployment seeded with preset decks?`
            );
        });
    await page.waitForURL(/\/game/, { timeout: 20_000 });
    // The coin toss, then one mulligan per seat the account holds (both, in
    // Solo); the board renders only once the Manifest's shards are resident
    // (`DefinitionManifestGate`).
    await clickIfVisible(page, PREGAME_PLAY, BOARD_TIMEOUT);
    for (let seat = 0; seat < 2; seat++) {
        if (!(await clickIfVisible(page, MULLIGAN_KEEP, STEP_TIMEOUT))) break;
    }
    await page
        .locator("text=/Pass|YOUR GO|Untap|Upkeep|Library/i")
        .first()
        .waitFor({ state: "visible", timeout: BOARD_TIMEOUT })
        .catch(() => {
            throw new TreeFailure(
                `${kind}: reached /game but no board rendered within ${BOARD_TIMEOUT / 1000}s`
            );
        });
}

/** The user id a session token was issued to: `sub` = `<userId>|<session>`
 *  (`@convex-dev/auth`). */
function userIdOf(token: string): string {
    const payload = JSON.parse(
        Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")
    ) as { sub?: string };
    const id = payload.sub?.split("|")[0];
    if (!id) throw new FatalError("the session token names no user");
    return id;
}

/** Both seats' Definition Manifests — Solo and vs-Bot games seat the one
 *  user twice (`<userId>-p1`, `<userId>-p2`). */
async function readManifests(
    convexUrl: string,
    token: string
): Promise<ManifestEntry[]> {
    const client = new ConvexHttpClient(convexUrl);
    client.setAuth(token);
    const active = (await client.query(anyApi.gameReads.myActiveGame, {})) as {
        gameId: string;
    } | null;
    if (!active) {
        throw new TreeFailure("Start match created no active game");
    }
    const userId = userIdOf(token);
    const entries: ManifestEntry[] = [];
    for (const seat of ["p1", "p2"]) {
        const row = (await client.query(
            anyApi.gameReads.getDefinitionManifest,
            { gameId: active.gameId, playerId: `${userId}-${seat}` }
        )) as { entries: ManifestEntry[] } | null;
        if (!row) {
            throw new TreeFailure(`no Definition Manifest for seat ${seat}`);
        }
        entries.push(...row.entries);
    }
    return entries;
}

async function measureGame(input: {
    browser: Browser;
    baseUrl: string;
    convexUrl: string;
    kind: GameKind;
    account: LaneAccount;
    token: string;
    distDir: string;
    handWritten: ReadonlyMap<string, string>;
    sizes: ReadonlyMap<string, number>;
}): Promise<GameDownloadReport> {
    const { browser, baseUrl, kind } = input;
    // A fresh context per game: a cold HTTP cache, no storage.
    const context = await browser.newContext();
    const fetched = new Set<string>();
    let lastCardData = 0;
    let workerLoaded = false;
    // Context-wide, so the Brain worker's requests count beside the page's.
    context.on("response", (res) => {
        const asset = path.posix.basename(new URL(res.url()).pathname);
        if (asset.startsWith(BRAIN_WORKER_CHUNK_PREFIX)) workerLoaded = true;
        if (cardDataKind(asset) !== null) {
            fetched.add(asset);
            lastCardData = Date.now();
        }
    });
    try {
        const page = await context.newPage();
        await signIn(page, baseUrl, input.account);
        await startGame(page, baseUrl, kind);
        // Against the Bot, the worker is part of the game's download: wait
        // for its script before the quiet window opens, or a worker that
        // boots late is never measured.
        const boardAt = Date.now();
        while (kind === "bot" && !workerLoaded) {
            if (Date.now() - boardAt > BOARD_TIMEOUT) {
                throw new TreeFailure(
                    `bot: the Brain worker never loaded within ${BOARD_TIMEOUT / 1000}s of the board`
                );
            }
            await page.waitForTimeout(250);
        }
        const quietFrom = Date.now();
        while (Date.now() - Math.max(lastCardData, quietFrom) < QUIET_MS) {
            if (Date.now() - quietFrom > SETTLE_DEADLINE_MS) {
                throw new TreeFailure(
                    `${kind}: card data still arriving ${SETTLE_DEADLINE_MS / 1000}s after the board`
                );
            }
            await page.waitForTimeout(500);
        }
        const entries = await readManifests(input.convexUrl, input.token);
        const budget = manifestBudget(
            input.distDir,
            entries,
            input.handWritten,
            input.sizes
        );
        return judgeGameDownload(
            { game: kind, fetched: [...fetched], budget },
            input.sizes
        );
    } finally {
        await context.close();
    }
}

async function main(): Promise<number> {
    const env = { ...readEnvLocal(ROOT), ...process.env } as Record<
        string,
        string
    >;
    const convexUrl = env.VITE_CONVEX_URL;
    if (!convexUrl) throw new FatalError("VITE_CONVEX_URL is unset");
    if (!(await reachable(convexUrl, 5000))) {
        throw new DeploymentDownError(
            `the Convex deployment at ${convexUrl} did not answer — \`bun run convex:ensure\``
        );
    }
    await acquireUiLane({
        root: gateLockRoot(),
        label: "check:game-download",
        announce: log,
    });

    const outDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "tolaria-game-download-")
    );
    const run = localConvexRunner();
    const registered: LaneAccount[] = [];
    let preview: ChildProcess | null = null;
    let browser: Browser | null = null;
    // Synchronous, so a signal — which never reaches the `finally` — runs it
    // too; idempotent, so both may.
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        stopPreview(preview);
        fs.rmSync(outDir, { recursive: true, force: true });
        for (const account of registered) {
            try {
                run("uiGateAccounts:destroyLaneAccount", {
                    email: account.email,
                });
            } catch (err) {
                log(
                    `TEARDOWN FAILED for ${account.email} — ${(err as Error).message}; the next check:ui sweep collects it`
                );
            }
        }
    };
    const uninstallSignals = installSignalTeardown(process, cleanup, (code) =>
        process.exit(code)
    );
    const t0 = Date.now();
    try {
        const buildSecs = buildProduction(outDir);
        log(`production build: ${buildSecs}s`);
        const sizes = cardDataSizes(outDir);
        const handWritten = handWrittenSetCodes(
            fs.readFileSync(
                path.join(ROOT, "data", "catalogue", "definition-index.json"),
                "utf8"
            )
        );
        const port = await freePort();
        const baseUrl = `http://127.0.0.1:${port}`;
        preview = servePreview(outDir, port);
        await waitForServer(baseUrl, 60_000);
        const { chromium } = await import("playwright");
        browser = await chromium.launch({ headless: true });

        const reports: GameDownloadReport[] = [];
        for (const kind of ["solo", "bot"] as const) {
            const account = newLaneAccount();
            registered.push(account);
            const token = await passwordSignUp(convexUrl)(account);
            if (!token) throw new FatalError("sign-up issued no token");
            reports.push(
                await measureGame({
                    browser,
                    baseUrl,
                    convexUrl,
                    kind,
                    account,
                    token,
                    distDir: outDir,
                    handWritten,
                    sizes,
                })
            );
        }

        const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
        log(
            `whole catalogue: ${kb(catalogueGzipBytes(sizes))} gzip of card data`
        );
        for (const r of reports) {
            log(
                `${r.game}: ${kb(r.fetchedGzipBytes)} gzip of card data fetched, ` +
                    `Manifest budget ${kb(r.budgetGzipBytes)} — ${r.failures.length === 0 ? "OK" : "OVER"}`
            );
        }
        log(`measured cost: ${Math.round((Date.now() - t0) / 1000)}s`);
        const failures = reports.flatMap((r) =>
            r.failures.map((f) => `${r.game}: ${f}`)
        );
        if (failures.length > 0) {
            console.error("\n[check:game-download] failed:\n");
            for (const f of failures) console.error(`  - ${f}`);
            return 1;
        }
        return 0;
    } finally {
        await browser?.close().catch(() => {});
        cleanup();
        uninstallSignals();
    }
}

main().then(
    (code) => process.exit(code),
    (err: unknown) => {
        console.error(`[check:game-download] ${(err as Error).message}`);
        process.exit(
            err instanceof TreeFailure
                ? 1
                : err instanceof DeploymentDownError
                  ? DEPLOYMENT_DOWN_EXIT
                  : 2
        );
    }
);
