// The "Import deck" button of steps 4 and 5 (issue #5343): opens the strict
// import dialog.
import { useState } from "react";
import type { FormatId } from "@convex/formats";
import { Button } from "~/components/ui/button";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import ImportDeckDialog from "./import-deck-dialog";

export default function ImportDeckAction({
    matchFormat,
    onImported,
}: {
    matchFormat: FormatId;
    onImported: (deck: UserLobbyDeck) => void;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(true)}
            >
                Import deck
            </Button>
            {open && (
                <ImportDeckDialog
                    open={open}
                    onOpenChange={setOpen}
                    matchFormat={matchFormat}
                    onImported={onImported}
                />
            )}
        </>
    );
}
