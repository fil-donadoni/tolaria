/** A Convex mutation error split for display: a short `title` for the toast
 *  headline and the full `detail` envelope for the copy-to-clipboard action. */
export type MutationError = { title: string; detail: string };

/** Pull the user-facing inner message out of Convex's verbose envelope:
 *    "[CONVEX M(game:x)] [Request ID: ...] Server Error\nUncaught Error: foo"
 *  Falls back to the whole message when the marker isn't present. */
function shortTitle(message: string): string {
    const match = message.match(/Uncaught (?:Convex)?Error:\s*([^\n]+)/);
    return (match?.[1] ?? message).trim();
}

/** Player-facing text for an infrastructure failure. A Convex mutation is
 *  transactional: one that times out or errors is rolled back, so "not
 *  applied" is always true. */
const TIMEOUT_MESSAGE =
    "The server took too long. Your action was not applied — try again.";
const SERVER_ERROR_MESSAGE =
    "The server hit an error. Your action was not applied — try again.";
const NETWORK_MESSAGE =
    "Could not reach the server. Your action was not applied — try again.";

/** Maps an infrastructure failure (timeout, bare "Server Error", network) to
 *  a short player-facing message; `undefined` for anything else. A rule
 *  rejection carries an `Uncaught …Error:` line (dev) or a `ConvexError`
 *  `data` (production) and is never infrastructure. */
function infrastructureMessage(message: string): string | undefined {
    if (/Uncaught (?:Convex)?Error:/.test(message)) return undefined;
    if (/timed out|timeout/i.test(message)) return TIMEOUT_MESSAGE;
    if (
        /Failed to fetch|NetworkError|Network request failed|Load failed|Connection lost|WebSocket/i.test(
            message
        )
    ) {
        return NETWORK_MESSAGE;
    }
    if (/Server Error/i.test(message)) return SERVER_ERROR_MESSAGE;
    return undefined;
}

/** Title for a message: friendly text for an infrastructure failure (raw text
 *  goes to the console), else the unwrapped inner message. */
function displayTitle(message: string): string {
    const friendly = infrastructureMessage(message);
    if (friendly === undefined) return shortTitle(message);
    console.error("[mutation-error]", message);
    return friendly;
}

/** The application payload of a `ConvexError`. A PRODUCTION deployment strips
 *  the message of a plain `Error` on its way to the client — the whole envelope
 *  collapses to "Server Error" — but keeps a `ConvexError`'s `data`. Reading it
 *  first is what makes a legality rejection ("Another spell is already being
 *  cast") readable in production instead of an opaque toast. */
export function convexErrorData(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null) return undefined;
    const data = (error as { data?: unknown }).data;
    return typeof data === "string" && data.length > 0 ? data : undefined;
}

/** Extracts the user-facing message from a Convex mutation error. The rest of
 *  the envelope is noise for the user. */
export function extractMutationErrorMessage(error: unknown): string {
    const data = convexErrorData(error);
    if (data) return shortTitle(data);
    if (!(error instanceof Error)) return "Something went wrong";
    return displayTitle(error.message);
}

/** Splits a Convex mutation error into a short toast `title` and the full
 *  `detail` (the entire error message) for copying. */
export function extractMutationError(error: unknown): MutationError {
    const detail = error instanceof Error ? error.message : String(error);
    const data = convexErrorData(error);
    return { title: data ? shortTitle(data) : displayTitle(detail), detail };
}
