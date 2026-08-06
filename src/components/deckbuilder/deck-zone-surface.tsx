import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import type { Color } from "@convex/cards/types";
import {
    resolveColumnLayout,
    type CardLookup,
    type ColumnLayout,
    type DeckZone,
    type GroupingKind,
    type OrderingKind,
} from "@convex/deckLayout";
import { cn } from "~/lib/utils";
import type { DeckCard } from "~/types/game";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import DeckColumnPile, { type DeckPileTile } from "./deck-column-pile";
import {
    DEFAULT_ZONE_FILTER,
    filterZoneCards,
    isZoneFilterActive,
    toggleZoneFilterColor,
    zoneFilterSummary,
    type ZoneFilter,
} from "./deckZoneFilter";
import { zoneColumnDropId, zonePaneDropId } from "./deckZoneDrag";
import ZoneColorFilterToggles from "./zone-color-filter-toggles";
import ZoneCreatureFilterSelect from "./zone-creature-filter-select";
import ZoneFilterChip from "./zone-filter-chip";
import ZoneGroupingSelect from "./zone-grouping-select";
import ZoneOrderingSelect from "./zone-ordering-select";

/**
 * THE deckbuilder zone surface (ADR 0075, PRD #1617, issue #1622) — ONE
 * component rendering the Maindeck and the Sideboard of BOTH builders. It
 * replaces the two grouping helpers it retires: the Constructed dynamic
 * Mana-Value piles (`groupDeckIntoPiles`) and the Limited fixed-column ladder
 * (`groupIntoFixedColumns`). Columns and card placement come from the shared
 * Column Layout engine (`convex/deckLayout.ts`) and nowhere else.
 *
 * Two declared drop models, and nothing else varies between the four
 * instances (Constructed × 2, Limited × 2):
 *
 * - **`"columns"`** (Maindeck) — every Column of the Layout renders and is its
 *   own drop target, INCLUDING the empty ones, because an empty Column is
 *   exactly where a player wants to drop a card. A drop records a Card Pin.
 * - **`"pane"`** (Sideboard) — the whole zone is one drop target (a card
 *   dropped in it leaves the deck; no Pin), so its Columns carry no affordance
 *   of their own and the empty ones are hidden. This is what keeps the Limited
 *   Sideboard looking exactly as it did before #1622, when it was grouped by
 *   `groupDeckIntoPiles` into its non-empty Mana-Value piles.
 *
 * The Catch-All Column is never a pin target (`pinNamespace: null`), so it
 * only renders when it actually holds a card — under Grouping `mv` with a
 * registry-resolvable deck it never does, which is why neither builder grows a
 * permanently-empty tenth column. It is the successor of `groupDeckIntoPiles`'
 * trailing `Unknown` pile.
 *
 * Must render under an ancestor `DragDropProvider` — the BUILDER owns it, not
 * this component, because the Constructed builder's search results are
 * draggable too and live outside the zones.
 */
export interface DeckZoneSurfaceProps {
    zone: DeckZone;
    title: string;
    cards: DeckCard[];
    /** This zone's Column Layout — including its own `grouping`/`ordering`,
     *  which the header's controls read directly off (issue #1624). */
    layout: ColumnLayout;
    /** Fires when the Grouping control changes. Never disturbs a Card Pin
     *  (ADR 0075 §3) — the caller applies the change through the engine's own
     *  `setGrouping`, which touches only the `grouping` field. */
    onGroupingChange: (grouping: GroupingKind) => void;
    /** Fires when the Ordering control changes — orthogonal to Grouping, only
     *  re-sorts cards INSIDE each Column (issue #1624). */
    onOrderingChange: (ordering: OrderingKind) => void;
    /** Catalogue lookup handed to the engine. Defaults to the card registry;
     *  a Tabletop (`manual`) deck passes a catalogue-backed one so its
     *  registry-unknown cards still bucket by Mana Value (ADR 0080). */
    lookup?: CardLookup;
    dropModel: "columns" | "pane";
    /** Plain click on a card — remove / move to the other zone. */
    onCardClick: (card: DeckCard) => void;
    /** Tooltip (and the handle tests query) for one card's tile. */
    cardTitle: (card: DeckCard) => string;
    emptyMessage: string;
    /** Count suffix, e.g. `/15` for the Constructed Sideboard limit. */
    countSuffix?: string;
    /** Soft-limit warning shown next to the count. */
    warning?: string | null;
    headerRight?: React.ReactNode;
    /** Resolved Featured Card ID (PRD #589). Constructed Maindeck only. */
    featuredCardId?: string | null;
    /** Presence enables the "Set as featured" affordance on each card's
     *  topmost copy. Constructed Maindeck only. */
    onSetFeatured?: (cardId: string) => void;
}

export default function DeckZoneSurface({
    zone,
    title,
    cards,
    layout,
    onGroupingChange,
    onOrderingChange,
    lookup,
    dropModel,
    onCardClick,
    cardTitle,
    emptyMessage,
    countSuffix,
    warning,
    headerRight,
    featuredCardId,
    onSetFeatured,
}: DeckZoneSurfaceProps) {
    // The Zone build-time filter (issue #1625, ADR 0075 § "Filter is
    // momentary") lives ONLY in this component's own state — never lifted to
    // the builder, never written to `ColumnLayout`, never touching
    // `deckViewPrefs`'s localStorage seam. That is what makes "the filter
    // lives nowhere" (never persisted) true by construction: unmounting this
    // component (closing the deckbuilder) is the only way to lose it, and
    // that is exactly the "reopening always shows everything" guarantee the
    // issue asks for. Each of the two `DeckZoneSurface` instances (Maindeck,
    // Sideboard) owns its own state, so filtering one Zone can never touch
    // the other.
    const [filter, setFilter] = useState<ZoneFilter>(DEFAULT_ZONE_FILTER);
    const filterActive = isZoneFilterActive(filter);

    // Filtering narrows the ITEMS handed to the engine, never the engine's
    // own column-generation logic — a hidden card simply isn't in `visible`,
    // so the columns its remaining siblings sit in are computed exactly as
    // if it had never been in the deck (issue #1625 AC).
    const visible = useMemo(
        () => filterZoneCards(cards, filter, (c) => c.cardId, lookup),
        [cards, filter, lookup]
    );

    const columns = useMemo(
        () =>
            resolveColumnLayout<DeckCard>({
                layout,
                items: visible,
                adapter: {
                    cardId: (c) => c.cardId,
                    // Constructed pins by Card ID (four Lightning Bolts pin
                    // together); Limited resolves its per-copy Pool Pins into
                    // the same cardId-keyed map before handing the Layout over
                    // (ADR 0075 §4), so one adapter serves both.
                    pinKey: (c) => c.cardId,
                    tiebreak: (a, b) => a.cardId.localeCompare(b.cardId),
                },
                lookup,
            }),
        [layout, visible, lookup]
    );

    // The featured affordance/indicator goes on the LAST (topmost, visible)
    // copy of each distinct card in its column — a lower copy's button would
    // sit behind the next card.
    const rendered = useMemo(
        () =>
            columns
                .filter((column) =>
                    dropModel === "columns"
                        ? column.kind !== "catchAll" || column.items.length > 0
                        : column.items.length > 0
                )
                .map((column) => {
                    const topIndexByCardId = new Map<string, number>();
                    column.items.forEach((card, idx) =>
                        topIndexByCardId.set(card.cardId, idx)
                    );
                    return {
                        id: column.id,
                        label: column.label,
                        dropId: zoneColumnDropId(zone, column.id),
                        tiles: column.items.map(
                            (card, idx): DeckPileTile => ({
                                key: `${column.id}:${card.cardId}:${idx}`,
                                cardId: card.cardId,
                                dragId: `${zone}:${column.id}:${card.cardId}:${idx}`,
                                dragData: {
                                    kind: zone === "maindeck" ? "main" : "side",
                                    cardId: card.cardId,
                                    cardName: card.cardName,
                                } satisfies CardDragData,
                                title: cardTitle(card),
                                onClick: () => onCardClick(card),
                                isFeatured:
                                    !!featuredCardId &&
                                    card.cardId === featuredCardId,
                                onSetFeatured:
                                    onSetFeatured &&
                                    topIndexByCardId.get(card.cardId) === idx
                                        ? () => onSetFeatured(card.cardId)
                                        : undefined,
                            })
                        ),
                    };
                }),
        [
            columns,
            dropModel,
            zone,
            cardTitle,
            onCardClick,
            featuredCardId,
            onSetFeatured,
        ]
    );

    // The whole-pane drop target of the `"pane"` model. Registered (but
    // disabled) under the `"columns"` model too: dnd-kit wants a stable id per
    // mounted droppable, and a pane target competing with the Maindeck's own
    // Column targets is exactly the nesting ambiguity that model avoids.
    const { ref: paneRef, isDropTarget } = useDroppable({
        id: zonePaneDropId(zone),
        disabled: dropModel !== "pane",
    });

    return (
        <div
            ref={paneRef}
            className={cn(
                "flex h-full flex-col transition",
                isDropTarget
                    ? "bg-accent-soft/10 ring-2 ring-inset ring-accent/60"
                    : ""
            )}
        >
            <div className="flex min-w-0 flex-wrap items-baseline gap-2 px-3 pt-3 text-sm md:px-4">
                {/* `truncate` (issue #2056): the untruncated title wrapped to
                    3 lines / 72px in an 82px pane. */}
                <span className="truncate font-semibold font-beleren tracking-wide text-parchment">
                    {title}{" "}
                    {filterActive
                        ? `${visible.length} of ${cards.length}`
                        : cards.length}
                    {countSuffix ?? ""}
                </span>
                {warning && (
                    <span className="shrink-0 text-xs font-semibold text-danger-strong">
                        {warning}
                    </span>
                )}
                {filterActive && (
                    <ZoneFilterChip
                        summary={zoneFilterSummary(filter)}
                        onClear={() => setFilter(DEFAULT_ZONE_FILTER)}
                        zoneLabel={title}
                    />
                )}
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2 self-center">
                    <ZoneCreatureFilterSelect
                        value={filter.creature}
                        onChange={(creature) =>
                            setFilter((f) => ({ ...f, creature }))
                        }
                        zoneLabel={title}
                    />
                    <ZoneColorFilterToggles
                        value={filter.colors}
                        onToggle={(color: Color) =>
                            setFilter((f) => toggleZoneFilterColor(f, color))
                        }
                        zoneLabel={title}
                    />
                    <ZoneGroupingSelect
                        value={layout.grouping}
                        onChange={onGroupingChange}
                        zoneLabel={title}
                    />
                    <ZoneOrderingSelect
                        value={layout.ordering}
                        onChange={onOrderingChange}
                        zoneLabel={title}
                    />
                    {headerRight}
                </div>
            </div>
            {cards.length === 0 && (
                <div className="px-3 pt-2 text-sm text-text-muted md:px-4">
                    {emptyMessage}
                </div>
            )}
            {cards.length > 0 && visible.length === 0 && (
                <div className="px-3 pt-2 text-sm text-text-muted md:px-4">
                    No cards match this filter.
                </div>
            )}
            <div className="flex flex-1 items-start gap-3 overflow-auto p-3 md:gap-6 md:p-4">
                {rendered.map((column) => (
                    <DeckColumnPile
                        key={column.id}
                        label={column.label}
                        dropId={column.dropId}
                        droppable={dropModel === "columns"}
                        dataColumn={column.id}
                        tiles={column.tiles}
                    />
                ))}
            </div>
        </div>
    );
}
