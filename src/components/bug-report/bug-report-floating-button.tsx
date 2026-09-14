import { useRouterState } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "~/lib/utils";
import { bugReportTriggerFloats } from "~/lib/bug-report-requests";
import BugReportButton from "./bug-report-button";

/**
 * The global floating bug-report trigger, mounted at the router root for every
 * route EXCEPT the board (issue #3419): there the controller surface hosts the
 * trigger, and a free-floating button sat over the play area with no home.
 *
 * Bottom-right, at the exact inset it has always had off the board — 8.5rem up
 * below `md` (clear of the phone lobby's bottom nav), 1rem at `md` and above.
 * Those used to be spelled through the controller bar/strip seams, whose CSS
 * variables are never set on a route with no controller, so the fallbacks were
 * the whole value. `z-dev-overlay` (not `z-sheet`) keeps it strictly below any
 * open bottom sheet or modal: it mounts at the router root AFTER the route's
 * content, so an equal z-index would still win DOM-order ties (#1764).
 */
export default function BugReportFloatingButton() {
    const pathname = useRouterState({
        select: (state) => state.location.pathname,
    });
    if (!bugReportTriggerFloats(pathname)) return null;
    return (
        <BugReportButton
            className={cn(
                buttonVariants({ variant: "secondary", size: "icon" }),
                "fixed bottom-[8.5rem] right-3 z-dev-overlay rounded-full shadow-md md:bottom-4 md:right-4"
            )}
        />
    );
}
