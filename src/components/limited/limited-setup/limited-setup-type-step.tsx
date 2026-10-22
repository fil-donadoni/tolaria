// Step 1 — Type (PRD #5383): Draft or Sealed.
import type { LimitedSetup } from "~/lib/limited/limitedSetup";
import SetupChoice from "~/components/lobby/match-setup/setup-choice";

const OPTIONS = [
    {
        type: "draft",
        title: "Draft",
        hint: "Pick cards from packs passed around the table",
    },
    {
        type: "sealed",
        title: "Sealed",
        hint: "Build from boosters opened for you",
    },
] as const;

export default function LimitedSetupTypeStep({
    setup,
    onChange,
    onAdvance,
}: {
    setup: LimitedSetup;
    onChange: (patch: Partial<LimitedSetup>) => void;
    onAdvance?: () => void;
}) {
    return (
        <div
            role="group"
            aria-label="Event Type"
            className="flex flex-wrap gap-2"
        >
            {OPTIONS.map((o) => (
                <SetupChoice
                    key={o.type}
                    title={o.title}
                    hint={o.hint}
                    selected={setup.type === o.type}
                    onSelect={() => {
                        onChange({ type: o.type });
                        onAdvance?.();
                    }}
                />
            ))}
        </div>
    );
}
