/**
 * The Infra Verdict (CONTEXT.md § Surfaces, ADR 0132, issue #3644): the third
 * outcome of a Walked Surface at a viewport, beside pass and fail — the walk
 * was cut short by the MACHINE, not by the tree.
 *
 * WHY. The local Convex backend's 1s function limit fires at load ~20+; the
 * page shows an error state, the next walk step times out, and the lane used
 * to report the surface `UNWALKED` with a reason that blamed the surface. A UI
 * change read as broken because another session was running a gate.
 *
 * WHAT IS HERE. Pure decisions, no browser, no clock, no `os`:
 *
 *   1. `classifyWalkFailure` — a failed attempt, by its SIGNATURE (the console
 *      errors the page logged during the attempt, then the thrown message), is
 *      `INFRA` with a named signature, or `UNWALKED`. An unknown failure is
 *      `UNWALKED`: a signature is recognised, never guessed.
 *   2. `retryStep` — what to do after an `INFRA` attempt, as a function of the
 *      attempt count and the load samples taken since: wait while the 1-minute
 *      load average is at or over the threshold (bounded), retry, or give up at
 *      the attempt bound.
 *   3. `standingVerdict` — the verdict an `INFRA` failure stands as once the
 *      retries are spent. `UNWALKED` keeps its meaning — the walk could not
 *      reach the surface ON A QUIET MACHINE — so a signature that still fails
 *      with the load under the threshold is the walk's own failure, not the
 *      machine's, and is reported as such (its signature kept in the reason).
 *   4. `walkRunVerdict` — the WHOLE run, as the batch health gate reads it
 *      (issue #4962): its exit code plus its printed receipt, `pass`, `infra`
 *      (the environment cut it short) or `red` (the tree is wrong).
 *
 * `index.ts` owns the impure half: collecting console errors per attempt,
 * sampling `os.loadavg()`, sleeping, and recreating a game before a retry.
 */
import { DEPLOYMENT_DOWN_EXIT } from "../lib/convex-reachable";

/** The failure shapes the machine produces. Stable ids: they are printed on
 *  the receipt, and `walkRunVerdict` reads them back. */
export const INFRA_SIGNATURES = [
    "function-timeout",
    "server-error",
    "navigation-timeout",
    "step-timeout",
    "unsettled",
    "cell-deadline",
] as const;
export type InfraSignature = (typeof INFRA_SIGNATURES)[number];

/** One failed walk attempt, as the lane captured it. */
export interface WalkFailure {
    /** The message of the error the walk (or the settle wait) threw. */
    message: string;
    /** Every console error the page logged during THIS attempt. */
    consoleErrors: readonly string[];
}

export type FailureClass =
    | { kind: "INFRA"; signature: InfraSignature }
    | { kind: "UNWALKED" };

/**
 * The prefix `settle.ts` puts on the error a screen that never settled throws.
 * Declared here, beside the rule that recognises it, so the two cannot drift.
 */
export const UNSETTLED_MESSAGE_PREFIX = "screen did not settle";

/**
 * The prefix `cell-deadline.ts` puts on the error a cell attempt that outlived
 * its wall-clock deadline is rejected with (issue #4912). Declared here for the
 * same reason as `UNSETTLED_MESSAGE_PREFIX`.
 */
export const CELL_DEADLINE_MESSAGE_PREFIX = "cell deadline exceeded";

interface SignatureRule {
    signature: InfraSignature;
    pattern: RegExp;
}

/**
 * Console signatures win over the message: a backend timeout surfaces in the
 * page as an error state, and the walk then fails on whatever step came next —
 * a selector that never appeared, with a message that names the surface. The
 * console is where the machine left its fingerprint.
 *
 * `Server Error` is how the Convex client logs a function that failed on the
 * server (`[CONVEX Q(module:fn)] [Request ID: …] Server Error`).
 */
const CONSOLE_RULES: readonly SignatureRule[] = [
    { signature: "function-timeout", pattern: /Function execution timed out/i },
    { signature: "server-error", pattern: /\bServer Error\b/ },
];

/**
 * Message signatures, most specific first. The two timeout shapes are
 * Playwright's own wording (`page.goto: Timeout 20000ms exceeded.`,
 * `locator.click: Timeout 8000ms exceeded.`), which a walk's `Unreachable`
 * keeps when it wraps an actionability failure.
 */
const MESSAGE_RULES: readonly SignatureRule[] = [
    ...CONSOLE_RULES,
    {
        signature: "unsettled",
        pattern: new RegExp(`^${UNSETTLED_MESSAGE_PREFIX}`),
    },
    {
        signature: "navigation-timeout",
        pattern:
            /\b(?:page\.goto|page\.waitForURL|page\.reload|page\.waitForNavigation): Timeout \d+ms exceeded|net::ERR_(?:CONNECTION|TIMED_OUT|EMPTY_RESPONSE)/,
    },
    {
        signature: "step-timeout",
        pattern: /\bTimeout \d+ms exceeded\b/,
    },
];

/**
 * A cell attempt that outlived its deadline (issue #4912) is `cell-deadline`
 * before anything else is read: the lane itself cut the attempt short, so the
 * deadline is a FACT about the attempt, where a console line is only evidence.
 */
const DEADLINE_PATTERN = new RegExp(`^${CELL_DEADLINE_MESSAGE_PREFIX}`);

export function classifyWalkFailure(failure: WalkFailure): FailureClass {
    if (DEADLINE_PATTERN.test(failure.message)) {
        return { kind: "INFRA", signature: "cell-deadline" };
    }
    for (const rule of CONSOLE_RULES) {
        if (failure.consoleErrors.some((line) => rule.pattern.test(line))) {
            return { kind: "INFRA", signature: rule.signature };
        }
    }
    for (const rule of MESSAGE_RULES) {
        if (rule.pattern.test(failure.message)) {
            return { kind: "INFRA", signature: rule.signature };
        }
    }
    return { kind: "UNWALKED" };
}

export interface RetryPolicy {
    /** Total attempts per cell, the first included. */
    maxAttempts: number;
    /** A 1-minute load average at or over this is "the machine is busy". */
    loadThreshold: number;
    /** How long to wait between two load samples. */
    pollMs: number;
    /** The longest a single retry waits for the load to drop before it
     *  retries anyway. */
    maxWaitMs: number;
}

export type RetryStep =
    | { action: "wait"; ms: number }
    | { action: "retry" }
    | { action: "give-up" };

/**
 * The step after an `INFRA` attempt.
 *
 * `attempts` is how many attempts the cell has made so far (≥ 1).
 * `loadSamples` are the 1-minute load averages sampled since that attempt
 * failed, oldest first; the caller samples, asks, and — on `wait` — sleeps and
 * samples again. The first sample is taken with no wait, so `n` samples mean
 * `(n - 1) * pollMs` spent waiting.
 *
 * THE WAIT IS PROPORTIONAL TO WHAT CAN CHANGE (issue #4687). A busy machine
 * earns one poll to show a trend; after that the wait continues only while the
 * load is FALLING between samples, and stops at `maxWaitMs` regardless. On a
 * machine whose load sits over the threshold all day — other sessions' gates,
 * not this run's — the old rule spent the whole budget on every INFRA attempt,
 * twice per cell, and the load was exactly where it started.
 */
export function retryStep(
    attempts: number,
    loadSamples: readonly number[],
    policy: RetryPolicy
): RetryStep {
    if (attempts >= policy.maxAttempts) return { action: "give-up" };
    const latest = loadSamples.at(-1);
    if (latest === undefined) return { action: "wait", ms: 0 };
    if (latest < policy.loadThreshold) return { action: "retry" };
    const waited = (loadSamples.length - 1) * policy.pollMs;
    if (waited >= policy.maxWaitMs) return { action: "retry" };
    const previous = loadSamples.at(-2);
    const falling = previous === undefined || latest < previous;
    return falling
        ? { action: "wait", ms: policy.pollMs }
        : { action: "retry" };
}

/**
 * The verdict an `INFRA` failure stands as once `retryStep` gave up. `load` is
 * the 1-minute load average when the last attempt failed.
 *
 * `cell-deadline` stands as INFRA at any load (issue #4912): the stall it
 * names was observed at load 2–10 on 8 cpus with the renderers idle — an
 * await in the lane that never settled, not a screen the walk could not
 * reach. Reporting it UNWALKED would put the lane's own hang on the surface.
 */
export function standingVerdict(
    load: number,
    policy: Pick<RetryPolicy, "loadThreshold">,
    signature?: InfraSignature
): "INFRA" | "UNWALKED" {
    if (signature === "cell-deadline") return "INFRA";
    return load >= policy.loadThreshold ? "INFRA" : "UNWALKED";
}

/** `function-timeout, load 23.4` — the signature and the load, as the receipt
 *  prints them after `INFRA —`. */
export function infraDetail(signature: InfraSignature, load: number): string {
    return `${signature}, load ${load.toFixed(1)}`;
}

/**
 * The whole `check:ui` run as the batch health gate reads it (issue #4962):
 * `pass`, `infra` — the environment, never the tree, cut it short — or `red`.
 *
 * WHY. Of the first ten walks inside health, nine failed and none on a product
 * defect: a down backend, a sign-in the auth backend refused, and walks whose
 * own rows said `INFRA` at load 7–12.5. Each wrote a RED marker that stopped
 * the queue. The walk already says, row by row, which failures were the
 * machine's; this reads that back instead of treating every non-zero exit as
 * the tree's.
 *
 *   - exit 0 → `pass`.
 *   - exit 2 (fatal: configuration, sign-in, a thrown run) and exit 3
 *     (`DEPLOYMENT_DOWN_EXIT`) → `infra`: no surface was judged.
 *   - exit 1 → `infra` iff it printed at least one failing row and EVERY
 *     failing row is the machine's: an `INFRA` row, or an `UNWALKED` surface
 *     whose diagnostic `unwalked` line carries an infra signature — the walk
 *     itself classified the failure (`classifyWalkFailure`) and only the
 *     quiet-machine rule (`standingVerdict`) stood it as `UNWALKED`.
 *     A `FAIL` row (a broken Floor on a cell that settled), an `assert … FAIL`
 *     row, or an `UNWALKED` with no signature (`View Table did not open …`)
 *     is `red`. An exit 1 with no failing row to read is `red`: fail closed.
 *   - any other code (a signal, an unknown exit) → `red`.
 */
export type WalkRunVerdict = "pass" | "infra" | "red";

export const WALK_FATAL_EXIT = 2;

/** A verdict row (`formatRow` in `receipt.ts`): `VERDICT surface viewport …`. */
const VERDICT_ROW = /^(PASS|FAIL|INFRA|UNWALKED) +(\S+) +(\S+)/;
/** An assertion row (`formatAssertRow`): `assert surface viewport FAIL label`. */
const ASSERT_FAIL_ROW = /^assert +\S+ +\S+ +FAIL\b/;
/** A diagnostic `unwalked` line: `unwalked surface — reason`. */
const UNWALKED_LINE = /^unwalked +(\S+) +\S+ +(.*)$/;
/** The `(signature, load N…` a walk's own reason carries — `infraDetail`. */
const SIGNATURE_IN_REASON = new RegExp(
    `\\((?:${INFRA_SIGNATURES.join("|")}), load \\d`
);

export function walkRunVerdict(
    exitCode: number | null,
    output: string
): WalkRunVerdict {
    if (exitCode === 0) return "pass";
    if (exitCode === WALK_FATAL_EXIT || exitCode === DEPLOYMENT_DOWN_EXIT)
        return "infra";
    if (exitCode !== 1) return "red";

    const lines = output.split("\n").map((l) => l.replace(/\r$/, ""));
    const machineUnwalked = new Set<string>();
    for (const line of lines) {
        const m = UNWALKED_LINE.exec(line);
        if (m && SIGNATURE_IN_REASON.test(m[2])) machineUnwalked.add(m[1]);
    }
    let failing = 0;
    for (const line of lines) {
        if (ASSERT_FAIL_ROW.test(line)) return "red";
        const m = VERDICT_ROW.exec(line);
        if (!m) continue;
        const [, verdict, surface] = m;
        if (verdict === "PASS") continue;
        failing++;
        if (verdict === "FAIL") return "red";
        if (verdict === "UNWALKED" && !machineUnwalked.has(surface))
            return "red";
    }
    return failing > 0 ? "infra" : "red";
}
