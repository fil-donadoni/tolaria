import { passDirection } from "@convex/limited/draftEngine";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import GameDialog from "~/components/ui/game-dialog";
import { limitedEventStatusHint } from "~/lib/limitedEventStatus";
import LimitedTableRingView from "./limited-table-ring-view";

/**
 * The Table dialog (ADR 0101 §6, issue #2587; ring body since issue #5390):
 * "an Arena-style dialog, never a dominant page element". Wraps
 * `LimitedTableRingView` for the places the ring is not inline — the Draft
 * Room's bar and the phone-sized event page tile.
 *
 * WHY `GameDialog` AND NOT A NEW DIALOG SHAPE. It is what every other dialog
 * on this flow already is (the event page's own Leave/Cancel confirmations),
 * and its one board-specific detail degrades correctly off the board — the
 * `.play-area-center-x` rule reads `--right-piles-w`, a variable only the
 * board publishes, so off-board it resolves to `0px` and the popup is plainly
 * viewport-centred. It also inherits the short-viewport height clamp measured
 * in issue #2586, needed to survive 844x390.
 */
export default function LimitedTableRing({
    open,
    onOpenChange,
    event,
    round,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    event: LimitedEventView;
    /** The booster round in progress — decides the passing direction. */
    round: number;
}) {
    // `passDirection` is the SERVER's own function (`convex/limited/
    // draftEngine.ts`), imported rather than re-derived: "round 0 passes left"
    // is a rule with exactly one home, and a second copy here would be a
    // second opinion about which way the arrows point (ADR 0074 — the
    // frontend may share pure engine modules, it just never has authority).
    const direction = passDirection(round);
    const directionLabel = direction === 1 ? "left" : "right";

    const seatCount = event.seats.length;
    // The Ring is mounted from both the Draft Room (always mid-draft, where
    // "packs passing" is always true) and, since issue #2590, the antechamber
    // at every phase — an open/Sealed/deckbuilding/finished event has no
    // packs in flight, so the clause only belongs in the subtitle while the
    // event actually reports "drafting".
    const isDrafting = limitedEventStatusHint(event) === "drafting";
    const subtitle = isDrafting
        ? `${seatCount} seats · packs passing ${directionLabel}`
        : `${seatCount} seats`;

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="The Table"
            subtitle={subtitle}
            showCloseButton
        >
            <LimitedTableRingView event={event} round={round} />
        </GameDialog>
    );
}
