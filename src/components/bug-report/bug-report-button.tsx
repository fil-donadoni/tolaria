import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ABOVE_CONTROLLER_BAR } from "~/lib/controller-bar-metrics";
import BugReportDialog from "./bug-report-dialog";

/**
 * Global floating entry point for the bug-report flow. Mounted once at the
 * router root so it is available on every route (lobby, deck builder, in-game).
 * Owns the dialog's open state; the form itself lives in `BugReportDialog`.
 */
export default function BugReportButton() {
    const [open, setOpen] = useState(false);

    return (
        <>
            <Button
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Report a bug"
                title="Report a bug"
                onClick={() => setOpen(true)}
                // Bottom-RIGHT. Below md, anchored to the portrait bottom
                // bar's MEASURED height ({@link ABOVE_CONTROLLER_BAR},
                // #1759/#1764) instead of the old fixed `bottom-32` — that
                // inset was correct only for the bar's one-line state, and
                // the grown (two-line, DECLARE_ATTACKERS) bar covered this
                // button. `z-dev-overlay` (not `z-sheet`) keeps it strictly
                // below any open bottom sheet or modal: this button mounts at
                // the router root AFTER the board, so an equal z-index still
                // wins DOM-order ties and painted over the phase sheet,
                // eating taps meant for the sheet's own controls (#1764).
                className={`fixed ${ABOVE_CONTROLLER_BAR} right-3 z-dev-overlay rounded-full shadow-md md:bottom-4 md:right-4`}
            >
                <Bug />
            </Button>
            <BugReportDialog open={open} onOpenChange={setOpen} />
        </>
    );
}
