// Focused-seat panel: the ranked candidate list for its most recent pick,
// full term breakdown + provenance (issue #1612: "one seat focused, showing
// the ranked candidate list with the full term breakdown and its
// provenance"). Ranked by score, highest first — the order the bot itself
// compared candidates in.
import { Panel, PanelHeader, PanelBody } from "@/components/ui/panel";
import type { DraftLabPickRecord } from "@/lib/limited/draftLabEngine";
import type { GetCardProfile } from "@convex/limited/cardProfilesCore";
import DraftLabCandidateRow from "./draft-lab-candidate-row";

export default function DraftLabFocusPanel({
    seatLabel,
    record,
    getCardProfile,
}: {
    seatLabel: string;
    record: DraftLabPickRecord | undefined;
    getCardProfile: GetCardProfile;
}) {
    return (
        <Panel density="compact" className="min-w-[320px] flex-1">
            <PanelHeader title={`${seatLabel} — candidates`} />
            <PanelBody>
                {!record ? (
                    <span className="text-[11px] text-text-disabled">
                        No pick yet for this seat.
                    </span>
                ) : (
                    <div className="flex flex-col gap-1">
                        <p className="text-[10px] text-text-disabled">
                            pick {record.seatPickNumber} of this seat's draft —
                            pack had {record.pack.length} card(s)
                        </p>
                        {[...record.pack]
                            .map((card, i) => ({
                                card,
                                trace: record.traces[i],
                            }))
                            .sort(
                                (a, b) =>
                                    (b.trace?.score ?? -Infinity) -
                                    (a.trace?.score ?? -Infinity)
                            )
                            .map(({ card, trace }) => (
                                <DraftLabCandidateRow
                                    key={card.pickId}
                                    cardName={card.cardName}
                                    trace={trace}
                                    chosen={card.pickId === record.chosenPickId}
                                    profile={getCardProfile(card.cardId)}
                                    defaultExpanded={
                                        card.pickId === record.chosenPickId
                                    }
                                />
                            ))}
                    </div>
                )}
            </PanelBody>
        </Panel>
    );
}
