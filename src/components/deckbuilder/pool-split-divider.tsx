import type { useSplitRatio } from "~/components/lobby/deck-builder/useSplitRatio";

type DividerProps = ReturnType<typeof useSplitRatio>["dividerProps"];

/**
 * Draggable vertical handle between the Maindeck and Sideboard panes of the
 * Pool deckbuilder surface. Presentational only — all drag/keyboard state lives
 * in `useSplitRatio`, spread here via `dividerProps`. Hidden below `md`, where
 * the surface stacks the panes vertically and the split doesn't apply.
 */
export default function PoolSplitDivider(props: DividerProps) {
    return (
        <div
            {...props}
            className="group hidden w-1.5 shrink-0 cursor-col-resize touch-none items-stretch justify-center bg-border-subtle/30 transition-colors hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none md:flex"
            aria-label="Resize Maindeck and Sideboard"
        >
            <div className="my-auto h-8 w-0.5 rounded-full bg-border-subtle group-hover:bg-accent group-focus-visible:bg-accent" />
        </div>
    );
}
