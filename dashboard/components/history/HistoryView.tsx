import { Unavailable } from "../Unavailable";
import { useHistoryData } from "../../lib/historyData";
import { useHistoryMeta } from "../../lib/historyState";
import { FamiliesCard } from "./FamiliesCard";
import { HistoryFilters } from "./HistoryFilters";
import { HistoryTiles } from "./HistoryTiles";
import { IssuesCard } from "./IssuesCard";
import { MetricsCard } from "./MetricsCard";
import { OverTimeCard } from "./OverTimeCard";
import { RankingCard } from "./RankingCard";
import { SessionsCard } from "./SessionsCard";

/**
 * The History view (PRD #3148 S3) — the composition root that replaces
 * `scripts/dashboard/history-boot.js` and the six cards it filled by id.
 *
 * ── THIS MODULE IS THE LAZY BOUNDARY ──────────────────────────────────────
 *
 * It is the DEFAULT export because `React.lazy` takes a module whose default
 * is a component, and `App.tsx` reaches it through exactly one dynamic
 * `import()`. Everything store-backed hangs off this file: the transport
 * (`historyQuery.ts`), the orchestrator, the colour seeding, all six cards.
 * Nothing above it may import any of them statically.
 *
 * That is not a preference, it is #2519's guarantee: the Now view must come up
 * with no `telemetry.db` at all, and a static edge from the chrome into this
 * graph would put `/api/meta` on the critical path of a page load that only
 * wanted the loop status. `telemetry-serve.test.ts` crawls the React import
 * graph from `dashboard/main.tsx` and asserts no file in it names a DB-backed
 * route and no file in it is a History module.
 *
 * ── ORDER IS THE ARGUMENT ─────────────────────────────────────────────────
 *
 * The filter bar and the tiles first, because they say what slice everything
 * below is about; then the two charts, which are the SHAPE of that slice; then
 * the metric table, which is the same rows as numbers; then the three
 * narrative cards, which are the same spend attributed to issues, sessions and
 * families. A reader who stops after the tiles has the headline.
 */
export default function HistoryView() {
    const {
        booted,
        bootstrapError,
        charts,
        chartsError,
        narrative,
        narrativeError,
    } = useHistoryData();
    const meta = useHistoryMeta();

    if (bootstrapError)
        return (
            <Unavailable
                reason={`no telemetry store: ${bootstrapError}`}
                consequence={
                    'Nothing in this view can be shown. Run "bun run telemetry:ingest" to build it; the Now view is unaffected.'
                }
            />
        );

    if (!booted || !meta)
        return (
            <p className="text-muted-foreground text-xs">
                reading the telemetry store…
            </p>
        );

    return (
        <>
            <HistoryFilters meta={meta} />
            {charts ? <HistoryTiles meta={meta} charts={charts} /> : null}
            <OverTimeCard charts={charts} error={chartsError} />
            <RankingCard charts={charts} error={chartsError} />
            <MetricsCard charts={charts} error={chartsError} />
            <IssuesCard
                payload={narrative?.issues ?? null}
                error={narrativeError}
            />
            <SessionsCard
                payload={narrative?.sessions ?? null}
                error={narrativeError}
            />
            <FamiliesCard
                payload={narrative?.families ?? null}
                error={narrativeError}
            />
        </>
    );
}
