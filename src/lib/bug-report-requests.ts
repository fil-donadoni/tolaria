// Open the bug-report dialog from wherever its trigger is rendered (issue #3419).
//
// The dialog is owned ONCE, at the router root (`BugReportHost`), for the
// whole session. Its triggers are not: off the board a floating button sits at
// the router root too, but on the board the trigger lives inside the
// controller surface of the current viewport mode — the desktop pod, the
// landscape strip, or the pause menu the portrait bar opens. Those hosts are
// different subtrees, and the pause menu's content is unmounted the moment the
// menu closes, so no trigger can own the open flag itself. A trigger asks; the
// host opens. Same idiom `anomaly-report.ts` already uses for "Report anomaly".
//
// A bare event, not a store value: the open flag is React state the user also
// changes (they close the dialog), so there is nothing here to hold — only the
// edge of a request.

const listeners = new Set<() => void>();

/** Ask the mounted `BugReportHost` to open the dialog. A no-op with no host. */
export function requestBugReport(): void {
    for (const listener of [...listeners]) listener();
}

export function subscribeBugReportRequests(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** The board's route. It is the one surface whose controller hosts the
 *  trigger, so the router-root floating button stands down there. */
export const BOARD_PATHNAME = "/game";

/** Whether the router-root floating trigger renders on `pathname`: everywhere
 *  except the board. Deliberately not `resolveShellChrome(...).ownChrome` —
 *  the Draft Room owns its chrome too, but carries no controller to host the
 *  trigger, so it keeps the floating one. */
export function bugReportTriggerFloats(pathname: string): boolean {
    return pathname.replace(/\/+$/, "") !== BOARD_PATHNAME;
}
