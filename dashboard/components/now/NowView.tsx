import { VerdictBand } from "./VerdictBand";
import { Lights } from "./Lights";
import { Timeline } from "./Timeline";
import { ActivitySection } from "./ActivitySection";
import { DriverSection } from "./DriverSection";
import { QueueSection } from "./QueueSection";
import { BatchSection } from "./BatchSection";
import { ClaimsTable } from "./ClaimsTable";
import { LiveSessions } from "./LiveSessions";
import { TailDrawer } from "./TailDrawer";
import { ConfirmDialog } from "./ConfirmDialog";
import { nowSubtitleText } from "../../lib/nowLights";
import { refreshLoopStatus, useLoopStatus } from "../../lib/loopStatus";

/**
 * The Now view (PRD #3148 S2) — the composition root that replaces
 * `scripts/dashboard/now.js`.
 *
 * ORDER IS THE ARGUMENT (PRD #2621 D2): the verdict first, because it is the
 * one health statement; then the four lights, each a fact about its own
 * subsystem; then the 24-hour strip and the hourly chart, which say what
 * HAPPENED; then the detail sections the lights point at, then the claims and
 * the sessions working them. An operator who reads only the first two rows has
 * the answer; everything below is the evidence.
 *
 * ONE PAYLOAD, ONE COMPOSITION. `now.js` was written because a second renderer
 * beside the first would have put two compositions of the same payload on one
 * screen, free to disagree. That reasoning survives verbatim: everything below
 * reads `useLoopStatus()`'s snapshot, including the clock it was composed
 * against.
 *
 * THE SUBTITLE keeps the RAW driver facts; the band states what they MEAN.
 * Before #2624 that line was the only health signal on the page, and it
 * rendered the eight-hour outage of 2026-08-19 as `armed · no driver pid · no
 * stop-file` — three equal grey clauses, no cause and no remedy.
 *
 * The drawer and the confirmation dialog are mounted HERE, beside the
 * sections rather than inside one, because both outlive whatever raised them:
 * a poll re-renders every section on this page, and an overlay owned by one of
 * them would be torn down mid-interaction.
 */
export function NowView() {
    const { data, error, nowMs } = useLoopStatus();

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-sm font-semibold tracking-tight">
                    Loop status
                </h2>
                <span className="text-muted-foreground text-xs">
                    {error
                        ? `error: ${error}`
                        : data
                          ? nowSubtitleText(data)
                          : "loading…"}
                </span>
            </div>

            {data ? (
                <>
                    {data.verdict ? (
                        <VerdictBand verdict={data.verdict} />
                    ) : null}
                    <Lights data={data} />
                    <Timeline data={data} nowMs={nowMs} />
                    <ActivitySection data={data} nowMs={nowMs} />
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        <DriverSection data={data} />
                        <QueueSection data={data} />
                        <BatchSection data={data} />
                    </div>
                    <ClaimsTable data={data} nowMs={nowMs} />
                    <LiveSessions data={data} nowMs={nowMs} />
                </>
            ) : null}

            <TailDrawer />
            <ConfirmDialog onSuccess={() => void refreshLoopStatus()} />
        </div>
    );
}
