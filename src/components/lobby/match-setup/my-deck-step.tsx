// Step 4 — Your deck (PRD #5334 stories 29–35, issue #5341): the grid of the
// decks the effective Match Format admits.
import type { LobbyDeck } from "~/lib/deckTypes";
import { effectiveMatchFormat, type MatchSetup } from "~/lib/matchSetup";
import DeckGrid from "./deck-grid";

export default function MyDeckStep({
    setup,
    decks,
    onChange,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    const matchFormat = effectiveMatchFormat(setup);
    // Unreachable through the rail: every branch answers the Match Format
    // (or inherits it) before step 4 opens.
    if (matchFormat === null) return null;
    return (
        <DeckGrid
            decks={decks}
            matchFormat={matchFormat}
            selectedId={setup.myDeckId}
            onSelect={(myDeckId) => onChange({ myDeckId })}
        />
    );
}
