import { useCallback, useMemo, useState } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type {
    LimitedPoolCard,
    PoolArrangementEntry,
} from "@convex/limited/eventTypes";
import {
    pinsByPoolIndex,
    splitPoolByArrangement,
} from "@convex/limited/poolArrangement";
import {
    createColumnLayout,
    type ColumnId,
    type ColumnLayout,
    type GroupingKind,
    type OrderingKind,
} from "@convex/deckLayout";
import type { ZoneCard } from "~/types/game";
import { useLimitedEventMutations } from "~/hooks/useLimitedEvent";
import DeckZoneSurface from "~/components/deckbuilder/deck-zone-surface";
import {
    DRAFT_POOL_VIEW_ZONE,
    recordGroupingChange,
    recordOrderingChange,
    seededColumnView,
} from "~/components/deckbuilder/deckZoneColumnView";
import { toZoneCards } from "~/components/deckbuilder/poolZoneCards";
import type { DeckZoneSelection } from "~/components/deckbuilder/deckZoneSelection";
import { cn } from "~/lib/utils";

/**
 * The draft-time Pool (ADR 0060 issues #1247/#1248; ADR 0075 §6 / PRD #1617
 * issue #1632). Since #1632 it renders through **the** shared
 * `DeckZoneSurface` — the same component, the same Column Layout engine, the
 * same Card Pin model as both build views — rather than a fixed Mana-Value
 * ladder of its own. That is the whole point of the slice: a Pin made while
 * drafting and one made while building are literally the same datum on the
 * seat's Pool Arrangement, so there is no second column model to keep in sync
 * and nothing to carry over at the phase boundary.
 *
 * "The draft-time Pool IS the working deck": every card defaults into the Pool
 * (Maindeck) side the instant it is picked, and every move — drag, click —
 * persists immediately via `setPoolArrangementEntry`, so
 * `pool-deck-builder-form.tsx` seeds its working deck from the same
 * `splitPoolByArrangement` + `pinsByPoolIndex` this renders from and shows the
 * arrangement unchanged.
 *
 * Its bar is deliberately **reduced** (ADR 0075 §6):
 *
 * - **Grouping + Ordering only**, persisted per user under their own
 *   preference key (`DRAFT_POOL_VIEW_ZONE`), independent of the build view's
 *   Maindeck/Sideboard — a Grouping picked under a pick timer is not the one a
 *   player wants at the workbench.
 * - **no filter** (`filterable={false}`) — hiding cards while a Booster is in
 *   front of you can hide picks you already made, at exactly the moment you
 *   must not be confused.
 * - **no column add / rename / delete** (the trio simply not passed) — those
 *   are workbench gestures, and the vertical space belongs to the Booster and
 *   the timer. Column PLACEMENT still works by DRAG: a Pool card dropped on a
 *   Column resolves through `limited-draft-table.tsx`'s own `onDragEnd` ->
 *   `handleMoveArrangement`, which is where every Pin this screen records
 *   comes from.
 * - **the touch `"move to…"` path is the Peek Panel** (issue #2667, closing
 *   the gap issue #2584 left behind when it removed the per-tile menu here —
 *   `docs/findings/2584-draft-pool-touch-column-pin.md`, now deleted; this is
 *   the fix it was waiting on). A tap SELECTS a Pool or Sideboard card —
 *   `onCardSelect`/`onPin` below,
 *   supplied by `limited-draft-table.tsx` — which is what puts this Zone's
 *   Columns on the resulting {@link DeckZoneSelection}. The Table owns the
 *   ONE Peek Panel this selection shares with the Booster pack's own
 *   (mutually exclusive: selecting here clears the pack's selection and vice
 *   versa), because two `fixed` panels painting over each other is exactly
 *   what a per-surface panel would produce. `onCardSelect`/`onPin` are
 *   optional so a bare render of this component (its own unit tests) keeps
 *   the pre-#2667 click-moves-immediately behaviour.
 *
 * The Sideboard beside it is the same surface in `"pane"` drop mode, Grouping
 * `none` (one flat pile, as it has always looked) and no controls at all: a
 * 160px strip has no room for a header bar, and a drop anywhere in it means
 * "park this out of my working deck", never a Pin.
 *
 * Both zones' drop targets (`useDroppable`, registered by the shared surface)
 * rely on an ANCESTOR `DragDropProvider` — this component renders none of its
 * own so it shares ONE dnd context with the Booster above it
 * (`limited-draft-table.tsx` owns the provider, so a Booster card can be
 * dragged straight into a Pool Column or the Sideboard).
 */
export default function LimitedDraftPool({
    eventId,
    pool,
    arrangement,
    arrange = "row",
    selection = null,
    onCardSelect,
    onPin,
}: {
    eventId: Id<"limitedEvents">;
    pool: LimitedPoolCard[];
    arrangement: PoolArrangementEntry[] | null;
    /** Where the Sideboard sits (issue #2588, ADR 0101 §6: "the portrait pool
     *  pane splits Main / Sideboard").
     *
     *  `"row"` is the desktop/landscape arrangement this surface has always
     *  had — a 160px Sideboard rail beside the Pool. `"column"` stacks them,
     *  which is the only shape that fits a 390px-wide phone: a rail there
     *  would leave the Pool 230px, i.e. one and a half card columns. Purely a
     *  BOX question — both arrangements mount the same two `DeckZoneSurface`s
     *  with the same drop models, so a Pin made in either is the same datum. */
    arrange?: "row" | "column";
    /** The Table's own selection (issue #2667) — echoed back so the tapped
     *  tile's ring lands on the right copy (`selectedTileKey`, derived per
     *  Zone below). `null`/absent draws no ring, same as no selection. */
    selection?: DeckZoneSelection | null;
    /** Presence is what makes a tap SELECT instead of moving the card
     *  immediately (mirrors `DeckZoneSurface`'s own `onCardSelect` contract).
     *  `limited-draft-table.tsx` always supplies it; a bare render of this
     *  component (its own unit tests) omits it and keeps the pre-#2667
     *  click-moves-immediately behaviour. */
    onCardSelect?: (selection: DeckZoneSelection) => void;
    /** Records a Card Pin from the Peek Panel's "Move to…" sheet — threaded
     *  to the Pool's OWN `DeckZoneSurface` only (`dropModel: "columns"`); the
     *  Sideboard has no Columns to pin into, matching the deckbuilder's own
     *  Maindeck-only wiring (`deck-zones-surface.tsx`). */
    onPin?: (cardId: string, columnId: ColumnId, pinKey: string) => void;
}) {
    const { setPoolArrangementEntry } = useLimitedEventMutations();

    // Seeded from — and written back to — the draft Pool's OWN view-preference
    // key (issue #1632 AC), so flipping the draft to "by colour" never
    // reconfigures the build view's Maindeck and vice versa.
    const [view, setView] = useState(() =>
        seededColumnView(DRAFT_POOL_VIEW_ZONE)
    );

    const split = useMemo(
        () => splitPoolByArrangement(pool, arrangement ?? undefined),
        [pool, arrangement]
    );
    const mainCards = useMemo(() => toZoneCards(split.cards), [split]);
    const sideCards = useMemo(() => toZoneCards(split.sideboard), [split]);

    // The Pool's Column Layout. Its Pins come straight off the live Pool
    // Arrangement, keyed per physical copy — the SAME map
    // `pool-deck-builder-form.tsx` hands its Maindeck, which is what makes a
    // pin recorded here already in effect when the build view opens. There are
    // no manual Columns: those live on the seat's DECK ROW, which does not
    // exist yet during the draft, and the reduced bar offers no way to make
    // one anyway.
    const poolLayout = useMemo<ColumnLayout>(
        () =>
            createColumnLayout({
                grouping: view.grouping,
                ordering: view.ordering,
                pins: pinsByPoolIndex(pool, arrangement ?? undefined),
            }),
        [view, pool, arrangement]
    );

    // Grouping `none` = one whole-zone Column ("All"), which under the
    // `"pane"` drop model renders as the single flat pile the draft Sideboard
    // has always been. Not the user's Sideboard Grouping preference: that is
    // the BUILD view's Sideboard, and its Mana-Value ladder would not fit a
    // 160px strip.
    const sideLayout = useMemo<ColumnLayout>(
        () => createColumnLayout({ grouping: "none", ordering: view.ordering }),
        [view.ordering]
    );

    const setSideboard = useCallback(
        (card: ZoneCard, toSideboard: boolean) => {
            const poolIndex = Number(card.pinKey);
            if (card.pinKey === undefined || !Number.isInteger(poolIndex)) {
                return;
            }
            void setPoolArrangementEntry({
                eventId,
                poolIndex,
                sideboard: toSideboard,
            }).catch(() => {});
        },
        [setPoolArrangementEntry, eventId]
    );

    const handleGroupingChange = useCallback((grouping: GroupingKind) => {
        recordGroupingChange(DRAFT_POOL_VIEW_ZONE, grouping);
        setView((v) => ({ ...v, grouping }));
    }, []);
    const handleOrderingChange = useCallback((ordering: OrderingKind) => {
        recordOrderingChange(DRAFT_POOL_VIEW_ZONE, ordering);
        setView((v) => ({ ...v, ordering }));
    }, []);

    return (
        // `min-h-0` + `overflow-hidden` on both panes is what keeps the
        // Booster and the timer above on screen (issue #1632 AC): the surface's
        // own card area is `flex-1 overflow-auto`, so a Pool of 45 cards
        // scrolls INSIDE its pane instead of growing the flex row and pushing
        // its siblings out of the viewport. A flex child defaults to
        // `min-height: auto` (its content), which is exactly the shape that
        // does the pushing.
        <div
            data-slot="draft-pool"
            data-arrange={arrange}
            className={cn(
                "flex min-h-0 flex-1 overflow-hidden",
                arrange === "column" && "flex-col"
            )}
        >
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <DeckZoneSurface
                    zone="maindeck"
                    title="Pool"
                    cards={mainCards}
                    layout={poolLayout}
                    dropModel="columns"
                    filterable={false}
                    onGroupingChange={handleGroupingChange}
                    onOrderingChange={handleOrderingChange}
                    onCardClick={(card) => setSideboard(card, true)}
                    onCardSelect={onCardSelect}
                    selectedTileKey={
                        selection?.zone === "maindeck"
                            ? selection.tileKey
                            : null
                    }
                    onPin={onPin}
                    cardTitle={(card) =>
                        onCardSelect
                            ? `Remove ${card.cardName} (drag to move zone)`
                            : `Remove ${card.cardName} (double-click, drag, or click)`
                    }
                    emptyMessage="Every card you pick lands here."
                />
            </div>
            <div
                className={cn(
                    "shrink-0 overflow-y-auto border-border-subtle/30",
                    arrange === "column"
                        ? // A third of the pane, floored so a single row of
                          // tiles is always legible rather than clipped.
                          "max-h-[38%] min-h-24 border-t"
                        : "w-40 border-l"
                )}
            >
                <DeckZoneSurface
                    zone="sideboard"
                    title="Sideboard"
                    cards={sideCards}
                    layout={sideLayout}
                    dropModel="pane"
                    filterable={false}
                    onCardClick={(card) => setSideboard(card, false)}
                    onCardSelect={onCardSelect}
                    selectedTileKey={
                        selection?.zone === "sideboard"
                            ? selection.tileKey
                            : null
                    }
                    cardTitle={(card) =>
                        onCardSelect
                            ? `Remove ${card.cardName} from the Sideboard (drag to move zone)`
                            : `Remove ${card.cardName} from the Sideboard (double-click, drag, or click)`
                    }
                    emptyMessage="Move a card here to park it out of your working deck."
                />
            </div>
        </div>
    );
}
