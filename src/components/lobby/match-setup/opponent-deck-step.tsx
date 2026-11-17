// Step 5 — the Bot's deck, or the second seat's deck in Solo (PRD #5334
// stories 36–39, issue #5341). Same grid as step 4, with Mirror always offered
// — and preselected when nothing is stored (`EMPTY_SETUP`). No difficulty: the
// Bot plays `expert` (issue #10113).
import type { LobbyDeck } from "~/lib/deckTypes";
import { BOT_KNOWS_DECKLIST_LINE } from "~/lib/difficultyLabels";
import { effectiveMatchFormat, type MatchSetup } from "~/lib/matchSetup";
import DeckGrid from "./deck-grid";

export default function OpponentDeckStep({
    setup,
    decks,
    onChange,
    onLoadMoreArchived,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    onChange: (patch: Partial<MatchSetup>, imported?: LobbyDeck) => void;
    onLoadMoreArchived?: () => void;
}) {
    const matchFormat = effectiveMatchFormat(setup);
    if (matchFormat === null) return null;
    const mirror = setup.opponentDeckChosen && setup.opponentDeckId === null;
    return (
        <div className="flex flex-col gap-4">
            {setup.opponent === "bot" && (
                <span className="text-[11px] text-text-muted">
                    {BOT_KNOWS_DECKLIST_LINE}
                </span>
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
                onImported={(deck) =>
                    onChange(
                        {
                            opponentDeckId: deck.presetId,
                            opponentDeckChosen: true,
                        },
                        deck
                    )
                }
                onLoadMoreArchived={onLoadMoreArchived}
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
