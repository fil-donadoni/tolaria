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

/**
 * Credential shapes, scrubbed on the way IN.
 *
 * The network ring can promise "no query strings, ever" because it never holds
 * a URL; the console ring holds whatever the app logged, and an app logs URLs.
 * A failed request logged with its `?token=…`, an SDK error whose message
 * embeds a JWT, an `Authorization` header printed while debugging — each of
 * those would otherwise ride into the report row verbatim, which is exactly the
 * outcome the storage allowlist exists to prevent one door over.
 *
 * Scrubbed at RECORD time, not at send time: a value that never enters the ring
 * cannot be forgotten on the way out, and every writer (console, uncaught
 * error, unhandled rejection) goes through this one door.
 */
const SCRUBBERS: readonly [RegExp, string][] = [
    // A JWT — the shape of both Convex auth tokens.
    [
        /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g,
        "[redacted-jwt]",
    ],
    // `Authorization: Bearer …`, however it was formatted.
    [/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi, "$1[redacted]"],
    // Any query parameter whose NAME says it carries a secret.
    [
        /([?&](?:token|access_token|refresh_token|id_token|auth|code|key|secret|password|sig|signature)=)[^&\s"'`]+/gi,
        "$1[redacted]",
    ],
];

/** Exported for its own test: the scrub is the security boundary of this ring,
 *  and a boundary nothing can call directly is a boundary nothing can prove. */
export function scrubSecrets(text: string): string {
    let scrubbed = text;
    for (const [pattern, replacement] of SCRUBBERS) {
        scrubbed = scrubbed.replace(pattern, replacement);
    }
    return scrubbed;
}

let entries: ConsoleEntry[] = [];

/** Push one entry. Exported for the installer below and for tests; nothing in
 *  the app writes the ring directly. Scrub first, THEN clamp: clamping first
 *  could cut a token in half and leave the half that is still a token. */
export function recordConsoleEntry(
    level: ConsoleEntryLevel,
    text: string
): void {
    const scrubbed = scrubSecrets(text);
    const clamped =
        scrubbed.length > MAX_ENTRY_CHARS
            ? `${scrubbed.slice(0, MAX_ENTRY_CHARS)}…`
            : scrubbed;
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
            try {
                // Duck-typed, not `instanceof`: an Error thrown across a realm
                // (the Brain Worker, an iframe) fails the prototype check and
                // would otherwise stringify to `"{}"` — losing the message,
                // which is the only part of it worth keeping. Inside the `try`
                // because a subclass may define a THROWING getter, and a
                // console wrapper that throws breaks the app's own logging.
                if (isErrorLike(arg)) return `${arg.name}: ${arg.message}`;
                return JSON.stringify(arg) ?? String(arg);
            } catch {
                return "[unserializable]";
            }
        })
        .join(" ");
}

function isErrorLike(
    value: unknown
): value is { name: string; message: string } {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { name?: unknown; message?: unknown };
    return (
        typeof candidate.name === "string" &&
        typeof candidate.message === "string"
    );
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
    const wrappers = new Map<string, (...args: unknown[]) => void>();
    for (const level of PATCHED_LEVELS) {
        const original = console[level].bind(console) as (
            ...args: unknown[]
        ) => void;
        originals.set(level, original);
        const wrapper = (...args: unknown[]) => {
            recordConsoleEntry(level, formatConsoleArgs(args));
            original(...args);
        };
        wrappers.set(level, wrapper);
        console[level] = wrapper;
    }

    const onError = (event: ErrorEvent) => {
        const detail = event.error ?? event.message;
        // An `error` event carrying neither is an event about nothing; a record
        // reading `"undefined"` is worse than no record, because it looks like
        // a crash whose message was lost.
        if (detail === undefined || detail === null) return;
        recordConsoleEntry("uncaught", formatConsoleArgs([detail]));
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
            // Restore ONLY if nothing wrapped us in turn. Sentry's own console
            // instrumentation installs after this one in `main.tsx`; blindly
            // reassigning would discard it and silently stop its breadcrumbs.
            if (original && console[level] === wrappers.get(level)) {
                console[level] = original;
            }
        }
        window.removeEventListener("error", onError);
        window.removeEventListener("unhandledrejection", onRejection);
        installed = false;
    };
}
