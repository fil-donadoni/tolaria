import type { ConnectionState } from "convex/browser";
import type { BugReportDiagnostics } from "@convex/bugReportConsent";
import { getStoredSession } from "~/lib/session";
import {
    collectClientDiagnostics,
    describeClientDiagnostics,
    type ClientDiagnostics,
} from "~/lib/diagnostics/client-diagnostics";

/**
 * ONE collector: its return value is both what the disclosure gate previews and
 * what the submission sends (issue #3255). That identity is the point — a
 * hand-written "here is what we collect" list drifts from the code that
 * collects it, and a preview that can disagree with the payload is not a
 * disclosure. The shape itself lives in `convex/bugReportConsent.ts`, shared
 * with the server-side cut, for the same reason.
 *
 * The `clientDiagnostics` half is assembled by
 * `~/lib/diagnostics/client-diagnostics`, which is where the allowlist rule
 * lives (issue #3256).
 */
export function collectDiagnosticPayload(input?: {
    /** `ConvexReactClient.connectionState()`. Read by the caller, because this
     *  module is not the one that holds the client. */
    connection?: ConnectionState;
}): BugReportDiagnostics {
    const { gameId } = getStoredSession();
    return {
        route: window.location.pathname,
        userAgent: navigator.userAgent,
        gameId: gameId ?? undefined,
        clientDiagnostics: collectClientDiagnostics({
            connection: input?.connection,
        }),
    };
}

/**
 * The one-line summary the gate always shows, DERIVED from the payload and from
 * the reporter's current answer rather than written by hand — the same reason
 * the preview renders the payload itself. A field that stops being collected
 * stops being claimed; one that starts being collected has to be named in
 * `describeClientDiagnostics` to compile. And it tracks the checkbox: a summary
 * that keeps promising the board after the reporter declined would contradict
 * the refusal it sits above.
 */
export function describeDiagnosticPayload(
    payload: BugReportDiagnostics,
    accepted: boolean
): string {
    if (!accepted) {
        return "Sending: your description, your name and your email — nothing else.";
    }
    const parts: string[] = [];
    if (payload.route) parts.push("the page you are on");
    if (payload.userAgent) parts.push("your browser identity");
    const diagnostics = payload.clientDiagnostics as
        | ClientDiagnostics
        | undefined;
    if (diagnostics?.build)
        parts.push(...describeClientDiagnostics(diagnostics));
    if (payload.gameId) parts.push("the full board of the game you are in");
    if (parts.length === 0) {
        return "Sending: your description, your name and your email — nothing else.";
    }
    return `Sending with your description, name and email: ${parts.join(", ")}.`;
}
