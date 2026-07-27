// Replay mode's top-level panel (issue #1613, ADR 0074, PRD #1607 slice 6):
// pick a completed Draft event, reconstruct it from its `seed` + every seat's
// stored `pool`, and show the historical-vs-recomputed diff with the
// divergence point marked. Zero writes — `useDraftLabReplay` only ever reads
// (`useMyLimitedEvents`, plus a live `cardRatings` scope read since the
// #1613 fixup) and calls the pure `reconstructDraftReplay`.
//
// Honest degrade for a non-admin (issue #1613 fixup, pre-merge review finding
// 1's UI follow-up): `eventProjection.ts` now exposes a completed Draft
// event's `seed` ONLY to an admin viewer, so a non-admin's
// `selectedEvent.seed` is always `null` — the SAME `null` a genuinely
// seed-less (pre-ADR-0055) event would show. Without `isAdmin` this panel
// can't tell those two cases apart, and "this event has no recorded seed"
// would be a misleading thing to say to a non-admin who simply isn't allowed
// to see it. `canViewDraftReplay(user)` distinguishes them so the message
// says WHY, never just renders an empty panel.
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { canViewDraftReplay } from "@/lib/adminGating";
import { useDraftLabReplay } from "@/hooks/useDraftLabReplay";
import { SCORER_VERSION } from "@convex/limited/scorerVersion";
import DraftLabReplayEventPicker from "./draft-lab-replay-event-picker";
import DraftLabReplayDivergenceBanner from "./draft-lab-replay-divergence-banner";
import DraftLabReplayStopNotice from "./draft-lab-replay-stop-notice";
import DraftLabReplayPickList from "./draft-lab-replay-pick-list";

export default function DraftLabReplayPanel() {
    const currentUser = useCurrentUser();
    const isAdmin = canViewDraftReplay(currentUser);
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
                            {isAdmin
                                ? "This event has no recorded seed and can't be reconstructed."
                                : "Replay reconstruction needs this event's seed, which is only exposed to an admin viewer — even once the event is complete — because it can regenerate every seat's Pool (issue #1613 fixup). Ask an admin to open this replay."}
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
