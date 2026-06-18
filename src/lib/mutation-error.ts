/** A Convex mutation error split for display: a short `title` for the toast
 *  headline and the full `detail` envelope for the copy-to-clipboard action. */
export type MutationError = { title: string; detail: string };

/** Pull the user-facing inner message out of Convex's verbose envelope:
 *    "[CONVEX M(game:x)] [Request ID: ...] Server Error\nUncaught Error: foo"
 *  Falls back to the whole message when the marker isn't present. */
function shortTitle(message: string): string {
    const match = message.match(/Uncaught Error:\s*([^\n]+)/);
    return (match?.[1] ?? message).trim();
}

/** Extracts the user-facing message from a Convex mutation error. The rest of
 *  the envelope is noise for the user. */
export function extractMutationErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Something went wrong";
    return shortTitle(error.message);
}

/** Splits a Convex mutation error into a short toast `title` and the full
 *  `detail` (the entire error message) for copying. */
export function extractMutationError(error: unknown): MutationError {
    const detail = error instanceof Error ? error.message : String(error);
    return { title: shortTitle(detail), detail };
}
