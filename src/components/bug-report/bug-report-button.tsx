import { useState } from "react";
import { Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
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
                className="z-sheet fixed bottom-4 left-4 rounded-full shadow-md"
            >
                <Bug />
            </Button>
            <BugReportDialog open={open} onOpenChange={setOpen} />
        </>
    );
}
