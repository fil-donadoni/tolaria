// PROTOTYPE (issue #4433) — ephemeral post-ack summary (grill decision 2b):
// client-only, fades after a few seconds, no engine state.
import { isGood, seatName, type ProtoScenario } from "./prototype-scenarios";

function tally(s: ProtoScenario): string {
    const flips = s.rounds.flat();
    if (flips.some((f) => f.outcome === null)) {
        return "";
    }
    const won = flips.filter(isGood).length;
    const lost = flips.length - won;
    const who = seatName(flips[0].flipper);
    return `${who}: ${won} won${lost ? `, ${lost} lost` : ""}`;
}

export default function ProtoSummaryToast({
    scenario,
}: {
    scenario: ProtoScenario;
}) {
    return (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-modal flex justify-center px-4">
            <div className="rounded-lg border border-border bg-surface-elevated/95 px-3 py-2 text-xs text-text shadow-md">
                <span className="text-display">{scenario.sourceName}</span>
                <span className="text-text-muted">
                    {" "}
                    — {tally(scenario) && `${tally(scenario)}. `}
                </span>
                {scenario.consequence}
            </div>
        </div>
    );
}
