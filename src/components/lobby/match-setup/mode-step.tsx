// Step 1 — Game mode (PRD #5334 story 19): the rules engine on (Arena) or off
// (Cockatrice, Manual decks).
import type { GameMode, MatchSetup } from "~/lib/matchSetup";
import SetupChoice from "./setup-choice";

const OPTIONS: { mode: GameMode; title: string; hint: string }[] = [
    { mode: "arena", title: "Arena", hint: "The engine enforces the rules" },
    {
        mode: "cockatrice",
        title: "Cockatrice",
        hint: "Free table, Manual decks — you call the rules",
    },
];

export default function ModeStep({
    setup,
    onChange,
}: {
    setup: MatchSetup;
    onChange: (patch: Partial<MatchSetup>) => void;
}) {
    return (
        <div className="flex flex-wrap gap-2">
            {OPTIONS.map((o) => (
                <SetupChoice
                    key={o.mode}
                    title={o.title}
                    hint={o.hint}
                    selected={setup.mode === o.mode}
                    onSelect={() => onChange({ mode: o.mode })}
                />
            ))}
        </div>
    );
}
