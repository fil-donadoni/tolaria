import * as Sentry from "@sentry/react";

/**
 * The correlation identifier that joins a bug report to the continuously
 * collected third-party trace (issue #3256).
 *
 * Sentry already receives this session's console output and every uncaught
 * error — that is what the consent gate discloses (issue #3255). What was
 * missing is any way to FIND that session from the report: a maintainer holding
 * a report row and a Sentry project could only line them up by guessing at
 * timestamps.
 *
 * The trace id is the join key. It is an opaque correlation handle, not
 * personal data and not a credential — searching `trace:<id>` in Sentry lands
 * on the same session the row describes. `lastEventId` is added when there IS
 * one, because an event id points at a specific captured error rather than at
 * the session around it, and that is a strictly better starting point when a
 * crash is what the report is about.
 *
 * This issue records the identifier and nothing else: it does not change what
 * the SDK collects, which integrations run, or whether it runs at all.
 */
export type MonitoringRef = {
    /** Sentry trace id for this session — search `trace:<id>`. */
    traceId?: string;
    /** The last event Sentry captured, when one was captured. */
    lastEventId?: string;
};

export function collectMonitoringRef(): MonitoringRef | undefined {
    const ref: MonitoringRef = {};
    try {
        const traceId =
            Sentry.getCurrentScope().getPropagationContext().traceId;
        if (traceId) ref.traceId = traceId;
    } catch {
        // The SDK is not initialised (a test, a self-hosted build with
        // monitoring stripped). Absent, never faked.
    }
    try {
        const eventId = Sentry.lastEventId();
        if (eventId) ref.lastEventId = eventId;
    } catch {
        // Absent.
    }
    return Object.keys(ref).length > 0 ? ref : undefined;
}
