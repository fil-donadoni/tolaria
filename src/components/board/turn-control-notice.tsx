// Turn Control notice (CR 723, ADR 0181, issue #8446).
//
// While one player controls another's turn, both boards say so: the
// controller is acting for two seats, and the controlled player is watching a
// board whose every affordance is locked — which otherwise reads as a frozen
// game. Calm information, never a control: the same quiet HUD chip as
// `BotThinkingIndicator`, one row below it.
import { cn } from "~/lib/utils";
import { V4_PLATE } from "~/lib/board-chrome-v4";
import { useGameContext } from "~/hooks/useGameContext";
import type { TurnControlNotice as Notice } from "~/lib/turn-control";

export default function TurnControlNotice({
    notice,
}: {
    notice: Notice | null;
}) {
    const { allPlayers } = useGameContext();
    if (!notice) return null;
    const nameOf = (id: string) =>
        allPlayers.find((p) => p.id === id)?.name ?? "your opponent";
    const text =
        notice.kind === "controlled"
            ? `${nameOf(notice.byId)} controls you this turn`
            : `You control ${nameOf(notice.seatId)} this turn`;

    return (
        <div
            role="status"
            data-testid="turn-control-notice"
            className={cn(
                V4_PLATE,
                "absolute left-1/2 top-12 z-20 -translate-x-1/2 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium text-text-muted"
            )}
        >
            <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-text-disabled"
            />
            {text}
        </div>
    );
}
