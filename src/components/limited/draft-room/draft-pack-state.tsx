import { cn } from "~/lib/utils";

/**
 * The Booster's one-line state on a phone strip (issue #2588, ADR 0101 §6:
 * the pack tab shows "timer, pick n, waiting dot").
 *
 * Shared by both arrangements so the waiting DOT and the pick counter cannot
 * drift apart between them — and the dot is the SAME accent pulse the room's
 * thin bar draws (`limited-draft-bar.tsx` § `waiting-pack`), because it means
 * the same thing. It deliberately does NOT restate the countdown —
 * the Pick Timer is mounted in the same band, and the Draft Room has exactly
 * one copy of the countdown by design (`limited-draft-timer.tsx`).
 */
export default function DraftPackState({
    pickNumber,
    packLeft,
    className,
}: {
    /** 1-based Pick number, matching the room's thin bar. */
    pickNumber: number;
    /** Cards left in the Booster; `0` = waiting for a pack. */
    packLeft: number;
    className?: string;
}) {
    return (
        <span
            data-slot="draft-pack-state"
            className={cn(
                "flex min-w-0 items-center gap-1.5 truncate text-[11px] tracking-widest text-text-muted uppercase",
                className
            )}
        >
            {packLeft === 0 ? (
                <>
                    <span
                        aria-hidden="true"
                        data-slot="draft-waiting-dot"
                        className="h-2 w-2 shrink-0 rounded-full bg-accent-strong motion-safe:animate-pulse"
                    />
                    Waiting for a pack
                </>
            ) : (
                <>
                    Pick #{pickNumber} · {packLeft} left
                </>
            )}
        </span>
    );
}
