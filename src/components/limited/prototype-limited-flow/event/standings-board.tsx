// PROTOTYPE — throwaway. Standings with graphics: medal rank, avatar, deck
// colours beside the name, record dots, GW%, an OMW% bar, points large.
// Phones keep rank · player · points; the rest folds under the name.
import { Bot } from "lucide-react";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import RankBadge from "./rank-badge";
import RecordDots from "./record-dots";
import SeatAvatar from "./seat-avatar";
import TileFrame from "./tile-frame";
import {
    EVENT_META,
    recordText,
    standingsFor,
    type EventPhase,
    type MockSeat,
} from "./event-mock";

const COLS =
    "grid-cols-[1.75rem_minmax(0,1fr)_2.5rem] sm:grid-cols-[1.75rem_minmax(0,1fr)_4.5rem_3rem_6.5rem_2.75rem]";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export default function StandingsBoard({
    phase,
    seats,
    className,
}: {
    phase: EventPhase;
    seats: MockSeat[];
    className?: string;
}) {
    const rows = standingsFor(phase);
    const final = phase === "finished";
    return (
        <TileFrame
            title={
                final
                    ? "Final standings"
                    : `Standings · after round ${EVENT_META.currentRound - 1}`
            }
            right={
                <span className="text-[10px] uppercase tracking-wide text-text-muted">
                    3 pts win · 1 draw
                </span>
            }
            className={className}
        >
            <div className="flex flex-col">
                <div
                    className={cn(
                        "hidden items-center gap-x-3 px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted sm:grid",
                        COLS
                    )}
                >
                    <span>#</span>
                    <span>Player</span>
                    <span>Record</span>
                    <span className="text-right">GW%</span>
                    <span>OMW%</span>
                    <span className="text-right">Pts</span>
                </div>
                {rows.map((r) => {
                    const s = seats[r.seatIndex];
                    return (
                        <div
                            key={r.seatIndex}
                            className={cn(
                                "grid items-center gap-x-3 rounded-sm border-t border-[var(--hairline)] px-2 py-2 first:border-t-0",
                                COLS,
                                s.isViewer &&
                                    "bg-accent/10 ring-1 ring-inset ring-accent/40",
                                r.rank === 1 && final && "bg-amber-400/10"
                            )}
                        >
                            <RankBadge rank={r.rank} />
                            <span className="flex min-w-0 items-center gap-2.5">
                                <SeatAvatar seat={s} size="sm" />
                                <span className="flex min-w-0 flex-col gap-0.5">
                                    <span className="flex min-w-0 items-center gap-1.5">
                                        <span
                                            className={cn(
                                                "truncate text-sm",
                                                s.isViewer
                                                    ? "font-semibold text-accent-strong"
                                                    : "font-medium text-parchment"
                                            )}
                                        >
                                            {s.isViewer ? "You" : s.name}
                                        </span>
                                        {s.kind === "bot" && (
                                            <Bot
                                                className="size-3 shrink-0 text-text-disabled"
                                                aria-label="bot"
                                            />
                                        )}
                                        <ManaPips
                                            colors={s.colors}
                                            size="xs"
                                            className="shrink-0"
                                        />
                                    </span>
                                    <span className="flex items-center gap-2 text-[10px] tabular-nums text-text-muted sm:hidden">
                                        <RecordDots
                                            record={r.record}
                                            rounds={EVENT_META.rounds}
                                        />
                                        {recordText(r.record)} · OMW{" "}
                                        {pct(r.omwPct)}
                                    </span>
                                </span>
                            </span>
                            <span className="hidden items-center gap-2 text-xs tabular-nums text-text-muted sm:flex">
                                <RecordDots
                                    record={r.record}
                                    rounds={EVENT_META.rounds}
                                />
                                {recordText(r.record)}
                            </span>
                            <span className="hidden text-right text-xs tabular-nums text-text-muted sm:block">
                                {pct(r.gwPct)}
                            </span>
                            <span className="hidden items-center gap-1.5 sm:flex">
                                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                                    <span
                                        className="block h-full rounded-full bg-secondary-accent"
                                        style={{ width: pct(r.omwPct) }}
                                    />
                                </span>
                                <span className="w-8 text-right text-[10px] tabular-nums text-text-muted">
                                    {pct(r.omwPct)}
                                </span>
                            </span>
                            <span className="text-right font-display text-xl leading-none tabular-nums text-parchment">
                                {r.points}
                            </span>
                        </div>
                    );
                })}
            </div>
        </TileFrame>
    );
}
