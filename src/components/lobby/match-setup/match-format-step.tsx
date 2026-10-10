// Step 3 — Match Format + Games Format (PRD #5334 stories 22–25, ADR 0153):
// every playable Format with how many decks it admits, then Bo1/Bo3.
import type { LobbyDeck } from "~/lib/deckTypes";
import { matchFormatOptions, type MatchSetup } from "~/lib/matchSetup";
import GamesFormatSelector from "../games-format-selector";
import SetupChoice from "./setup-choice";

export default function MatchFormatStep({
    setup,
    decks,
    onChange,
}: {
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    return (
        <div className="flex flex-col gap-4">
            <div
                role="group"
                aria-label="Match Format"
                className="flex flex-wrap gap-2"
            >
                {matchFormatOptions(decks).map((o) => (
                    <SetupChoice
                        key={o.format}
                        title={o.label}
                        hint={o.hint}
                        selected={setup.matchFormat === o.format}
                        onSelect={() => onChange({ matchFormat: o.format })}
                    />
                ))}
            </div>
            <GamesFormatSelector
                value={setup.gamesFormat}
                onChange={(gamesFormat) => onChange({ gamesFormat })}
            />
        </div>
    );
}
