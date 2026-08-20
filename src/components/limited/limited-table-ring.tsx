import { ArrowDown, ArrowUp } from "lucide-react";
import { passDirection } from "@convex/limited/draftEngine";
import type { LimitedEventView } from "~/hooks/useLimitedEvent";
import GameDialog from "~/components/ui/game-dialog";
import { cn } from "~/lib/utils";

/**
 * The Table Ring (ADR 0101 §6, issue #2587): "an Arena-style dialog, never a
 * dominant page element" — who is at the table, which way the packs are
 * going, and how far along each seat is.
 *
 * WHY `GameDialog` AND NOT A NEW DIALOG SHAPE. The Ring had no reuse target
 * (`limited-table-panel.tsx` is an in-page seat list, a different shape), so
 * the choice was between a bare `Dialog` + `Panel` pair and the app's
 * Panel-framed dialog. It is `GameDialog`: it is what every other dialog on
 * this flow already is (the event page's own Leave/Cancel confirmations), and
 * its one board-specific detail degrades correctly off the board — the
 * `.play-area-center-x` rule reads `--right-piles-w`, a variable only the
 * board publishes, so off-board it resolves to `0px` and the popup is plainly
 * viewport-centred. In exchange it inherits the short-viewport height clamp
 * measured in issue #2586, which a hand-rolled `Dialog` + `Panel` would have
 * had to re-derive to survive 844x390.
 *
 * SELF AT THE BOTTOM. The seats are rotated so the viewer is the LAST row,
 * matching the physical table the dialog depicts (you sit at the near edge and
 * read the others across from you). The rotation is on the RENDER order only —
 * `seatIndex` is untouched, so the arrows below still describe the real
 * passing order.
 *
 * WHAT IT CANNOT SHOW, AND WHY. `packQueueCount` is projected for the VIEWER'S
 * OWN SEAT ONLY (`convex/limited/eventProjection.ts`, asserted by
 * `eventProjection.test.ts`: "strips every OTHER seat's currentPack contents
 * and packQueueCount"). So another seat's queued-pack count is not on the wire
 * and this dialog does not invent one — it shows each seat's PICKS MADE
 * (`poolCount`, public for every seat by construction), which is the same
 * "who is holding the table up" signal from the public side of that boundary.
 * Widening the projection is a privacy decision that belongs to whoever made
 * it, not to this slice; see `docs/findings/2587-table-ring-queued-packs.md`.
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

    const seats = [...event.seats].sort((a, b) => a.seatIndex - b.seatIndex);
    const viewerAt = seats.findIndex((seat) => seat.isViewer);
    const ordered =
        viewerAt === -1
            ? seats
            : [...seats.slice(viewerAt + 1), ...seats.slice(0, viewerAt + 1)];

    const seatCount = seats.length;
    const nameOf = (seatIndex: number) => {
        const seat = seats.find((s) => s.seatIndex === seatIndex);
        return seat?.nickname ?? `Seat ${seatIndex + 1}`;
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="The Table"
            subtitle={`${seatCount} seats · packs passing ${directionLabel}`}
            showCloseButton
        >
            <ul
                data-slot="table-ring"
                className="flex flex-col gap-1"
                aria-label="Draft table"
            >
                {ordered.map((seat) => {
                    const passesTo =
                        (((seat.seatIndex + direction) % seatCount) +
                            seatCount) %
                        seatCount;
                    const name = seat.nickname ?? `Seat ${seat.seatIndex + 1}`;
                    return (
                        <li
                            key={seat.seatIndex}
                            data-seat-index={seat.seatIndex}
                            data-is-viewer={seat.isViewer ? "true" : "false"}
                            className={cn(
                                "flex items-center gap-3 rounded-sm px-2 py-1.5 text-sm",
                                seat.isViewer
                                    ? "bg-surface-raised text-parchment ring-1 ring-border-accent/40"
                                    : "text-text-muted"
                            )}
                        >
                            <span
                                aria-hidden="true"
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-base text-xs tracking-wide uppercase ring-1 ring-border-accent/30"
                            >
                                {name.slice(0, 2)}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                                {name}
                                {seat.isBot && (
                                    <span className="ml-1 text-xs text-text-muted">
                                        (bot)
                                    </span>
                                )}
                                {seat.isViewer && (
                                    <span className="ml-1 text-xs text-accent-strong">
                                        (you)
                                    </span>
                                )}
                            </span>
                            <span className="shrink-0 text-xs whitespace-nowrap">
                                {seat.poolCount ?? 0} picked
                            </span>
                            <span
                                className="shrink-0 text-xs whitespace-nowrap"
                                data-slot="queued-packs"
                            >
                                {seat.packQueueCount === null
                                    ? "· · ·"
                                    : `${seat.packQueueCount} queued`}
                            </span>
                            <span className="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap">
                                {direction === 1 ? (
                                    <ArrowDown
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                    />
                                ) : (
                                    <ArrowUp
                                        className="h-3 w-3"
                                        aria-hidden="true"
                                    />
                                )}
                                {nameOf(passesTo)}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </GameDialog>
    );
}
