import { useMemo, useState } from "react";
import { useDroppable } from "@dnd-kit/react";
import type { Color } from "@convex/cards/types";
import {
    canDeleteColumn,
    resolveColumnLayout,
    type CardLookup,
    type ColumnId,
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
import DeckColumnActions from "./deck-column-actions";
import ZoneAddColumnControl from "./zone-add-column-control";
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
    /** The key a Card Pin for ONE COPY is recorded under (ADR 0075 §4, issue
     *  #1626), given the card and its occurrence ordinal among same-`cardId`
     *  cards in THIS zone (0 for the first copy, 1 for the second, …).
     *
     *  Absent = the Constructed rule: every copy shares the `cardId` key, so
     *  pinning one Lightning Bolt files all four. The Limited builder supplies
     *  a per-copy function resolving the ordinal to the Pool's own
     *  `poolIndex`, which is what keeps two physical copies of one card
     *  individually placeable. */
    pinKeyOf?: (card: DeckCard, copyIndex: number) => string;
    /** Manual-Column management (ADR 0075 §2, issue #1626). Supplied as a trio
     *  or not at all; when absent the surface renders no add/rename/delete
     *  affordance, which is the reduced draft-time bar (ADR 0075 §6) and the
     *  Sideboard (whose whole pane is one drop target, so a manual Column
     *  there could never receive a card). */
    onAddColumn?: (label: string) => void;
    onRenameColumn?: (columnId: ColumnId, label: string) => void;
    onDeleteColumn?: (columnId: ColumnId) => void;
}

/** One card of a Zone, carrying the key its Card Pin is recorded under. The
 *  Column Layout engine resolves ITEMS, not card ids — wrapping the pair here
 *  is what lets two physically distinct copies of one card be claimed by two
 *  different Columns (issue #1626), which a `cardId`-keyed adapter cannot
 *  express. */
interface ZoneItem {
    card: DeckCard;
    pinKey: string;
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
    pinKeyOf,
    onAddColumn,
    onRenameColumn,
    onDeleteColumn,
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

    // Each card paired with the key its Pin is recorded under (issue #1626).
    // The ordinal is counted over the UNFILTERED zone, so hiding a card can
    // never renumber the copies that stay visible — the same reason columns
    // resolve from `cards` below.
    const items = useMemo<ZoneItem[]>(() => {
        const seen = new Map<string, number>();
        return cards.map((card) => {
            const copyIndex = seen.get(card.cardId) ?? 0;
            seen.set(card.cardId, copyIndex + 1);
            return {
                card,
                pinKey: pinKeyOf ? pinKeyOf(card, copyIndex) : card.cardId,
            };
        });
    }, [cards, pinKeyOf]);

    // Filtering narrows what's VISIBLE, never what generates a Column — see
    // below (issue #2313 review, F1).
    const visible = useMemo(
        () => filterZoneCards(items, filter, (i) => i.card.cardId, lookup),
        [items, filter, lookup]
    );

    // Columns are resolved from the UNFILTERED `cards`. `generateColumns`
    // (`convex/deckLayout.ts`) derives Grouping `type`'s Column SET from the
    // defs it is handed — the one Grouping whose ladder is not fixed — so
    // resolving against the filtered `visible` array would change WHICH
    // Columns exist as a side effect of hiding cards: a Card Pin naming a
    // Column that no longer generates stops applying (`claimColumnId` step 2
    // requires `generatedIds.has(pinned)`) and the pinned card falls through
    // to its predicate Column, even though it still matches the filter
    // (issue #2313 review, F1 — reproduced with Grouping `type` moving a
    // filter-matching Serra Angel out of a Column it was pinned to). Second
    // order, every empty `type` Column would also vanish as a drop target,
    // contradicting this component's own `dropModel: "columns"` contract
    // above. Resolving against `cards` keeps the Column SET — and every Pin
    // naming one — filter-independent; only Column CONTENTS narrow below.
    const rawColumns = useMemo(
        () =>
            resolveColumnLayout<ZoneItem>({
                layout,
                items,
                adapter: {
                    cardId: (i) => i.card.cardId,
                    // Constructed pins by Card ID (four Lightning Bolts pin
                    // together); Limited pins by the Pool's own `poolIndex`,
                    // so its two physical copies of one card stay
                    // individually placeable (ADR 0075 §4). Which of the two
                    // applies is the host's `pinKeyOf`, resolved above — one
                    // adapter serves both.
                    pinKey: (i) => i.pinKey,
                    tiebreak: (a, b) =>
                        a.card.cardId.localeCompare(b.card.cardId),
                },
                lookup,
            }),
        [layout, items, lookup]
    );

    // The filter narrows each resolved Column's ITEMS — never the Column
    // itself — so a hidden card simply isn't in a Column's `items` and the
    // columns its remaining, still-matching siblings sit in never move
    // (issue #1625 AC), while an empty Column stays a rendered drop target
    // (issue #2313 review, F1).
    const columns = useMemo(
        () =>
            filterActive
                ? rawColumns.map((column) => ({
                      ...column,
                      items: filterZoneCards(
                          column.items,
                          filter,
                          (i) => i.card.cardId,
                          lookup
                      ),
                  }))
                : rawColumns,
        [rawColumns, filterActive, filter, lookup]
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
                    column.items.forEach((item, idx) =>
                        topIndexByCardId.set(item.card.cardId, idx)
                    );
                    return {
                        id: column.id,
                        label: column.label,
                        kind: column.kind,
                        dropId: zoneColumnDropId(zone, column.id),
                        // Deletability is judged on `rawColumns` — the
                        // UNFILTERED resolve — not on the narrowed `column`
                        // being rendered. A Zone filter hides cards without
                        // emptying a Column, so asking the filtered view would
                        // let a filter authorise a deletion that displaces the
                        // very cards it is hiding, breaking the empty-only
                        // rule's whole guarantee ("deleting can never lose a
                        // card", ADR 0075 rationale §2).
                        deletable: canDeleteColumn(rawColumns, column.id),
                        tiles: column.items.map(
                            ({ card, pinKey }, idx): DeckPileTile => ({
                                key: `${column.id}:${card.cardId}:${idx}`,
                                cardId: card.cardId,
                                dragId: `${zone}:${column.id}:${card.cardId}:${idx}`,
                                dragData: {
                                    kind: zone === "maindeck" ? "main" : "side",
                                    cardId: card.cardId,
                                    cardName: card.cardName,
                                    // The COPY being dragged (issue #1626) —
                                    // carried on the payload so the drop
                                    // resolver never has to re-derive which of
                                    // several identical cards moved.
                                    pinKey,
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
            rawColumns,
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

    // The header's count text. The `countSuffix` branch exists because the
    // naive `${visible.length} of ${cards.length}${countSuffix}` reads as
    // `"1 of 2/15"` on the Constructed Sideboard — the `of`-counter runs
    // straight into the `x/15` legality cap with no separator, so it looks
    // like one broken fraction (issue #2313 review, N1). Spelling out
    // "shown"/"total" keeps the cap legible instead of visually merging with
    // the filtered count. `countSuffix` is unset on the Maindeck (it has no
    // cap), so that instance keeps the plain `"N of M"` form.
    const countText = filterActive
        ? countSuffix
            ? `${visible.length} shown, ${cards.length}${countSuffix} total`
            : `${visible.length} of ${cards.length}`
        : `${cards.length}${countSuffix ?? ""}`;

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
                    {title} {countText}
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
                    {onAddColumn && (
                        <ZoneAddColumnControl
                            onAdd={onAddColumn}
                            zoneLabel={title}
                        />
                    )}
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
                        actions={
                            // The Catch-All is never renameable and never
                            // deletable (ADR 0075 §2), so it gets no controls
                            // at all rather than two disabled ones. Renaming
                            // is offered for MANUAL Columns only — a generated
                            // Column's label comes from its Grouping.
                            (onRenameColumn || onDeleteColumn) &&
                            column.kind !== "catchAll" ? (
                                <DeckColumnActions
                                    columnId={column.id}
                                    label={column.label}
                                    onRename={
                                        column.kind === "manual"
                                            ? onRenameColumn
                                            : undefined
                                    }
                                    onDelete={onDeleteColumn}
                                    deletable={column.deletable}
                                />
                            ) : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}
