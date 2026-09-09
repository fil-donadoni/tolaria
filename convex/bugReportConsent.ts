import type { Id } from "./_generated/dataModel";

/**
 * The bug-report disclosure's version — issue #3255.
 *
 * A consent is a consent to a SPECIFIC payload. When the diagnostic payload
 * widens (issue #3256 is already queued to widen it), this number rises, and
 * every account whose stored version is behind is shown the gate again before
 * its next report carries diagnostics. That is the whole mechanism: re-asking
 * is derived from a comparison, never remembered by hand.
 *
 * Pure module, no Convex imports — the dialog (`src/components/bug-report/`)
 * and the `bugReports` functions read the SAME constant, so a bump cannot
 * reach one side and not the other (ADR 0074: the frontend may import pure
 * modules from `convex/`, it just never holds authority).
 */
export const BUG_REPORT_CONSENT_VERSION = 1;

/** Whether the gate must be shown un-pre-accepted: no stored consent at all,
 *  or one given against an older, narrower payload. */
export function bugReportConsentIsCurrent(
    storedVersion: number | undefined
): boolean {
    return storedVersion === BUG_REPORT_CONSENT_VERSION;
}

/**
 * The diagnostic payload a bug report may carry — everything BEYOND the
 * reporter's own words, contact details and the file they picked themselves.
 *
 * Declared here, in the pure module both sides read, because there are exactly
 * two of them and they must not drift: the dialog previews this object and
 * spreads it into the submission, and the server re-derives the same cut from
 * it (`applyDiagnosticsConsent`). A hand-copied second shape is how a field
 * ends up collected on one side and undisclosed on the other.
 *
 * Every field optional: the payload is what the gate DISCLOSES, and a report
 * filed from the lobby has no game, a declined one has nothing at all.
 */
export type BugReportDiagnostics = {
    /** Page the reporter was on. */
    route?: string;
    /** Browser identity string. */
    userAgent?: string;
    /** The game the reporter is sitting in. An id, not a board — the state is
     *  read server-side and only for a participant, but in a two-player game
     *  that state includes the opponent's hidden zones, which is why the gate
     *  names it explicitly. */
    gameId?: Id<"games">;
    /** The client-hosted play bot's decision and escalation rings (issue
     *  #2470). `unknown`: it is evidence for a human, stored verbatim and never
     *  parsed, so its shape may move on without breaking a report. */
    clientDiagnostics?: unknown;
};
