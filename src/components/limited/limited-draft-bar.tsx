import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, MoreHorizontal } from "lucide-react";
import {
    Popover,
    PopoverTrigger,
    PopoverContent,
} from "@/components/ui/popover";
import { cn } from "~/lib/utils";

/** What the bar counts while a Draft is running. `null` in Sealed reveal
 *  mode, where there is no pack and no pass. */
export interface DraftBarPack {
    /** 0-based booster round. */
    round: number;
    totalRounds: number;
    /** Cards still in the pack in front of this seat. */
    cardsLeft: number;
    /** Picks this seat has made so far, across the whole event. */
    picksMade: number;
    /** Packs waiting behind the current one. */
    queueCount: number;
    /** `passDirection(round)` — +1 left, -1 right. */
    direction: 1 | -1;
}

/**
 * The Draft Room's thin bar (ADR 0101 §6, issue #2587): "pack n/3 · pick n/15
 * · direction · timer · waiting-pack dot · Table dialog · pool toggle".
 *
 * It is the room's OWN chrome — the route is registered `ownChrome` in
 * `shellChrome.ts`, so no shell contextual bar renders above it. That is what
 * satisfies the ADR's "no Event back-link during a pick": leaving the room is
 * in the overflow at the right, and nowhere else.
 *
 * TWO DEVIATIONS FROM THE ADR LINE, BOTH DELIBERATE:
 *
 *  - **The timer is not in this bar.** The Pick Timer is a full-width bar
 *    directly above the Booster grid, and issue #2238 moved it there
 *    *because* a compact readout in a meta row "was not findable under time
 *    pressure"; its own doc comment states there is no second copy of the
 *    countdown anywhere else. Re-adding one here would undo a measured
 *    decision. The room mounts the timer immediately under this bar instead,
 *    which is the same glance.
 *  - **`pick n/15` is `pick #n` plus a cards-left count.** The denominator is
 *    the ORIGINAL size of the pack in front of the seat, which is not on the
 *    wire and cannot be derived from what is: pack size varies by pack source
 *    (ARN/ATQ boosters are 8 cards, `CUBE_PACK_SIZE` is 15), a pack loses
 *    cards to every seat it passes, and `pickId`'s `c<idx>` suffix only bounds
 *    it from below once the highest-index card has been taken. Rather than
 *    render a plausible-looking wrong denominator, the bar shows the two exact
 *    numbers: the seat's own pick number and how many cards are left to choose
 *    from.
 */
export default function LimitedDraftBar({
    eventId,
    title,
    pack,
    poolVisible,
    onTogglePool,
    onOpenTable,
}: {
    eventId: string;
    /** The event's display name — `limitedEventName(event)`. */
    title: string;
    pack: DraftBarPack | null;
    poolVisible: boolean;
    onTogglePool: () => void;
    onOpenTable: () => void;
}) {
    const [open, setOpen] = useState(false);
    // No pack in front of the seat while the draft is live = waiting on a
    // neighbour. THE dot of the ADR line: it is the only state in which a
    // drafter can do nothing at all, and without it an empty pack area reads
    // as a bug.
    const waiting = pack !== null && pack.cardsLeft === 0;

    return (
        <div
            data-slot="draft-room-bar"
            className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-raised px-2 text-xs text-text-muted"
        >
            <span className="hidden min-w-0 truncate font-beleren tracking-[0.14em] text-accent-strong sm:inline">
                {title}
            </span>

            {pack && (
                <>
                    <span
                        data-slot="pack-counter"
                        className="shrink-0 whitespace-nowrap"
                    >
                        Pack {pack.round + 1}/{pack.totalRounds}
                    </span>
                    <span
                        data-slot="pick-counter"
                        className="shrink-0 whitespace-nowrap"
                    >
                        Pick #{pack.picksMade + 1} · {pack.cardsLeft} left
                    </span>
                    <span
                        data-slot="pass-direction"
                        className="flex shrink-0 items-center gap-1 whitespace-nowrap"
                        title={`Packs pass ${pack.direction === 1 ? "left" : "right"}`}
                    >
                        {pack.direction === 1 ? (
                            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
                        ) : (
                            <ArrowRight
                                className="h-3 w-3"
                                aria-hidden="true"
                            />
                        )}
                        <span className="sr-only">Packs pass </span>
                        {pack.direction === 1 ? "left" : "right"}
                    </span>
                    {waiting && (
                        <span
                            data-slot="waiting-pack"
                            className="flex shrink-0 items-center gap-1 whitespace-nowrap text-accent-strong"
                        >
                            <span
                                aria-hidden="true"
                                className="inline-block h-2 w-2 rounded-full bg-accent-strong motion-safe:animate-pulse"
                            />
                            {pack.queueCount > 0
                                ? "Opening next pack"
                                : "Waiting for a pack"}
                        </span>
                    )}
                    {!waiting && pack.queueCount > 0 && (
                        <span
                            data-slot="queued-packs"
                            className="hidden shrink-0 whitespace-nowrap sm:inline"
                        >
                            {pack.queueCount} queued
                        </span>
                    )}
                </>
            )}

            <span className="flex-1" />

            <button
                type="button"
                onClick={onOpenTable}
                className="flex min-h-[var(--control-h)] shrink-0 items-center rounded-sm px-2 tracking-[0.14em] uppercase transition-colors hover:text-parchment"
            >
                Table
            </button>
            <button
                type="button"
                onClick={onTogglePool}
                aria-pressed={poolVisible}
                className={cn(
                    "flex min-h-[var(--control-h)] shrink-0 items-center rounded-sm px-2 tracking-[0.14em] uppercase transition-colors hover:text-parchment",
                    poolVisible && "text-accent-strong"
                )}
            >
                Pool
            </button>

            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    aria-label="More"
                    className="flex min-h-[var(--control-h)] min-w-[var(--control-h)] shrink-0 items-center justify-center rounded-sm transition-colors hover:text-parchment data-[state=open]:text-accent-strong"
                >
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end" className="p-1">
                    <nav
                        aria-label="Overflow"
                        className="flex min-w-40 flex-col"
                    >
                        <Link
                            to="/limited/$eventId"
                            params={{ eventId }}
                            onClick={() => setOpen(false)}
                            className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment"
                        >
                            Leave the draft
                        </Link>
                        <Link
                            to="/settings"
                            onClick={() => setOpen(false)}
                            className="rounded-sm px-3 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-raised hover:text-parchment"
                        >
                            Settings
                        </Link>
                    </nav>
                </PopoverContent>
            </Popover>
        </div>
    );
}
