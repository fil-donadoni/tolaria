// PROTOTYPE — throwaway. Finished: the winner, big, on their deck's art.
import { Trophy } from "lucide-react";
import { getArtCropImageUrl } from "~/lib/images";
import { cn } from "~/lib/utils";
import ManaPips from "./mana-pips";
import SeatAvatar from "./seat-avatar";
import type { MockSeat } from "./event-mock";

export default function WinnerBanner({
    seats,
    className,
}: {
    seats: MockSeat[];
    className?: string;
}) {
    const w = seats.find((s) => s.placement === 1);
    if (!w) return null;
    const art = w.deck.find((c) => c.types.includes("Creature")) ?? w.deck[0];
    return (
        <section
            className={cn(
                "relative isolate flex items-center gap-4 overflow-hidden rounded-[var(--panel-radius)] border border-amber-300/50 p-4 sm:p-5",
                className
            )}
        >
            <img
                src={getArtCropImageUrl(art.id)}
                alt=""
                className="absolute inset-0 -z-10 h-full w-full object-cover opacity-50"
            />
            <span
                aria-hidden
                className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.6)_60%,rgba(0,0,0,0.3)_100%)]"
            />
            <span className="relative">
                <SeatAvatar
                    seat={w}
                    size="lg"
                    className="ring-2 ring-amber-300"
                />
                <Trophy className="absolute -bottom-1 -right-2 size-6 rounded-full bg-amber-400 p-1 text-amber-950" />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">
                    Event winner
                </span>
                <span className="flex items-center gap-2">
                    <span className="truncate font-display text-3xl leading-none text-parchment">
                        {w.name}
                    </span>
                    <ManaPips colors={w.colors} size="sm" />
                </span>
                <span className="text-xs text-text-muted">
                    3-0 in matches · 6-1 in games · undefeated
                </span>
            </span>
        </section>
    );
}
