// Replay mode's top-level panel (issue #1613, ADR 0074, PRD #1607 slice 6):
// pick a completed Draft event, reconstruct it from its `seed` + every seat's
// stored `pool`, and show the historical-vs-recomputed diff with the
// divergence point marked. Zero writes — `useDraftLabReplay` only ever reads
// (`useMyLimitedEvents`, plus a live `cardRatings` scope read since the
// #1613 fixup) and calls the pure `reconstructDraftReplay`.
//
// Non-admin messaging used to live here (issue #1613 fixup): `eventProjection
// .ts` exposes a completed Draft event's `seed` ONLY to an admin viewer, so a
// non-admin's `selectedEvent.seed` read as the SAME `null` a genuinely
// seed-less (pre-ADR-0055) event shows, and the panel had to disambiguate the
// two. It no longer can be reached by a non-admin at all — the WHOLE
// `/admin/draft-lab` route is admin-gated (`AdminRouteGate`, see
// `admin-route-gate.tsx`), so a `null` seed here means exactly one thing: this
// event has no recorded seed. The old two-branch message was kept honest by
// the panel; keeping it now would be a structurally dead branch pretending to
// be a gate, so it is gone and the route owns the access decision.
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { useDraftLabReplay } from "@/hooks/useDraftLabReplay";
import { SCORER_VERSION } from "@convex/limited/scorerVersion";
import DraftLabReplayEventPicker from "./draft-lab-replay-event-picker";
import DraftLabReplayDivergenceBanner from "./draft-lab-replay-divergence-banner";
import DraftLabReplayStopNotice from "./draft-lab-replay-stop-notice";
import DraftLabReplayPickList from "./draft-lab-replay-pick-list";

export default function DraftLabReplayPanel() {
    const {
        replayableEvents,
        selectedEventId,
        selectEvent,
        selectedEvent,
        result,
        ratingsLoading,
    } = useDraftLabReplay();

    return (
        <Panel size="wide" className="flex flex-col gap-4">
            <PanelHeader title="Replay a completed Draft" />
            <PanelBody>
                <div className="flex flex-col gap-4">
                    <DraftLabReplayEventPicker
                        events={replayableEvents}
                        selectedEventId={selectedEventId}
                        onSelect={selectEvent}
                    />

                    {selectedEvent && (
                        <p className="text-[10px] text-text-disabled">
                            Drafted under scorer v
                            {selectedEvent.scorerVersion ?? "unknown"} — the
                            "recomputed" column below always uses the CURRENT
                            scorer, v{SCORER_VERSION}.
                        </p>
                    )}

                    {selectedEvent && selectedEvent.seed == null && (
                        <p className="text-[11px] text-text-disabled">
                            This event has no recorded seed and can't be
                            reconstructed.
                        </p>
                    )}

                    {selectedEvent &&
                        selectedEvent.seed != null &&
                        ratingsLoading && (
                            <p className="text-[11px] text-text-disabled">
                                Loading this event's Pick Rating overrides…
                            </p>
                        )}

                    {result && (
                        <>
                            <DraftLabReplayDivergenceBanner result={result} />
                            <DraftLabReplayStopNotice
                                result={result}
                                seats={selectedEvent?.seats ?? []}
                            />
                            <DraftLabReplayPickList
                                result={result}
                                seats={selectedEvent?.seats ?? []}
                            />
                        </>
                    )}
                </div>
            </PanelBody>
        </Panel>
    );
}
