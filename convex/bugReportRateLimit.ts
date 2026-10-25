/**
 * Bug-report rate limit (issue #4076): at most `REPORT_LIMIT` reports per user
 * in any rolling `REPORT_WINDOW_MS`. Protects the shared Resend budget
 * (password-reset codes) and the public tracker from an unbounded stream.
 *
 * Pure module, no Convex imports — the server enforces it, the dialog reads
 * the typed error's shape (ADR 0074: the frontend may import pure modules from
 * `convex/`, it just never holds authority).
 */
export const REPORT_LIMIT = 5;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;
export const REPORT_RATE_LIMITED_CODE = "REPORT_RATE_LIMITED";

/** Payload of the `ConvexError` thrown on a refused report. A plain `Error`
 *  message is stripped on the wire; `data` survives. */
export type ReportRateLimitedData = {
    code: typeof REPORT_RATE_LIMITED_CODE;
    /** Epoch ms from which the user may report again. */
    retryAt: number;
};

/**
 * `createdAt` are the creation times of the user's reports that fall inside
 * the window ending at `now` (any order). Returns `null` when one more report
 * is allowed, else the instant the oldest report that still blocks it leaves
 * the window — the first moment a slot is free.
 */
export function reportRetryAt(
    createdAt: readonly number[],
    now: number
): number | null {
    const inWindow = createdAt
        .filter((t) => t > now - REPORT_WINDOW_MS)
        .sort((a, b) => a - b);
    if (inWindow.length < REPORT_LIMIT) return null;
    return inWindow[inWindow.length - REPORT_LIMIT]! + REPORT_WINDOW_MS;
}

export function isReportRateLimitedData(
    data: unknown
): data is ReportRateLimitedData {
    return (
        typeof data === "object" &&
        data !== null &&
        (data as { code?: unknown }).code === REPORT_RATE_LIMITED_CODE &&
        typeof (data as { retryAt?: unknown }).retryAt === "number"
    );
}
