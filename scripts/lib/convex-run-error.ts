// Reading the message a Convex mutation actually threw out of `convex run`
// stderr (issue #3174).
//
// Convex wraps a thrown message in three layers of contentless framing, and
// every one of them sorts BEFORE the message in the output:
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
// `Uncaught Error:` prefix and the request id.
//
// One implementation, both callers: two copies drifting is what produced the
// worse of the two, and any future `convex run` wrapper inherits this rather
// than hand-rolling a third.

/** Convex's own headline — names the function, never the failure. */
const BANNER_RE = /^[✖✗x]\s*Failed to run function\b/i;
/** Stack frames carry the throw SITE, which the operator did not ask for. */
const STACK_FRAME_RE = /^at\s/;
/** `Error:`, `Uncaught Error:`, `Uncaught ConvexError:`, … */
const ERROR_PREFIX_RE = /^(?:Uncaught\s+)?(?:[A-Za-z_$][\w$]*)?Error:\s*/;
/** The transport line's only payload, and it identifies nothing. */
const REQUEST_ID_RE = /\[Request ID:\s*[^\]]*\]\s*/g;
/** What is left of the transport line once its framing is stripped. */
const CONTENTLESS = new Set(["server error", "uncaught", ""]);

function strip(line: string): string {
    return line.replace(REQUEST_ID_RE, "").replace(ERROR_PREFIX_RE, "").trim();
}

function isContentful(line: string): boolean {
    return !CONTENTLESS.has(line.toLowerCase());
}

/**
 * The message the mutation threw, or the best available line when the output
 * carries no throw at all (a spawn failure, a CLI usage error, an empty pipe).
 * Never throws and never returns an empty string.
 */
export function convexRunErrorMessage(text: string, maxLength = 300): string {
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    const framed = lines.filter(
        (l) => !BANNER_RE.test(l) && !STACK_FRAME_RE.test(l)
    );
    const thrown = framed
        .filter((l) => ERROR_PREFIX_RE.test(l))
        .map(strip)
        .filter(isContentful);
    if (thrown.length > 0) return thrown[thrown.length - 1].slice(0, maxLength);

    const remaining = framed.map(strip).filter(isContentful);
    if (remaining.length > 0)
        return remaining[remaining.length - 1].slice(0, maxLength);

    // Nothing but framing. The banner at least names the function that
    // refused; the transport line names nothing at all, so it loses even here.
    const banner = lines.filter((l) => BANNER_RE.test(l));
    const fallback =
        banner[banner.length - 1] ??
        lines[lines.length - 1] ??
        "unknown failure";
    return fallback.slice(0, maxLength);
}
