/** Extracts the user-facing message from a Convex mutation error. Convex wraps
 *  thrown server errors in a verbose envelope like:
 *    "[CONVEX M(game:x)] [Request ID: ...] Server Error\nUncaught Error: foo"
 *  We surface just the inner message — the rest is noise for the user. */
export function extractMutationErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return "Something went wrong";
    const match = error.message.match(/Uncaught Error:\s*([^\n]+)/);
    return (match?.[1] ?? error.message).trim();
}
