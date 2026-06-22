import { useState } from "react";
import { LEGAL_TAGLINE, LEGAL_TITLE } from "@/lib/legal";
import DisclaimerDialog from "./disclaimer-dialog";

/** Lobby footer: short fan-content notice plus a link to the full disclaimer. */
export default function LobbyFooter() {
    const [open, setOpen] = useState(false);

    return (
        <footer className="mt-2 flex flex-col items-center gap-1 pb-4 text-center text-xs text-text-disabled">
            <p>{LEGAL_TAGLINE}</p>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-text-muted underline-offset-2 hover:text-text hover:underline"
            >
                {LEGAL_TITLE}
            </button>
            <DisclaimerDialog open={open} onOpenChange={setOpen} />
        </footer>
    );
}
