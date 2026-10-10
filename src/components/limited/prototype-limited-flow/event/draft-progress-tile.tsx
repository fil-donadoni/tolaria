// PROTOTYPE — throwaway. Drafting: 3 packs × 15 picks, the timer, and who
// holds the table up (most queued packs).
import { RotateCcw, RotateCw } from "lucide-react";
import { cn } from "~/lib/utils";
import { EVENT_META, passDirectionFor, type MockSeat } from "./event-mock";
import TileFrame from "./tile-frame";

export default function DraftProgressTile({
    seats,
    className,
}: {
    seats: MockSeat[];
    className?: string;
}) {
    const slowest = [...seats].sort((a, b) => b.queued - a.queued)[0];
    return (
        <TileFrame
            title="Draft progress"
            right={
                <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-300">
                    0:{EVENT_META.pickSecondsLeft}
                </span>
            }
            className={className}
        >
            <ol className="flex flex-col gap-2">
                {[1, 2, 3].map((pack) => {
                    const done =
                        pack < EVENT_META.draftPack
                            ? 15
                            : pack === EVENT_META.draftPack
                              ? EVENT_META.draftPick - 1
                              : 0;
                    const Icon =
                        passDirectionFor(pack) === "left"
                            ? RotateCw
                            : RotateCcw;
                    return (
                        <li
                            key={pack}
                            className="flex items-center gap-2 text-xs"
                        >
                            <span
                                className={cn(
                                    "w-14 shrink-0",
                                    pack === EVENT_META.draftPack
                                        ? "font-semibold text-parchment"
                                        : "text-text-muted"
                                )}
                            >
                                Pack {pack}
                            </span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-elevated">
                                <span
                                    className="block h-full rounded-full bg-accent"
                                    style={{ width: `${(done / 15) * 100}%` }}
                                />
                            </span>
                            <span className="flex w-14 shrink-0 items-center justify-end gap-1 text-text-muted">
                                <Icon className="size-3" />
                                {passDirectionFor(pack)}
                            </span>
                        </li>
                    );
                })}
            </ol>
            <p className="text-xs text-text-muted">
                Slowest seat: <b className="text-parchment">{slowest.name}</b>{" "}
                with {slowest.queued} packs queued.
            </p>
        </TileFrame>
    );
}
