// Step 2 — Opponent (PRD #5334 stories 20–21): who sits in the other seat.
import {
    OFFERED_OPPONENTS,
    opponentLabel,
    opponentUnavailableReason,
    type MatchSetup,
    type Opponent,
} from "~/lib/matchSetup";
import SetupChoice from "./setup-choice";

const HINT: Record<Opponent, string> = {
    bot: "The Bot plays the other seat",
    solo: "You play both seats",
    host: "Open a table for another player",
    join: "Sit at someone's open table",
};

export default function OpponentStep({
    setup,
    onChange,
}: {
    setup: MatchSetup;
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    return (
        <div
            role="group"
            aria-label="Opponent"
            className="flex flex-wrap gap-2"
        >
            {OFFERED_OPPONENTS.map((o) => {
                const refusal = opponentUnavailableReason(setup.mode, o);
                return (
                    <SetupChoice
                        key={o}
                        title={opponentLabel(o)}
                        hint={refusal ?? HINT[o]}
                        selected={setup.opponent === o}
                        disabled={refusal !== null}
                        onSelect={() => onChange({ opponent: o })}
                    />
                );
            })}
        </div>
    );
}
