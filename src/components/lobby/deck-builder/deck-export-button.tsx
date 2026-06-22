import { useCallback, useState } from "react";
import { copyText } from "~/lib/clipboard";
import { type ExportableDeck, deckToText } from "~/lib/deckImport";

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
        <button
            type="button"
            onClick={handleExport}
            disabled={isEmpty}
            className="btn-base btn-tone-ghost px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            title="Copy decklist to clipboard"
        >
            {copied ? "Copied" : "Export"}
        </button>
    );
}
