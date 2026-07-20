import { useState } from "react";
import { LEGAL_TAGLINE, LEGAL_TITLE } from "@/lib/legal";
import { Button } from "@/components/ui/button";
import DisclaimerDialog from "./disclaimer-dialog";

/** Lobby footer: short fan-content notice plus a link to the full disclaimer. */
export default function LobbyFooter() {
    const [open, setOpen] = useState(false);

    return (
        <footer className="mt-2 flex flex-col items-center gap-1 pb-4 text-center text-xs text-text-disabled">
            <p>{LEGAL_TAGLINE}</p>
            <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => setOpen(true)}
            >
                {LEGAL_TITLE}
            </Button>
            <DisclaimerDialog open={open} onOpenChange={setOpen} />
        </footer>
    );
}
