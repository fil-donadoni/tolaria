import { useReducedMotion } from "motion/react";
import type { EditingSurfaceAction } from "~/components/editing/editing-surface-action";
import { cn } from "~/lib/utils";
import DraftCardPile from "./draft-card-pile";
import DraftSelectionActions from "./draft-selection-actions";
import type { DraftPileCard } from "./draftPhonePanes";

/**
 * The LANDSCAPE collapsed Booster (issue #2588, ADR 0101 §6) — "on swipe the
 * pack collapses to a vertical pile (20%, timer + 'tap: back to pack')".
 *
 * It is the pack pane's trailing band, so it is what stays on screen once the
 * pool has the width: the Pick Timer lives here at the pool stop, which is
 * the landscape half of "a pack arriving while parked on the pool starts the
 * timer". `pulsing` is the arrival itself — a ring, static under reduced
 * motion.
 *
 * It also carries the Selected Card's CTA row when there is one. The
 * prototype showed only the status here; keeping the CTAs means the primary
 * touch move path (ADR 0101 §4) survives a swipe to the pool instead of
 * forcing a swipe back to reach `Pick`.
 */
export default function DraftCollapsedPackColumn({
    packPile,
    timer,
    status,
    selected,
    actions,
    pulsing,
    onOpenPack,
}: {
    packPile: readonly DraftPileCard[];
    timer: React.ReactNode;
    status: React.ReactNode;
    selected: { cardId: string; cardName: string } | null;
    actions: readonly EditingSurfaceAction[];
    pulsing: boolean;
    onOpenPack: () => void;
}) {
    const reduceMotion = useReducedMotion();
    return (
        <div
            data-slot="draft-collapsed-pack"
            data-pulsing={pulsing ? "true" : undefined}
            onClick={onOpenPack}
            className={cn(
                "flex w-[25%] shrink-0 flex-col items-center gap-1 border-l border-border-accent/40 bg-surface p-1.5",
                pulsing && "ring-2 ring-inset ring-accent",
                pulsing && !reduceMotion && "animate-pulse"
            )}
        >
            <div className="w-full shrink-0">{timer}</div>
            {selected ? (
                <DraftSelectionActions
                    cardId={selected.cardId}
                    cardName={selected.cardName}
                    actions={actions}
                    axis="column"
                    stopPropagation
                />
            ) : (
                <>
                    {status}
                    <DraftCardPile
                        cards={packPile}
                        emptyLabel="waiting for a pack"
                        className="min-h-0 flex-1"
                    />
                </>
            )}
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
        </div>
    );
}
