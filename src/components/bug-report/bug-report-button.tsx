import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    ABOVE_CONTROLLER_BAR,
    BESIDE_CONTROLLER_STRIP,
} from "~/lib/controller-bar-metrics";
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
                //
                // Horizontally it anchors {@link BESIDE_CONTROLLER_STRIP}
                // rather than a flat `right-3`: that constant's own `0px`
                // fallback evaluates to the SAME 12px `right-3` used when no
                // strip is mounted (portrait, desktop, lobby), but slides
                // clear of the landscape-compact control strip (#1769) when
                // it IS mounted — ungated, this button used to float under
                // the strip's own Pass Turn button (#1770 follow-up from
                // #1802's review).
                className={`fixed ${ABOVE_CONTROLLER_BAR} ${BESIDE_CONTROLLER_STRIP} z-dev-overlay rounded-full shadow-md md:bottom-4 md:right-4`}
            >
                <Bug />
            </Button>
            <BugReportDialog open={open} onOpenChange={setOpen} />
        </>
    );
}
