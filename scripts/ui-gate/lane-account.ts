/**
 * The `check:ui` run's own throwaway account (issue #3626, PRD #3625 slice A).
 *
 * WHY. Every run used to sign in as ONE shared dev account against the one
 * local deployment, so two sessions running the lane at once turned each
 * other's game surfaces UNWALKED, and a game another session left open blocked
 * a run with zero FAIL rows (PR #3623). Now a run:
 *
 *   1. sweeps lane accounts older than two hours (runs killed with no chance
 *      to clean up);
 *   2. registers `ui-gate+<runId>@ui-gate.invalid` with a random password
 *      through the REAL Password sign-up flow — the `auth:signIn` action the
 *      auth form calls, with `flow: "signUp"`;
 *   3. grants it admin + tester and seeds its Limited fixtures under
 *      `ui-gate/<runId>/…` labels;
 *   4. destroys it, with every row it owns, when the run ends — on success,
 *      on failure, and on SIGINT/SIGTERM. `--keep-user` skips that and prints
 *      the credentials instead; the sweep collects the account later.
 *
 * The server half, and the refusals that make each step safe, live in
 * `convex/uiGateAccounts.ts`.
 *
 * TEARDOWN IS SYNCHRONOUS on purpose: a signal handler cannot await, and a
 * teardown that returned before its `convex run` finished would exit the
 * process with the account still standing. `spawnSync` blocks until the
 * deployment has answered.
 *
 * WHERE `convex run` RUNS. The local deployment's CLI config (`.convex/`)
 * exists only in the primary checkout, so every call runs there
 * (`primaryCheckout()`), exactly as `seed:preset`'s local target does.
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { laneAccountEmail } from "../../convex/lib/uiGateLaneAccount";
import {
    uiGateDraftLabel,
    uiGateOpenLabel,
    uiGateRunLabelPrefix,
} from "../../convex/limited/uiGateFixtureLabels";
import { convexRunErrorMessage } from "../lib/convex-run-error";
import { primaryCheckout } from "../lib/primary-checkout";

export interface LaneAccount {
    runId: string;
    email: string;
    password: string;
    nickname: string;
}

/** The labels this run's Limited fixtures are seeded and walked under. */
export interface FixtureLabels {
    /** `/limited?label=<prefix>` narrows the list to exactly this run's rows. */
    prefix: string;
    open: string;
    draft: string;
}

/** The 12-hex id a run — and each of its accounts — is named by.
 *  `runScreenshotDir` prunes on exactly this shape, and the server side
 *  recognises a lane address by it. */
export function newRunId(
    random: (bytes: number) => Buffer = randomBytes
): string {
    return random(6).toString("hex");
}

export function newLaneAccount(
    random: (bytes: number) => Buffer = randomBytes
): LaneAccount {
    const runId = newRunId(random);
    return {
        runId,
        email: laneAccountEmail(runId),
        // Lives only in this process's memory (and in `--keep-user`'s output).
        password: random(18).toString("base64url"),
        nickname: `ui-gate ${runId}`,
    };
}

export function fixtureLabelsFor(runId: string): FixtureLabels {
    return {
        prefix: uiGateRunLabelPrefix(runId),
        open: uiGateOpenLabel(runId),
        draft: uiGateDraftLabel(runId),
    };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The declared positions the game surfaces load (ADR 0132 §4), in the order
 *  the bootstrap seeds them.
 *
 *  They ship as payloads in this directory rather than as rows, because a
 *  debug scenario is DEPLOYMENT-LOCAL by design (ADR 0044) and a lane that
 *  cannot reach a surface reports a coverage hole. Seeding them at bootstrap —
 *  beside the Limited fixtures, issue #3652 — is what makes a fresh deployment
 *  walkable without anyone re-deriving these positions by hand.
 *
 *  UNLIKE the fixtures, these are NOT run-scoped: `seedScenarioDirect` upserts
 *  by label and the payload is a constant, so two concurrent runs write the
 *  same bytes to the same row and neither can drop the other's. They therefore
 *  outlive the account, which is also why they carry no per-run data. */
const SCENARIO_FILES = [
    "stress-scenario.json",
    "yields-scenario.json",
    "ai-trace-scenario.json",
    "board-scenario.json",
    "combat-scenario.json",
    "choice-scenario.json",
] as const;

export interface ScenarioSeed {
    label: string;
    spec: unknown;
    prompt?: string;
}

/** Read the payloads off disk. A pure function of the directory, so
 *  `ui-gate-lane-account.test.ts` asserts what the bootstrap will send
 *  without a deployment. */
export function laneScenarioSeeds(dir: string = HERE): ScenarioSeed[] {
    return SCENARIO_FILES.map((file) => {
        const seed = JSON.parse(
            fs.readFileSync(path.join(dir, file), "utf8")
        ) as ScenarioSeed;
        if (!seed.label || !seed.spec) {
            throw new LaneAccountError(
                `${file} is not a scenario payload — it needs a \`label\` and a \`spec\``
            );
        }
        return seed;
    });
}

/** One `convex run` against the local deployment; returns the parsed result,
 *  throws `LaneAccountError` carrying the function's own message. */
export type ConvexRunner = (
    fn: string,
    args: Record<string, unknown>
) => unknown;

export class LaneAccountError extends Error {}

export function convexRunArgv(
    fn: string,
    args: Record<string, unknown>
): string[] {
    return ["convex", "run", fn, JSON.stringify(args)];
}

export function localConvexRunner(
    cwd: string = primaryCheckout()
): ConvexRunner {
    return (fn, args) => {
        const res = spawnSync("bunx", convexRunArgv(fn, args), {
            cwd,
            encoding: "utf8",
            timeout: 180_000,
        });
        if (res.error) {
            throw new LaneAccountError(`${fn} — ${res.error.message}`);
        }
        if (res.status !== 0) {
            const out = `${res.stderr ?? ""}${res.stdout ?? ""}`.trim();
            // The lane runs against whatever code the local backend last
            // received; a checkout that predates issue #3626 never pushed it.
            const hint = /could not find (public )?function/i.test(out)
                ? ` — the local deployment does not carry this function yet; push the base checkout's code (\`bunx convex dev --once\` in ${cwd})`
                : "";
            throw new LaneAccountError(
                `${fn} — ${convexRunErrorMessage(out)}${hint}`
            );
        }
        const text = (res.stdout ?? "").trim();
        try {
            return text === "" ? null : JSON.parse(text);
        } catch {
            return text;
        }
    };
}

export type SignUp = (account: LaneAccount) => Promise<void>;

/** The real sign-up: the same `auth:signIn` action, provider and params the
 *  auth form sends (`src/components/auth/auth-form.tsx`). */
export function passwordSignUp(convexUrl: string): SignUp {
    return async (account) => {
        const client = new ConvexHttpClient(convexUrl);
        await client.action(anyApi.auth.signIn, {
            provider: "password",
            params: {
                email: account.email,
                password: account.password,
                nickname: account.nickname,
                flow: "signUp",
            },
        });
    };
}

export interface LaneFleetDeps {
    /** One account per parallel lane (issue #3653). The one-game-per-account
     *  lobby gate is per ACCOUNT, so two contexts that must walk a game surface
     *  at the same time cannot share one. */
    accounts: readonly LaneAccount[];
    run: ConvexRunner;
    signUp: SignUp;
    keepUser: boolean;
    log: (message: string) => void;
}

/** One account of the fleet, with the fixture labels seeded for it. */
export interface LaneMember {
    readonly account: LaneAccount;
    readonly labels: FixtureLabels;
}

export interface LaneFleet {
    readonly members: readonly LaneMember[];
    bootstrap(): Promise<void>;
    /** Synchronous and idempotent — safe from a `finally` AND a signal.
     *  Destroys EVERY member, and a member whose destroy throws never stops
     *  the next one: the sweep is the backstop for whatever is left. */
    teardown(): void;
}

/**
 * The run's accounts, bootstrapped and destroyed together.
 *
 * WHAT IS PER ACCOUNT and what is per RUN is the whole shape of this function:
 * the sweep and the declared positions are properties of the DEPLOYMENT (the
 * positions upsert by label, ADR 0132 §4), so they happen once however many
 * accounts the run owns; the sign-up, the roles, the Limited fixtures and the
 * contested verdict position are rows OWNED by an account, so they happen once
 * per member and are removed with it.
 */
export function createLaneFleet(deps: LaneFleetDeps): LaneFleet {
    const { run, log } = deps;
    if (deps.accounts.length === 0) {
        throw new LaneAccountError("a lane fleet needs at least one account");
    }
    const members: LaneMember[] = deps.accounts.map((account) => ({
        account,
        labels: fixtureLabelsFor(account.runId),
    }));
    /** Addresses whose sign-up was ATTEMPTED — the set teardown works from. */
    const registering = new Set<string>();
    let tornDown = false;

    return {
        members,

        async bootstrap() {
            const sweep = run("uiGateAccounts:sweepStaleLaneAccounts", {}) as {
                swept?: string[];
            } | null;
            const swept = sweep?.swept?.length ?? 0;
            if (swept > 0) {
                log(`ui-gate: swept ${swept} stale lane account(s)`);
            }
            for (const { account } of members) {
                // Armed BEFORE the sign-up call: a sign-up whose response was
                // lost may still have created the account, and teardown of an
                // address that does not exist is a no-op.
                registering.add(account.email);
                await deps.signUp(account);
                run("uiGateAccounts:grantLaneRoles", { email: account.email });
                run("limitedFixtures:seedUiGateFixtures", {
                    email: account.email,
                    runId: account.runId,
                });
                // The contested position `admin-verdicts` opens (issue #3582):
                // outbox rows owned by this account, removed with it.
                run("verdictResolutions:seedUiGateContestedPosition", {
                    email: account.email,
                });
            }
            // The game surfaces' declared positions (issue #3652). Upsert by
            // label, so this is idempotent and concurrent-run safe; it is the
            // step that makes "debug scenario absent from this deployment"
            // (`ensureScenarioBoard`'s Unreachable) unreachable in turn.
            const scenarios = laneScenarioSeeds();
            for (const seed of scenarios) {
                run("debugScenarios:seedScenarioDirect", {
                    label: seed.label,
                    spec: seed.spec,
                    ...(seed.prompt === undefined
                        ? {}
                        : { prompt: seed.prompt }),
                });
            }
            log(`ui-gate: seeded ${scenarios.length} debug scenario(s)`);
            for (const { account } of members) {
                log(
                    `ui-gate: run ${account.runId} — lane account ${account.email}`
                );
            }
        },

        teardown() {
            if (registering.size === 0 || tornDown) return;
            tornDown = true;
            for (const { account } of members) {
                if (!registering.has(account.email)) continue;
                if (deps.keepUser) {
                    log(
                        `ui-gate: --keep-user — the lane account is left in place ` +
                            `(the next run's sweep collects it after two hours):\n` +
                            `  email:    ${account.email}\n` +
                            `  password: ${account.password}`
                    );
                    continue;
                }
                try {
                    run("uiGateAccounts:destroyLaneAccount", {
                        email: account.email,
                    });
                    log(`ui-gate: lane account ${account.email} destroyed`);
                } catch (err) {
                    log(
                        `ui-gate: TEARDOWN FAILED for ${account.email} — ${(err as Error).message}. ` +
                            `The next run's sweep collects it after two hours.`
                    );
                }
            }
        },
    };
}

/** Run `body` with the run's accounts in place, and tear them down however
 *  `body` ends — returned, threw, or bootstrap itself failed part-way. */
export async function withLaneFleet<T>(
    fleet: LaneFleet,
    body: () => Promise<T>
): Promise<T> {
    try {
        await fleet.bootstrap();
        return await body();
    } finally {
        fleet.teardown();
    }
}

export interface SignalSource {
    once(signal: NodeJS.Signals, listener: () => void): unknown;
    removeListener(signal: NodeJS.Signals, listener: () => void): unknown;
}

/** SIGINT/SIGTERM never reach a `finally`, so they get their own teardown.
 *  Exits with the conventional 128+signo. Returns the uninstaller. */
export function installSignalTeardown(
    source: SignalSource,
    teardown: () => void,
    exit: (code: number) => void
): () => void {
    const handlers: [NodeJS.Signals, () => void][] = [
        ["SIGINT", () => (teardown(), exit(130))],
        ["SIGTERM", () => (teardown(), exit(143))],
    ];
    // `once`, deliberately: a SECOND Ctrl+C during the synchronous teardown
    // falls through to the default action and kills the process at once. That
    // is the escape hatch for a teardown stuck on a dead deployment, and the
    // account it strands is collected by the next run's sweep.
    for (const [signal, handler] of handlers) source.once(signal, handler);
    return () => {
        for (const [signal, handler] of handlers) {
            source.removeListener(signal, handler);
        }
    };
}

/** Runs' screenshot directories are kept this long, then pruned. */
export const SCREENSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * This run's screenshot directory under `root`, created, with sibling run
 * directories older than the retention window removed. Per run so two
 * concurrent runs can never overwrite each other's evidence; pruned because a
 * directory per run would otherwise grow without bound.
 */
export function runScreenshotDir(
    root: string,
    runId: string,
    now: number = Date.now()
): string {
    fs.mkdirSync(root, { recursive: true });
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || !/^[0-9a-f]{12}$/.test(entry.name))
            continue;
        const dir = path.join(root, entry.name);
        if (now - fs.statSync(dir).mtimeMs > SCREENSHOT_RETENTION_MS) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    const dir = path.join(root, runId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}
