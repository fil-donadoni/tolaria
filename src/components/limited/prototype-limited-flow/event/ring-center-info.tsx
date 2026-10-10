// PROTOTYPE — throwaway. What the felt in the middle of the table says, by
// phase: seats taken, pack + pass direction, decks in, round, winner.
import { RotateCcw, RotateCw, Trophy } from "lucide-react";
import { EVENT_META, passDirectionFor } from "./event-mock";
import type { EventProto } from "./use-event-proto";

export default function RingCenterInfo({
    p,
    dense = false,
}: {
    p: EventProto;
    dense?: boolean;
}) {
    const big = dense
        ? "font-display text-2xl leading-none text-parchment"
        : "font-display text-3xl leading-none text-parchment sm:text-4xl";
    const small = dense
        ? "text-[8px] font-semibold uppercase tracking-[0.12em] text-text-muted"
        : "text-[10px] font-semibold uppercase tracking-[0.16em] text-text-muted";
    switch (p.phase) {
        case "waiting": {
            const humans = p.seats.filter((s) => s.kind === "human").length;
            return (
                <div className="flex flex-col items-center gap-1.5">
                    <span className={big}>
                        {humans}
                        <span className="text-text-muted">
                            /{EVENT_META.seatCount}
                        </span>
                    </span>
                    <span className={small}>players seated</span>
                </div>
            );
        }
        case "drafting": {
            const dir = passDirectionFor(EVENT_META.draftPack);
            const Icon = dir === "left" ? RotateCw : RotateCcw;
            return (
                <div className="flex flex-col items-center gap-1.5">
                    <span className={small}>
                        Pack {EVENT_META.draftPack} of 3
                    </span>
                    <span className={big}>Pick {EVENT_META.draftPick}</span>
                    <span className="flex items-center gap-1 rounded-full border border-accent/50 bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent-strong">
                        <Icon className="size-3.5" />
                        passing {dir}
                    </span>
                </div>
            );
        }
        case "building": {
            const decks = p.seats.filter((s) => s.hasDeck).length;
            return (
                <div className="flex flex-col items-center gap-1.5">
                    <span className={big}>
                        {decks}
                        <span className="text-text-muted">
                            /{EVENT_META.seatCount}
                        </span>
                    </span>
                    <span className={small}>decks in</span>
                </div>
            );
        }
        case "playing":
            return (
                <div className="flex flex-col items-center gap-1.5">
                    <span className={small}>{EVENT_META.gamesFormat}</span>
                    <span className={big}>Round {EVENT_META.currentRound}</span>
                    <span className={small}>of {EVENT_META.rounds}</span>
                </div>
            );
        case "finished":
            return (
                <div className="flex flex-col items-center gap-1.5">
                    <Trophy className="size-7 text-amber-300" />
                    <span className="font-display text-2xl leading-none text-parchment">
                        Morgana
                    </span>
                    <span className={small}>wins · 3-0</span>
                </div>
            );
    }
}
