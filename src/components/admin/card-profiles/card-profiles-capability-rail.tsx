import { CAPABILITY_REGISTRY } from "@convex/limited/capabilityRegistry";
import { Button } from "~/components/ui/button";
import type { ScopeCardProfile } from "~/hooks/useCardProfiles";
import { capabilityCounts, type SweepKind } from "./card-profiles-sweep-model";

interface CardProfilesCapabilityRailProps {
    cards: ScopeCardProfile[] | undefined;
    onSweep: (kind: SweepKind, id: string) => void;
}

const CAPABILITY_IDS = CAPABILITY_REGISTRY.map((row) => row.id);
const DESCRIPTION = new Map(
    CAPABILITY_REGISTRY.map((row) => [row.id, row.description])
);

/** The Capabilities tab's rail body: no scope (the layer is catalogue-wide,
 *  issue #8903) — only the closed Capability vocabulary, each row with its
 *  provides / requires counts over the listing and one sweep per side
 *  (issue #8905). */
export default function CardProfilesCapabilityRail({
    cards,
    onSweep,
}: CardProfilesCapabilityRailProps) {
    const rows = capabilityCounts(cards ?? [], CAPABILITY_IDS);
    return (
        <div className="flex flex-col gap-1">
            <span className="text-label">Capability rows</span>
            {rows.map(({ id, provides, requires }) => (
                <div
                    key={id}
                    title={DESCRIPTION.get(id)}
                    className="flex flex-col gap-1 rounded-sm border border-border-subtle/30 px-2 py-1.5 text-xs text-text"
                >
                    <span className="font-mono">{id}</span>
                    <span className="flex flex-wrap items-center gap-1">
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-label={`Sweep Provides ${id}`}
                            onClick={() => onSweep("provides", id)}
                        >
                            {provides} provide
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            aria-label={`Sweep Requires ${id}`}
                            onClick={() => onSweep("requires", id)}
                        >
                            {requires} require
                        </Button>
                    </span>
                </div>
            ))}
        </div>
    );
}
