/**
 * A bounded console ring, and the uncaught failures interleaved into it
 * (issue #3256).
 *
 * A sibling of the AI decision ring (`src/lib/ai/trace-store.ts`) and
 * deliberately its twin in shape: fixed capacity, oldest dropped, plain JSON,
 * client-only, never persisted, never authoritative (ADR 0074). It reaches a
 * maintainer only when a reporter files a bug report and consents to it
 * (issue #3255).
 *
 * The third-party monitor holds the same events, so why keep them here at all?
 * Because only the row can show a maintainer the SEQUENCE AS THE REPORTER
 * EXPERIENCED IT, lined up against the board snapshot beside it — and because a
 * self-hosted or offline session has no third party at all.
 *
 * Uncaught errors and unhandled rejections land in the SAME ring rather than an
 * adjacent one: what makes a crash diagnosable is the console output that
 * preceded it, and two rings would have to be re-interleaved by timestamp to
 * recover exactly what one ring never lost.
 */

/** Where an entry came from. The console levels we keep, plus the two failure
 *  kinds the browser reports out of band. */
export type ConsoleEntryLevel =
    | "log"
    | "info"
    | "warn"
    | "error"
    | "debug"
    | "uncaught"
    | "unhandledrejection";

export type ConsoleEntry = {
    level: ConsoleEntryLevel;
    /** The formatted arguments, clamped — see `MAX_ENTRY_CHARS`. */
    text: string;
    at: number;
};

/**
 * Long enough to hold the run that precedes a crash — one line never shows a
 * pattern — and short enough that the whole ring travels inside a report
 * without approaching Convex's 1 MB document limit. At the clamp below, 100
 * entries cost at most ~40 KB.
 */
export const CONSOLE_RING_LIMIT = 100;

/** One stringified argument list can be an entire serialized object graph. The
 *  clamp is per entry, so a single enormous log cannot crowd out the 99 lines
 *  around it that give it meaning — and cannot cost the reporter the report by
 *  making the row unwritable. */
export const MAX_ENTRY_CHARS = 400;

let entries: ConsoleEntry[] = [];

/** Push one entry. Exported for the installer below and for tests; nothing in
 *  the app writes the ring directly. */
export function recordConsoleEntry(
    level: ConsoleEntryLevel,
    text: string
): void {
    const clamped =
        text.length > MAX_ENTRY_CHARS
            ? `${text.slice(0, MAX_ENTRY_CHARS)}…`
            : text;
    entries = [...entries, { level, text: clamped, at: Date.now() }].slice(
        -CONSOLE_RING_LIMIT
    );
}

/** The ring as it stands. A PURE read — collecting diagnostics never clears it,
 *  so the Debug panel and a second report still see what the first one took. */
export function getConsoleRing(): ConsoleEntry[] {
    return entries;
}

export function clearConsoleRing(): void {
    entries = [];
}

/**
 * Formats one console argument list the way a human reads it, and never throws:
 * a circular object or a getter that blows up must degrade to a placeholder,
 * because the alternative is that installing this ring breaks logging itself.
 */
export function formatConsoleArgs(args: readonly unknown[]): string {
    return args
        .map((arg) => {
            if (typeof arg === "string") return arg;
            if (arg instanceof Error) {
                return `${arg.name}: ${arg.message}`;
            }
            try {
                return JSON.stringify(arg) ?? String(arg);
            } catch {
                return "[unserializable]";
            }
        })
        .join(" ");
}

const PATCHED_LEVELS = ["log", "info", "warn", "error", "debug"] as const;

let installed = false;

/**
 * Wraps the console methods and subscribes to the two out-of-band failure
 * events. Idempotent — a second call is a no-op, so a hot reload cannot stack
 * wrappers and log each line twice.
 *
 * The original method is always called: this ring OBSERVES the console, it does
 * not own it, and a devtools session must keep showing exactly what it showed
 * before. Returns an uninstaller, which is what lets a test assert the wrapper
 * chains rather than replaces.
 */
export function installConsoleRing(): () => void {
    if (installed) return () => {};
    installed = true;

    const originals = new Map<string, (...args: unknown[]) => void>();
    for (const level of PATCHED_LEVELS) {
        const original = console[level].bind(console) as (
            ...args: unknown[]
        ) => void;
        originals.set(level, original);
        console[level] = (...args: unknown[]) => {
            recordConsoleEntry(level, formatConsoleArgs(args));
            original(...args);
        };
    }

    const onError = (event: ErrorEvent) => {
        recordConsoleEntry(
            "uncaught",
            formatConsoleArgs([event.error ?? event.message])
        );
    };
    const onRejection = (event: PromiseRejectionEvent) => {
        recordConsoleEntry(
            "unhandledrejection",
            formatConsoleArgs([event.reason])
        );
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
        for (const level of PATCHED_LEVELS) {
            const original = originals.get(level);
            if (original) console[level] = original;
        }
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        installed = false;
    };
}
