// One seat's summary tile in the Draft Lab table view (issue #1612: "table
// view: all 8 seats, each with its current pack and the pick it made" — a
// cube table may be clamped narrower, see `draftLabSeatCount`).
// Clicking a tile focuses that seat's candidate breakdown.
//
// Pack CONTENTS, not just size (issue #1612 fixup, pre-merge review): the
// scope bullet reads "each with its current pack", which the tile satisfied
// only with a bare card count ("pack 14") — the pick target names themselves
// were invisible outside the focused seat's detail view. Rendered here as a
// compact wrapped name list; the focused seat (`DraftLabFocusPanel`) remains
// the place for the full per-candidate breakdown, so this stays terse on
// purpose.
import type { LimitedEventSeat } from "@convex/limited/eventTypes";
import type { DraftLabPickRecord } from "@/lib/limited/draftLabEngine";
import type { GetCardProfile } from "@convex/limited/cardProfilesCore";
import DraftLabProfileBadge from "./draft-lab-profile-badge";

export default function DraftLabSeatCard({
    seat,
    lastPick,
    focused,
    getCardProfile,
    onFocus,
}: {
    seat: LimitedEventSeat;
    lastPick: DraftLabPickRecord | undefined;
    focused: boolean;
    getCardProfile: GetCardProfile;
    onFocus: () => void;
}) {
    const lastPickCard = lastPick?.pack.find(
        (c) => c.pickId === lastPick.chosenPickId
    );

    return (
        <button
            type="button"
            onClick={onFocus}
            aria-pressed={focused}
            className={`flex flex-col gap-1 rounded-sm border p-2 text-left transition-colors ${
                focused
                    ? "border-accent bg-accent-soft/10"
                    : "border-border-strong hover:border-accent/60"
            }`}
        >
            <span className="text-xs font-semibold text-text">
                {seat.nickname ?? `Seat ${seat.seatIndex + 1}`}
            </span>
            <span className="text-[10px] text-text-muted">
                pool {seat.pool?.length ?? 0} · pack{" "}
                {seat.currentPack?.length ?? 0}
            </span>
            {seat.currentPack && seat.currentPack.length > 0 && (
                <span
                    className="text-[10px] leading-tight text-text-disabled"
                    title={seat.currentPack.map((c) => c.cardName).join(", ")}
                >
                    {seat.currentPack.map((c) => c.cardName).join(", ")}
                </span>
            )}
            {lastPickCard ? (
                <span className="flex items-center gap-1 text-[10px] text-text-disabled">
                    took {lastPickCard.cardName}
                    <DraftLabProfileBadge
                        profile={getCardProfile(lastPickCard.cardId)}
                    />
                </span>
            ) : (
                <span className="text-[10px] text-text-disabled">
                    no pick yet
                </span>
            )}
        </button>
    );
}
