// The active step's content (PRD #5383). Exhaustive over `LimitedStepKey`.
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import type { LimitedSetup, LimitedStepKey } from "~/lib/limited/limitedSetup";
import LimitedSetupSourceStep from "./limited-setup-source-step";
import LimitedSetupTableStep from "./limited-setup-table-step";
import LimitedSetupTypeStep from "./limited-setup-type-step";

export default function LimitedSetupStepBody({
    step,
    setup,
    sources,
    note,
    onChange,
    onAdvance,
}: {
    step: LimitedStepKey;
    setup: LimitedSetup;
    sources: readonly PackSourceInfo[];
    note: string | null;
    onChange: (patch: Partial<LimitedSetup>) => void;
    /** Opens the following step; absent on a multi-control or last step. */
    onAdvance?: () => void;
}) {
    switch (step) {
        case "type":
            return (
                <LimitedSetupTypeStep
                    setup={setup}
                    onChange={onChange}
                    onAdvance={onAdvance}
                />
            );
        case "packSource":
            return (
                <LimitedSetupSourceStep
                    setup={setup}
                    sources={sources}
                    note={note}
                    onChange={onChange}
                    onAdvance={onAdvance}
                />
            );
        case "table":
            return (
                <LimitedSetupTableStep
                    setup={setup}
                    sources={sources}
                    onChange={onChange}
                />
            );
    }
}
