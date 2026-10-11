// The active step's content (PRD #5334, issue #5340). Exhaustive over
// `StepKey`: a step the flow walks always renders something.
import type { LobbyDeck } from "~/lib/deckTypes";
import type { MatchSetup, OpenTable, StepKey } from "~/lib/matchSetup";
import MatchFormatStep from "./match-format-step";
import ModeStep from "./mode-step";
import MyDeckStep from "./my-deck-step";
import OpponentDeckStep from "./opponent-deck-step";
import OpponentStep from "./opponent-step";
import TableStep from "./table-step";

export default function MatchSetupStepBody({
    step,
    setup,
    decks,
    tables,
    onChange,
}: {
    step: StepKey;
    setup: MatchSetup;
    decks: readonly LobbyDeck[];
    tables: readonly OpenTable[];
    onChange: (patch: Partial<MatchSetup>, imported?: LobbyDeck) => void;
}) {
    switch (step) {
        case "mode":
            return <ModeStep setup={setup} onChange={onChange} />;
        case "opponent":
            return <OpponentStep setup={setup} onChange={onChange} />;
        case "format":
            return (
                <MatchFormatStep
                    setup={setup}
                    decks={decks}
                    onChange={onChange}
                />
            );
        case "myDeck":
            return (
                <MyDeckStep setup={setup} decks={decks} onChange={onChange} />
            );
        case "opponentDeck":
            return (
                <OpponentDeckStep
                    setup={setup}
                    decks={decks}
                    onChange={onChange}
                />
            );
        case "table":
            return (
                <TableStep setup={setup} tables={tables} onChange={onChange} />
            );
    }
}
