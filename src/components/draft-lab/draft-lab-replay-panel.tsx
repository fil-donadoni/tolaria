// Replay mode's top-level panel (issue #1613, ADR 0074, PRD #1607 slice 6):
// pick a completed Draft event, reconstruct it from its `seed` + every seat's
// stored `pool`, and show the historical-vs-recomputed diff with the
// divergence point marked. Zero writes — `useDraftLabReplay` only ever reads
// (`useMyLimitedEvents`) and calls the pure `reconstructDraftReplay`.
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

                    {result && (
                        <>
                            <DraftLabReplayDivergenceBanner result={result} />
                            <DraftLabReplayStopNotice result={result} />
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
