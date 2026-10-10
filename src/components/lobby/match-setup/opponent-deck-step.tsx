// Step 5 — the Bot's deck and difficulty, or the second seat's deck in Solo
// (PRD #5334 stories 36–39, issue #5341). Same grid as step 4, with Mirror
// always offered — and preselected when nothing is stored (`EMPTY_SETUP`).
import type { LobbyDeck } from "~/lib/deckTypes";
import { effectiveMatchFormat, type MatchSetup } from "~/lib/matchSetup";
import DifficultySelector from "../difficulty-selector";
import DeckGrid from "./deck-grid";

export default function OpponentDeckStep({
    setup,
    decks,
    onChange,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    const matchFormat = effectiveMatchFormat(setup);
    if (matchFormat === null) return null;
    const mirror = setup.opponentDeckChosen && setup.opponentDeckId === null;
    return (
        <div className="flex flex-col gap-4">
            {setup.opponent === "bot" && (
                <DifficultySelector
                    value={setup.difficulty}
                    onChange={(difficulty) => onChange({ difficulty })}
                />
            )}
            <DeckGrid
                decks={decks}
                matchFormat={matchFormat}
                selectedId={
                    setup.opponentDeckChosen ? setup.opponentDeckId : null
                }
                onSelect={(opponentDeckId) =>
                    onChange({ opponentDeckId, opponentDeckChosen: true })
                }
                mirror={{
                    selected: mirror,
                    onSelect: () =>
                        onChange({
                            opponentDeckId: null,
                            opponentDeckChosen: true,
                        }),
                }}
            />
        </div>
    );
}
