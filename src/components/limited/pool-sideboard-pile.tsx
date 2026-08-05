import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { pileHeight } from "~/lib/card-layout";
import { SIDEBOARD_DROP_ID } from "./limitedDraftDrag";
import PoolCardTile from "./pool-card-tile";
import type { PoolPileTile } from "./pool-column-pile";

/** One display sub-pile of the Sideboard. The draft Pool passes a SINGLE
 *  label-less group (one flat pile); the limited deckbuilder passes several,
 *  bucketed by Mana Value (`groupDeckIntoPiles`) — the "grouped vs flat"
 *  divergence, now a prop rather than two components. */
export interface PoolSideboardGroup {
    key: string;
    /** Empty for the flat (draft) pile; a Mana-Value label in the deckbuilder. */
    label: string;
    tiles: PoolPileTile[];
}

/** The ONE Sideboard pane shared by BOTH the draft Pool and the limited
 *  deckbuilder (issue #1581), replacing the two forked panes
 *  (`LimitedPoolSideboard` / the deckbuilder's `DeckPileArea` usage). A SINGLE
 *  `useDroppable` zone (keyed by the shared `SIDEBOARD_DROP_ID`) — dropping a
 *  card anywhere in the pane moves it to the Sideboard — wrapping one or more
 *  overlaid `PoolCardTile` sub-piles. Phase-specific chrome (the deckbuilder's
 *  resizable width + per-zone zoom slider, the draft's fixed narrow column) is
 *  passed via `className` / `headerRight`, not baked in.
 */
export default function PoolSideboardPile({
    title,
    count,
    groups,
    emptyMessage,
    headerRight,
    className,
    countSuffix,
}: {
    title: string;
    /** Total card count shown in the header — the sum across `groups`. */
    count: number;
    groups: PoolSideboardGroup[];
    emptyMessage: string;
    headerRight?: React.ReactNode;
    className?: string;
    countSuffix?: string;
}) {
    const { ref, isDropTarget } = useDroppable({ id: SIDEBOARD_DROP_ID });
    return (
        <div
            ref={ref}
            className={cn(
                "flex flex-col gap-2 transition",
                className,
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex min-w-0 items-baseline gap-2">
                {/* `truncate` (issue #2056): the untruncated title wrapped to
                    3 lines / 72px in an 82px pane — the pane's own header
                    alone consumed 88% of the available height. */}
                <span className="truncate font-semibold font-beleren tracking-wide text-parchment">
                    {title} {count}
                    {countSuffix ?? ""}
                </span>
                {headerRight && (
                    <div className="ml-auto shrink-0 self-center">
                        {headerRight}
                    </div>
                )}
            </div>
            {count === 0 ? (
                <p className="text-sm text-text-muted">{emptyMessage}</p>
            ) : (
                <div className="flex items-start gap-3 overflow-auto">
                    {groups.map((group) => (
                        <div
                            key={group.key}
                            className="flex w-(--card-w) shrink-0 flex-col gap-2"
                        >
                            {group.label && (
                                <div className="flex items-baseline justify-between gap-2 text-xs text-text-muted">
                                    <span className="font-semibold">
                                        {group.label}
                                    </span>
                                    <span className="text-text-disabled">
                                        {group.tiles.length}
                                    </span>
                                </div>
                            )}
                            <div
                                className="relative w-(--card-w)"
                                style={{
                                    height: pileHeight(group.tiles.length),
                                }}
                            >
                                {group.tiles.map(({ key, ...tile }, idx) => (
                                    <PoolCardTile
                                        key={key}
                                        {...tile}
                                        stackIndex={idx}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
