import { useReducedMotion } from "motion/react";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import { cn } from "~/lib/utils";
import DraftPackState from "./draft-pack-state";
import DraftSelectionActions from "./draft-selection-actions";
import type { DraftSnapStop } from "./draftSnapStops";

/**
 * The PORTRAIT pack strip (issue #2588, ADR 0101 §6) — "the pack pane's last
 * 15% is its status / Peek bar" (issue #2588's own wording; §6 specifies the
 * two snap stops and the strips, not this band's contents), and the band that
 * stays on screen at the POOL stop.
 *
 * Hosting the CTA row here instead of in a Peek Panel deviates from ADR 0101
 * §4 — see `draft-selection-actions.tsx` for the collision that forces it.
 *
 * That last part is what makes it the answer to "a pack arriving while parked
 * on the pool ... starts the timer": the Pick Timer is mounted HERE, so a
 * player arranging their pool sees the countdown for the pack that just
 * landed without the surface growing a second timer. The arrival itself is
 * announced by `pulsing`, which is a ring rather than a jump — and a STATIC
 * ring under reduced motion, since the ring alone still says "something
 * changed here".
 */
export default function DraftPackStatusBar({
    stop,
    pickNumber,
    packLeft,
    pulsing,
    timer,
    densityToggle,
    selected,
    actions,
    onOpenPack,
    style,
}: {
    stop: DraftSnapStop;
    /** 1-based Pick number, matching the room's thin bar. */
    pickNumber: number;
    /** Cards left in the Booster; `0` = waiting for a pack. */
    packLeft: number;
    pulsing: boolean;
    timer: React.ReactNode;
    densityToggle: React.ReactNode;
    selected: { cardId: string; cardName: string } | null;
    actions: readonly EditingSurfaceAction[];
    onOpenPack: () => void;
    style?: React.CSSProperties;
}) {
    const reduceMotion = useReducedMotion();
    const onPool = stop === "pool";
    return (
        <div
            data-slot="draft-pack-status"
            data-pulsing={pulsing ? "true" : undefined}
            style={style}
            onClick={onPool ? onOpenPack : undefined}
            className={cn(
                "flex shrink-0 flex-col justify-center gap-1 border-t border-border-accent/40 bg-surface px-2 py-1",
                pulsing && "ring-2 ring-inset ring-accent",
                pulsing && !reduceMotion && "animate-pulse"
            )}
        >
            {timer}
            {selected ? (
                <DraftSelectionActions
                    cardId={selected.cardId}
                    cardName={selected.cardName}
                    actions={actions}
                    axis="row"
                    stopPropagation={onPool}
                />
            ) : (
                <div className="flex items-center gap-2">
                    <DraftPackState
                        pickNumber={pickNumber}
                        packLeft={packLeft}
                    />
                    <span className="flex-1" />
                    {densityToggle}
                    {onPool && (
                        <button
                            type="button"
                            data-slot="draft-back-to-pack"
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenPack();
                            }}
                            style={{ minHeight: "var(--control-h)" }}
                            className="shrink-0 font-beleren text-[12px] text-accent-strong"
                        >
                            tap: back to pack
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
