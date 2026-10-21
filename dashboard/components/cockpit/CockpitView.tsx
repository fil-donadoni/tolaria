import type { CockpitState } from "../../lib/cockpit";
import { readingMeta } from "../../lib/cockpit";
import { Shell } from "../Shell";
import { Unavailable } from "../Unavailable";
import { CostPanel } from "./CostPanel";
import { FlakyPanel } from "./FlakyPanel";
import { LandingsPanel } from "./LandingsPanel";
import { LatencyPanel } from "./LatencyPanel";
import { MachinesPanel } from "./MachinesPanel";
import { RedPanel } from "./RedPanel";
import { RunnersPanel } from "./RunnersPanel";
import { ThroughputPanel } from "./ThroughputPanel";

/**
 * The cockpit's one page (issue #5652): throughput and the drain forecast,
 * quality (failed landings, RED episodes, flaky tests), cost per issue,
 * latency, the machines and the runners — over the reading `bun run
 * cockpit` took. A source it could not read is a banner naming what is
 * missing, never an empty panel that reads as "nothing happened".
 */
export function CockpitView({ state }: { state: CockpitState }) {
    if (state.status === "loading")
        return <Shell meta="loading the reading…">{null}</Shell>;
    if (state.status === "failed")
        return (
            <Shell meta="no reading">
                <Unavailable
                    reason={state.reason}
                    consequence="Nothing on this page can be shown until a reading loads."
                />
            </Shell>
        );
    const { reading } = state;
    const t = reading.trends;
    return (
        <Shell meta={readingMeta(reading)}>
            {reading.errors.map((e) => (
                <Unavailable key={e} reason={e} />
            ))}
            {t === null ? (
                <Unavailable
                    reason="GitHub could not be read"
                    consequence="Throughput, quality, cost and latency are missing from this reading — run bun run cockpit again."
                />
            ) : (
                <>
                    <ThroughputPanel trends={t} />
                    <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                        <LandingsPanel trends={t} />
                        <RedPanel trends={t} />
                    </div>
                    <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
                        <CostPanel trends={t} />
                        <div className="flex min-w-0 flex-col gap-4">
                            <LatencyPanel trends={t} />
                            <FlakyPanel trends={t} />
                        </div>
                    </div>
                    <MachinesPanel machines={t.machines} host={reading.host} />
                </>
            )}
            {reading.runners === null ? (
                <Unavailable
                    reason="GitHub's runner list could not be read"
                    consequence="Which machine is idle, busy or offline is unknown."
                />
            ) : (
                <RunnersPanel runners={reading.runners} />
            )}
        </Shell>
    );
}
