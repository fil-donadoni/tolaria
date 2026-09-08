// Reading the message a Convex mutation actually threw out of `convex run`
// stderr (issue #3174).
//
// Convex wraps a thrown message in framing, and every layer of it sorts BEFORE
// the message in the output:
//
//     ✖ Failed to run function "decks:seedPresetDirect":      ← banner
//     Error: [Request ID: 52e1…] Server Error                  ← transport
//     Uncaught Error: slug mismatch: canonical list says …     ← the message
//         at handler (../convex/decks.ts:519:16)               ← stack
//
// Both seeding CLIs used to take the FIRST line naming an error, so both
// printed framing and neither printed the cause — which is why "Server Error"
// seeding failures were folklore rather than diagnosis. The innermost throw is
// the LAST error-bearing line, so that is what this returns, stripped of the
// `Uncaught Error:` prefix and of the request id.
//
// One implementation, both callers: two copies drifting is what produced the
// worse of the two, and any future `convex run` wrapper inherits this rather
// than hand-rolling a third.

/** `Error:`, `Uncaught Error:`, `Uncaught ConvexError:`, … */
const ERROR_PREFIX_RE = /^(?:Uncaught\s+)?(?:[A-Za-z_$][\w$]*)?Error:\s*/;
/** Stack frames carry the throw SITE, which the operator did not ask for. */
const STACK_FRAME_RE = /^at\s/;
/** The transport line's only payload, and it identifies nothing. */
const REQUEST_ID_RE = /\[Request ID:\s*[^\]]*\]\s*/g;

function strip(line: string): string {
    return line.replace(ERROR_PREFIX_RE, "").replace(REQUEST_ID_RE, "").trim();
}

/**
 * The message the mutation threw, or the best line available when the output
 * carries no throw at all (a spawn failure, a CLI usage error, an empty pipe).
 * Never throws and never returns an empty string.
 */
export function convexRunErrorMessage(text: string, maxLength = 300): string {
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    const body = lines.filter((l) => !STACK_FRAME_RE.test(l));

    // LAST, not first: the innermost throw is the one that says why. Convex's
    // transport line matches too, and losing to the cause is the whole fix.
    const thrown = body.filter((l) => ERROR_PREFIX_RE.test(l));
    const chosen = thrown[thrown.length - 1];
    if (chosen) {
        const message = strip(chosen);
        if (message) return message.slice(0, maxLength);
    }

    const fallback =
        body[body.length - 1] ?? lines[lines.length - 1] ?? "unknown failure";
    return fallback.slice(0, maxLength);
}
