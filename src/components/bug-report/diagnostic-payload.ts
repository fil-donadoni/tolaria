import type { Id } from "@convex/_generated/dataModel";
import { getStoredSession } from "~/lib/session";
import { collectAiDiagnostics, type AiDiagnostics } from "~/lib/ai/diagnostics";

/**
 * Everything a bug report carries BEYOND the reporter's own words and contact
 * details — the diagnostic payload the disclosure gate asks about (issue
 * #3255).
 *
 * `gameId` is an id, not a board: the state itself is read server-side and only
 * for a participant of that game. It is still the heaviest thing here, because
 * in a two-player game the state the server attaches includes the opponent's
 * hidden zones — which is why the gate names it explicitly.
 */
export type BugReportDiagnostics = {
    /** Page the reporter was on. */
    route: string;
    /** Browser identity string. */
    userAgent: string;
    /** The game the reporter is sitting in, if any. */
    gameId?: Id<"games">;
    /** The client-hosted play bot's decision and escalation rings (issue
     *  #2470) — absent when there is nothing to say. */
    clientDiagnostics?: AiDiagnostics;
};

/**
 * ONE collector, called by the dialog when it opens: its return value is both
 * what the preview renders and what the submission sends. That identity is the
 * point — a hand-written "here is what we collect" list drifts from the code
 * that collects it, and a preview that can disagree with the payload is not a
 * disclosure.
 *
 * Read when the dialog OPENS rather than at mount: this dialog is mounted at
 * the router root for the whole session, so a value captured at mount would go
 * stale the moment the user starts a different game. Reading it at open (and
 * not again at submit) also means the reporter consents to exactly the payload
 * they were shown.
 */
export function collectDiagnosticPayload(): BugReportDiagnostics {
    const { gameId } = getStoredSession();
    return {
        route: window.location.pathname,
        userAgent: navigator.userAgent,
        gameId: gameId ?? undefined,
        clientDiagnostics: collectAiDiagnostics(),
    };
}

/**
 * The one-line summary the dialog always shows, DERIVED from the payload
 * rather than written by hand — the same reason the preview renders the payload
 * itself. A field that stops being collected stops being claimed, and one that
 * starts being collected has to be named here to compile.
 */
export function describeDiagnosticPayload(
    payload: BugReportDiagnostics
): string {
    const parts = ["the page you are on", "your browser identity"];
    if (payload.clientDiagnostics) parts.push("the AI decision log");
    if (payload.gameId) parts.push("the full board of the game you are in");
    return `Sending with your description, name and email: ${parts.join(", ")}.`;
}
