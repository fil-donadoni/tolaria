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
 * WHAT IS HERE. Three pure decisions, no browser, no clock, no `os`:
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
 *
 * `index.ts` owns the impure half: collecting console errors per attempt,
 * sampling `os.loadavg()`, sleeping, and recreating a game before a retry.
 */

/** The failure shapes the machine produces. Stable ids: they are printed on
 *  the receipt. */
export type InfraSignature =
    | "function-timeout"
    | "server-error"
    | "navigation-timeout"
    | "step-timeout"
    | "unsettled";

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

export function classifyWalkFailure(failure: WalkFailure): FailureClass {
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
 */
export function retryStep(
    attempts: number,
    loadSamples: readonly number[],
    policy: RetryPolicy
): RetryStep {
    if (attempts >= policy.maxAttempts) return { action: "give-up" };
    const latest = loadSamples.at(-1);
    if (latest === undefined) return { action: "wait", ms: 0 };
    const waited = (loadSamples.length - 1) * policy.pollMs;
    if (latest >= policy.loadThreshold && waited < policy.maxWaitMs) {
        return { action: "wait", ms: policy.pollMs };
    }
    return { action: "retry" };
}

/**
 * The verdict an `INFRA` failure stands as once `retryStep` gave up. `load` is
 * the 1-minute load average when the last attempt failed.
 */
export function standingVerdict(
    load: number,
    policy: Pick<RetryPolicy, "loadThreshold">
): "INFRA" | "UNWALKED" {
    return load >= policy.loadThreshold ? "INFRA" : "UNWALKED";
}

/** `function-timeout, load 23.4` — the signature and the load, as the receipt
 *  prints them after `INFRA —`. */
export function infraDetail(signature: InfraSignature, load: number): string {
    return `${signature}, load ${load.toFixed(1)}`;
}
