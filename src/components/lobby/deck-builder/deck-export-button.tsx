import { useCallback, useState } from "react";
import { copyText } from "~/lib/clipboard";
import { type ExportableDeck, deckToText } from "~/lib/deckImport";
import { Button } from "~/components/ui/button";

interface DeckExportButtonProps {
    // The working deck's two flat piles. Serialized to a portable MTGA /
    // Scryfall decklist and copied to the clipboard — the inverse of Import.
    deck: ExportableDeck;
}

// How long the "Copied" confirmation stays on the button after a successful
// clipboard write.
const COPIED_FEEDBACK_MS = 1500;

/** Export control: copies the current deck as a portable text decklist to the
 *  clipboard. The text carries only names and counts (never the MTG format),
 *  so it round-trips through Import and works across formats (PRD #509). */
export default function DeckExportButton({ deck }: DeckExportButtonProps) {
    const [copied, setCopied] = useState(false);
    const isEmpty = deck.cards.length === 0 && deck.sideboard.length === 0;

    const handleExport = useCallback(async () => {
        await copyText(deckToText(deck));
        setCopied(true);
        setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    }, [deck]);

    return (
        <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={isEmpty}
            title="Copy decklist to clipboard"
        >
            {copied ? "Copied" : "Export"}
        </Button>
    );
}
