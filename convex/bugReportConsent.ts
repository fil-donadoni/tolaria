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
