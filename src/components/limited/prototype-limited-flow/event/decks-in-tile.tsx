// PROTOTYPE — throwaway. Deckbuilding: who has submitted, with deck colours.
import { Check, Hourglass } from "lucide-react";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import SeatAvatar from "./seat-avatar";
import TileFrame from "./tile-frame";
import type { MockSeat } from "./event-mock";

export default function DecksInTile({
    seats,
    className,
}: {
    seats: MockSeat[];
    className?: string;
}) {
    const ready = seats.filter((s) => s.hasDeck).length;
    return (
        <TileFrame
            title="Decks in"
            right={
                <span className="text-xs tabular-nums text-parchment">
                    <b>{ready}</b>
                    <span className="text-text-muted">/{seats.length}</span>
                </span>
            }
            className={className}
        >
            <span className="h-1.5 overflow-hidden rounded-full bg-surface-elevated">
                <span
                    className="block h-full rounded-full bg-success"
                    style={{ width: `${(ready / seats.length) * 100}%` }}
                />
            </span>
            <ul className="grid grid-cols-1 gap-1 min-[420px]:grid-cols-2">
                {seats.map((s) => (
                    <li
                        key={s.seatIndex}
                        className="flex min-w-0 items-center gap-2 text-xs"
                    >
                        <SeatAvatar seat={s} size="xs" />
                        <span
                            className={cn(
                                "truncate",
                                s.isViewer
                                    ? "font-semibold text-accent-strong"
                                    : "text-parchment"
                            )}
                        >
                            {s.isViewer ? "You" : s.name}
                        </span>
                        <ManaPips colors={s.colors} size="xs" />
                        {s.hasDeck ? (
                            <Check className="ml-auto size-3.5 shrink-0 text-success" />
                        ) : (
                            <Hourglass className="ml-auto size-3.5 shrink-0 text-text-disabled" />
                        )}
                    </li>
                ))}
            </ul>
        </TileFrame>
    );
}
