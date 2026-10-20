/**
 * The console errors of ONE walk attempt — what `classifyWalkFailure` reads a
 * signature from (issue #6087).
 *
 * WHY. React logs a render error as `console.error("%o", error)`: the message
 * TEXT is the bare format string, and the Convex `Server Error` sits in the
 * argument (`console-detail.ts`, issue #6072). Classifying from the text alone
 * read a dead deployment as `unsettled` — the screen's word, the 2026-10-19
 * misattribution issue #6081 describes. So each error is kept by its text AND
 * by its resolved detail.
 *
 * The detail resolves page-side, after the event: `lines()` waits for every
 * pending one (each bounded by `detailWaitMs`, a hung page never holds the
 * verdict), and a detail that resolves after `clear()` belonged to the
 * previous attempt and is dropped, never counted against this one.
 *
 * Pure: the wait is injected.
 */

export interface AttemptConsole {
    /** A console error: its text now, its resolved detail when it arrives. */
    error(text: string, detail: Promise<string>): void;
    /** An uncaught page exception: its message is the whole record. */
    uncaught(message: string): void;
    /** Start a new attempt: forget every line, drop every pending detail. */
    clear(): void;
    /** This attempt's lines, once every pending detail resolved or timed out. */
    lines(): Promise<readonly string[]>;
}

export function createAttemptConsole(deps: {
    detailWaitMs: number;
    sleep: (ms: number) => Promise<void>;
}): AttemptConsole {
    let recorded: string[] = [];
    let pending: Promise<void>[] = [];
    /** Bumped by `clear()`: a detail carries the attempt it was logged in. */
    let attempt = 0;
    return {
        error(text, detail) {
            recorded.push(text);
            const loggedIn = attempt;
            pending.push(
                Promise.race([
                    detail.then(
                        (resolved) => {
                            if (loggedIn === attempt && resolved !== text) {
                                recorded.push(resolved);
                            }
                        },
                        () => {}
                    ),
                    deps.sleep(deps.detailWaitMs),
                ])
            );
        },
        uncaught(message) {
            recorded.push(message);
        },
        clear() {
            attempt++;
            recorded = [];
            pending = [];
        },
        async lines() {
            await Promise.all(pending);
            return [...recorded];
        },
    };
}
