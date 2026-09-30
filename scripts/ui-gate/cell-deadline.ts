/**
 * Cell deadlines (issue #4912): no surface × viewport cell, and no run, waits
 * forever.
 *
 * WHY. A `check:ui` run on PR #4911 stalled twice with nothing thrown: after
 * the other viewports reported `— walked`, one or more printed nothing for
 * 16–33 minutes while the renderers sat idle and the gate kept polling. The
 * Infra Verdict's retries (issue #3644) are driven by a THROWN failure, and the
 * settle wait is the only await in a cell with its own bound —
 * `page.evaluate`, the probe and axe injections, a walk's own non-locator
 * awaits are not. An await that never settles is a hang the lane cannot
 * classify, retry or report.
 *
 * WHAT IS HERE.
 *
 *   1. `withDeadline` — a race between a piece of work and a wall clock. On
 *      expiry it runs the caller's `onExpire` (the lane closes the page, which
 *      rejects every Playwright call still pending on it) and rejects with a
 *      message starting `CELL_DEADLINE_MESSAGE_PREFIX`, which
 *      `classifyWalkFailure` reads as the `cell-deadline` signature.
 *   2. `runCellAttempts` — ONE cell's attempts, each under the deadline, with
 *      the Infra Verdict's classification and `RETRY_POLICY` applied to every
 *      failure. It used to be the body of `walkToSettled` in `index.ts`, a
 *      closure over a live browser page no test could reach; extracted, a test
 *      double whose walk never settles proves the cell ends.
 *   3. `openCellsLines` — what a run that hit its own deadline prints: the
 *      viewports that never reported, and what each was doing.
 *
 * No browser, no `os`: the clock, the load and the sleep are all injected.
 */
import {
    CELL_DEADLINE_MESSAGE_PREFIX,
    classifyWalkFailure,
    infraDetail,
    retryStep,
    standingVerdict,
    type InfraSignature,
    type RetryPolicy,
} from "./infra-verdict.ts";

/** The longest onExpire may take (closing a page on a stalled renderer can
 *  itself stall) before the deadline rejects anyway. */
export const EXPIRE_GRACE_MS = 5_000;

/** Rejected by `withDeadline` when the clock wins. */
export class DeadlineExpired extends Error {}

/**
 * Race `work` against `ms` of wall clock. Settles with `work`'s outcome if it
 * comes first; otherwise awaits `onExpire` (bounded by `EXPIRE_GRACE_MS`, its
 * own failure swallowed) and rejects with `DeadlineExpired`. The abandoned
 * work's eventual rejection is swallowed — nobody is listening for it any
 * more, and an unhandled rejection would take the whole run down.
 */
export function withDeadline<T>(
    work: () => Promise<T>,
    ms: number,
    what: string,
    onExpire: () => unknown = () => {}
): Promise<T> {
    const running = work();
    running.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            void (async () => {
                let grace: ReturnType<typeof setTimeout> | undefined;
                await Promise.race([
                    Promise.resolve()
                        .then(onExpire)
                        .catch(() => {}),
                    new Promise((r) => {
                        grace = setTimeout(r, EXPIRE_GRACE_MS);
                    }),
                ]);
                clearTimeout(grace);
                reject(
                    new DeadlineExpired(
                        `${CELL_DEADLINE_MESSAGE_PREFIX}: ${what} did not finish within ${Math.round(ms / 1000)}s`
                    )
                );
            })();
        }, ms);
    });
    return Promise.race([running, expired]).finally(() => clearTimeout(timer));
}

/** What one attempt says when it did not throw: the screen was measured, or
 *  the walk reached a verdict of its own that no retry can change (a
 *  measurement that threw, a page that would not hold still). */
export type AttemptResult<T> =
    | { kind: "ok"; value: T }
    | { kind: "unwalked"; reason: string };

export type CellOutcome<T> =
    | { kind: "ok"; value: T }
    | { kind: "UNWALKED"; reason: string }
    | {
          kind: "INFRA";
          signature: InfraSignature;
          load: number;
          /** The last failure's first line. */
          reason: string;
          attempts: number;
          /** `infraDetail(signature, load)`, as the cell line prints it. */
          said: string;
      };

export interface CellAttemptDeps<T> {
    /** One attempt: walk, settle, measure. Throws on a failure the Infra
     *  Verdict classifies. */
    attempt: () => Promise<AttemptResult<T>>;
    /** The console errors the CURRENT attempt logged. */
    attemptConsole: () => readonly string[];
    /** The human reason for a thrown failure (a walk's `Unreachable` message,
     *  or `walk threw: …`). */
    reasonOf: (err: unknown) => string;
    /** Run when an attempt outlives the deadline — close the page. */
    onDeadline: () => unknown;
    /** Undo the failed attempt before the next one (reopen the page, the
     *  surface's cleanup, a fresh lane game). Its own failures are its to
     *  report; it runs under the deadline too. */
    beforeRetry: () => Promise<void>;
    /** One line per retried attempt, as the cell log prints it. */
    note: (line: string) => void;
    deadlineMs: number;
    policy: RetryPolicy;
    loadAverage: () => number;
    sleep: (ms: number) => Promise<void>;
    /** Printed in the deadline message: `<surface> @ <viewport>`. */
    where: string;
}

/**
 * One cell's attempts, each under `deadlineMs`, classified and retried per the
 * Infra Verdict (issue #3644). Ends in at most `policy.maxAttempts` attempts,
 * each bounded — so a walk that never settles ends as `INFRA — cell-deadline`
 * within roughly `deadlineMs × maxAttempts` plus the load waits.
 */
export async function runCellAttempts<T>(
    deps: CellAttemptDeps<T>
): Promise<CellOutcome<T>> {
    const { policy } = deps;
    for (let attempts = 1; ; attempts++) {
        try {
            const result = await withDeadline(
                deps.attempt,
                deps.deadlineMs,
                `attempt ${attempts} at ${deps.where}`,
                deps.onDeadline
            );
            return result.kind === "ok"
                ? result
                : { kind: "UNWALKED", reason: result.reason };
        } catch (err) {
            const message = (err as Error).message;
            const reason = deps.reasonOf(err);
            const failure = classifyWalkFailure({
                message,
                consoleErrors: deps.attemptConsole(),
            });
            if (failure.kind === "UNWALKED") {
                return { kind: "UNWALKED", reason };
            }

            const failedAt = deps.loadAverage();
            const said = infraDetail(failure.signature, failedAt);
            const samples: number[] = [];
            let step = retryStep(attempts, samples, policy);
            while (step.action === "wait") {
                if (step.ms > 0) await deps.sleep(step.ms);
                samples.push(deps.loadAverage());
                step = retryStep(attempts, samples, policy);
            }

            const firstLine = reason.split("\n")[0];
            if (step.action === "give-up") {
                if (
                    standingVerdict(failedAt, policy, failure.signature) ===
                    "UNWALKED"
                ) {
                    return {
                        kind: "UNWALKED",
                        reason: `${firstLine} (${said}, under the retry threshold: the walk itself failed)`,
                    };
                }
                return {
                    kind: "INFRA",
                    signature: failure.signature,
                    load: failedAt,
                    reason: firstLine,
                    attempts,
                    said,
                };
            }

            deps.note(
                `infra attempt ${attempts}/${policy.maxAttempts} — ${said}; retrying at load ${(samples.at(-1) ?? failedAt).toFixed(1)}`
            );
            await withDeadline(
                deps.beforeRetry,
                deps.deadlineMs,
                `the retry setup after attempt ${attempts} at ${deps.where}`,
                deps.onDeadline
            ).catch((e: Error) =>
                deps.note(`retry setup failed — ${e.message.split("\n")[0]}`)
            );
        }
    }
}

/**
 * The lines a run that hit its own deadline prints: every viewport that never
 * reported, with the step it was on. `progress` maps a viewport id to what it
 * is doing (`<surface>` while it walks one); `done` holds the viewports that
 * reported. Viewports that never started are listed too — they are open cells
 * as much as a stalled one is.
 */
export function openCellsLines(
    viewportIds: readonly string[],
    progress: ReadonlyMap<string, string>,
    done: ReadonlySet<string>
): string[] {
    return viewportIds
        .filter((id) => !done.has(id))
        .map(
            (id) =>
                `  open: ${id.padEnd(12)} ${progress.get(id) ?? "not started"}`
        );
}

/** A positive integer from an environment override, else the default. */
export function deadlineFromEnv(
    raw: string | undefined,
    fallbackMs: number
): number {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}
