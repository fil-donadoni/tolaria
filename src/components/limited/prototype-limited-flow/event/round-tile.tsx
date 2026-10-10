// PROTOTYPE — throwaway. Games: the current round — your pairing face-off
// with its Play CTA, then the rest of the round's tables.
import { Swords } from "lucide-react";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import SeatAvatar from "./seat-avatar";
import TileFrame from "./tile-frame";
import {
    EVENT_META,
    PAIRINGS_ROUND_2,
    recordText,
    type MockSeat,
} from "./event-mock";

export default function RoundTile({
    seats,
    onPlay,
    showCta = true,
    className,
}: {
    seats: MockSeat[];
    onPlay: () => void;
    /** Off when the hero already carries the Play CTA on screen. */
    showCta?: boolean;
    className?: string;
}) {
    const [mine, ...others] = PAIRINGS_ROUND_2;
    const me = seats[mine.a];
    const opp = seats[mine.b];
    return (
        <TileFrame
            title={`Round ${EVENT_META.currentRound} of ${EVENT_META.rounds}`}
            right={
                <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-semibold tabular-nums text-text-muted">
                    closes in 42:10
                </span>
            }
            className={className}
        >
            <div className="flex items-center justify-between gap-2 rounded-sm border border-accent/40 bg-gradient-to-r from-accent/10 via-transparent to-accent/10 p-3">
                {[me, opp].map((s, i) => (
                    <div
                        key={s.seatIndex}
                        className={cn(
                            "flex min-w-0 flex-1 flex-col items-center gap-1 text-center",
                            i === 1 && "order-3"
                        )}
                    >
                        <SeatAvatar seat={s} size="md" />
                        <span className="max-w-full truncate text-sm font-semibold text-parchment">
                            {s.isViewer ? "You" : s.name}
                        </span>
                        <span className="flex items-center gap-1 text-[10px] tabular-nums text-text-muted">
                            <ManaPips colors={s.colors} size="xs" />
                            {recordText(s.record)}
                        </span>
                    </div>
                ))}
                <span className="order-2 flex flex-col items-center gap-1">
                    <Swords className="size-5 text-accent-strong" />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-text-muted">
                        {EVENT_META.gamesFormatShort}
                    </span>
                </span>
            </div>
            {showCta && (
                <button
                    type="button"
                    onClick={onPlay}
                    className="btn-base btn-tone-primary min-h-11 w-full text-sm"
                >
                    Play match
                </button>
            )}
            <ul className="flex flex-col gap-1">
                {others.map((pr) => {
                    const a = seats[pr.a];
                    const b = seats[pr.b];
                    return (
                        <li
                            key={pr.a}
                            className="flex items-center gap-2 rounded-sm bg-surface-elevated/50 px-2 py-1.5 text-xs"
                        >
                            <span className="min-w-0 flex-1 truncate text-right text-parchment">
                                {a.name}
                            </span>
                            <span
                                className={cn(
                                    "w-12 shrink-0 text-center font-semibold tabular-nums",
                                    pr.status === "live"
                                        ? "text-success-strong"
                                        : "text-text-muted"
                                )}
                            >
                                {pr.status === "live" ? "● " : ""}
                                {pr.score}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-parchment">
                                {b.name}
                            </span>
                            <span className="hidden w-16 shrink-0 text-right text-[10px] uppercase tracking-wide text-text-disabled min-[420px]:block">
                                {pr.status === "live" ? "Live" : pr.source}
                            </span>
                        </li>
                    );
                })}
            </ul>
        </TileFrame>
    );
}
