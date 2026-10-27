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

/** Right-hand padding a route's bottom band reserves at `md` and up, so its
 *  right-most action is never under the floating trigger (issue #7148). The
 *  trigger sits `md:right-4` in the corner on a `size="icon"` plate: 2rem on a
 *  fine pointer, floored to `--touch-min` (44px) on a coarse one (issue
 *  #2792). Clearance = that inset + that plate + a 0.5rem gap. Below `md` the
 *  trigger rides 8.5rem up, clear of any bottom band, so nothing is owed. */
export const FLOATING_TRIGGER_CLEARANCE =
    "md:pr-[calc(1rem+max(2rem,var(--touch-min))+0.5rem)]";
