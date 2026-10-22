// Step 2 — Pack Source (PRD #5383, prototype setup variant B): the selected
// source as a large hero with previous/next controls and a thumbnail strip.
// Under Sealed the cube stays in the strip, disabled with its reason.
import type { PackSourceInfo } from "~/hooks/useLimitedEvent";
import {
    adjacentSelectableSource,
    sourceDisabledReason,
    type LimitedSetup,
} from "~/lib/limited/limitedSetup";
import { Banner } from "~/components/ui/banner";
import CubeAvailabilityNote from "../cube-availability-note";
import IncompletenessNotice from "../incompleteness-notice";
import LimitedPackSourceHero from "./limited-pack-source-hero";
import LimitedPackSourceThumb from "./limited-pack-source-thumb";

export default function LimitedSetupSourceStep({
    setup,
    sources,
    note,
    onChange,
    onAdvance,
}: {
    setup: LimitedSetup;
    sources: readonly PackSourceInfo[];
    /** The fallback note for a remembered source that is gone. */
    note: string | null;
    onChange: (patch: Partial<LimitedSetup>) => void;
    /** Called after a thumbnail pick — the hero's arrows only browse. */
    onAdvance?: () => void;
}) {
    const selected = sources.find((s) => s.key === setup.packSource);
    if (sources.length === 0 || !selected) {
        return (
            <p className="text-sm text-text-muted">
                No Pack Sources available yet.
            </p>
        );
    }
    const step = (delta: 1 | -1) => {
        const next = adjacentSelectableSource(
            sources,
            setup.type,
            setup.packSource,
            delta
        );
        if (next) onChange({ packSource: next.key });
    };
    const cube = selected.sets.find((s) => s.isCube === true);
    return (
        <div className="flex flex-col gap-3">
            {note && (
                <Banner tone="info" role="status">
                    {note}
                </Banner>
            )}
            <LimitedPackSourceHero
                source={selected}
                onPrevious={() => step(-1)}
                onNext={() => step(1)}
            />
            <div
                role="group"
                aria-label="Pack Source"
                className="flex gap-2 overflow-x-auto pb-1"
            >
                {sources.map((source) => {
                    const reason = sourceDisabledReason(source, setup.type);
                    return (
                        <LimitedPackSourceThumb
                            key={source.key}
                            source={source}
                            selected={source.key === setup.packSource}
                            disabledReason={reason}
                            onSelect={() => {
                                onChange({ packSource: source.key });
                                onAdvance?.();
                            }}
                        />
                    );
                })}
            </div>
            {selected.sets.map((set) => (
                <IncompletenessNotice key={set.setCode} set={set} />
            ))}
            <CubeAvailabilityNote set={cube} />
        </div>
    );
}
