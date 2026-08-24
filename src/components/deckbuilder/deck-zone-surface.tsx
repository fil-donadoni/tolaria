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
import { CARD_LANDSCAPE_COMPACT_W } from "~/lib/cardSizing";
import { useViewportWidth } from "~/hooks/useViewportWidth";
import { useViewportMode } from "~/hooks/useViewportMode";
import type { ZoneCard } from "~/types/game";
import type { CardDragData } from "~/components/lobby/deck-builder/dnd-types";
import DeckColumnPile, { type DeckPileTile } from "./deck-column-pile";
import DeckMvRow from "./deck-mv-row";
import { collapseDuplicateTiles } from "./deckZoneRows";
import type { DeckColumnChoice, DeckZoneSelection } from "./deckZoneSelection";
import EmptyState from "~/components/ui/empty-state";
import {
    DEFAULT_ZONE_FILTER,
    filterZoneCards,
    isZoneFilterActive,
    toggleZoneFilterColor,
    zoneFilterSummary,
    type ZoneFilter,
} from "./deckZoneFilter";
import { zoneColumnDropId, zonePaneDropId } from "./deckZoneDrag";
import CompactChromeDisclosure from "./compact-chrome-disclosure";
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
 *   Below the `md` breakpoint an empty Column is CSS-hidden rather than
 *   unmounted (issue #1633: "empty columns hidden" on narrow screens, so a
 *   swipe never lands on nothing) — it stays mounted and registered as a drop
 *   target at every viewport, which is what keeps every Column a legal
 *   DESKTOP drop target above `md`, unchanged.
 * - **`"pane"`** (Sideboard) — the whole zone is one drop target (a card
 *   dropped in it leaves the deck; no Pin), so its Columns carry no affordance
 *   of their own and the empty ones are hidden (unmounted, at every
 *   viewport — there is nothing to keep reachable as a drop target here).
 *   This is what keeps the Limited Sideboard looking exactly as it did before
 *   #1622, when it was grouped by `groupDeckIntoPiles` into its non-empty
 *   Mana-Value piles.
 *
 * The Catch-All Column is never a pin target (`pinNamespace: null`). Under
 * `"pane"` it follows the same "hidden while empty" rule as every other
 * Column there. Under `"columns"` it is the one Column ALWAYS rendered
 * regardless of emptiness (issue #1633 AC: "the Catch-All is always shown") —
 * the guaranteed landing spot a narrow-screen scroll can never run past. It is
 * the successor of `groupDeckIntoPiles`' trailing `Unknown` pile.
 *
 * The Columns a selection OFFERS as `"Move to…"` destinations (below —
 * the Peek Panel CTA that replaced the per-tile menu in issue #2584)
 * deliberately EXCLUDE the Catch-All and Grouping `none`'s single Column —
 * see `moveMenuColumns`'s own comment for why: `pinCardToColumn`
 * (`convex/deckLayout.ts`) returns the layout unchanged for a
 * `pinNamespace: null` id, so listing one would be an entry that silently
 * does nothing (PR #2333 review, B1).
 *
 * Must render under an ancestor `DragDropProvider` — the BUILDER owns it, not
 * this component, because the Constructed builder's search results are
 * draggable too and live outside the zones.
 */
export interface DeckZoneSurfaceProps {
    zone: DeckZone;
    title: string;
    cards: ZoneCard[];
    /** This zone's Column Layout — including its own `grouping`/`ordering`,
     *  which the header's controls read directly off (issue #1624). */
    layout: ColumnLayout;
    /** Fires when the Grouping control changes. Never disturbs a Card Pin
     *  (ADR 0075 §3) — the caller applies the change through the engine's own
     *  `setGrouping`, which touches only the `grouping` field.
     *
     *  ABSENT ⇒ no Grouping control is rendered, same presence-is-the-switch
     *  convention as {@link DeckZoneSurfaceProps.onAddColumn} below. The draft
     *  Sideboard is the one such Zone (issue #1632): it is a 160px strip beside
     *  the Booster, so two selects in its header would leave no room for cards. */
    onGroupingChange?: (grouping: GroupingKind) => void;
    /** Fires when the Ordering control changes — orthogonal to Grouping, only
     *  re-sorts cards INSIDE each Column (issue #1624). Absent ⇒ no control,
     *  see {@link DeckZoneSurfaceProps.onGroupingChange}. */
    onOrderingChange?: (ordering: OrderingKind) => void;
    /** The momentary Zone filter (issue #1625). `false` renders NO filter
     *  affordance at all — no creature select, no colour toggles, no chip —
     *  which is the draft-time reduced bar (ADR 0075 §6, issue #1632): hiding
     *  cards while a Booster is in front of the player can hide picks they
     *  already made, at exactly the moment they must not be confused.
     *
     *  A boolean rather than the presence of a callback, unlike every other
     *  affordance here, because the filter is this component's OWN state and
     *  has no callback to be absent (see the `useState` below). Defaults to
     *  `true` so the build view's four instances are unchanged. */
    filterable?: boolean;
    /** Catalogue lookup handed to the engine. Defaults to the card registry;
     *  a Tabletop (`manual`) deck passes a catalogue-backed one so its
     *  registry-unknown cards still bucket by Mana Value (ADR 0080). */
    lookup?: CardLookup;
    dropModel: "columns" | "pane";
    /** Plain click on a card — remove / move to the other zone. Receives the
     *  clicked ENTRY, so a host holding several identical cards can act on the
     *  copy that was tapped (issue #1626). */
    onCardClick: (card: ZoneCard) => void;
    /** Tooltip (and the handle tests query) for one card's tile. */
    cardTitle: (card: ZoneCard) => string;
    emptyMessage: string;
    /** Count suffix, e.g. `/15` for the Constructed Sideboard limit. */
    countSuffix?: string;
    /** Soft-limit warning shown next to the count. */
    warning?: string | null;
    headerRight?: React.ReactNode;
    /** Resolved Featured Card ID (PRD #589). Constructed Maindeck only. Draws
     *  the persistent indicator ring; SETTING the Featured Card is the Peek
     *  Panel's CTA (touch) or the deck-detail picker (pointer) since issue
     *  #2584 removed the per-tile overlay button. */
    featuredCardId?: string | null;
    /** A card was SELECTED rather than moved (issue #2584). Supplied by the
     *  pair parent only where a tap means "select" — a touch viewport, where
     *  the Peek Panel is the primary move path. Absent ⇒ a click keeps its
     *  pre-#2584 meaning and fires {@link DeckZoneSurfaceProps.onCardClick}. */
    onCardSelect?: (selection: DeckZoneSelection) => void;
    /** The selected tile's key (`DeckZoneSelection.tileKey`) — draws the
     *  selection ring on exactly the copy that was tapped. */
    selectedTileKey?: string | null;
    /** Manual-Column management (ADR 0075 §2, issue #1626). Supplied as a trio
     *  or not at all; when absent the surface renders no add/rename/delete
     *  affordance, which is the reduced draft-time bar (ADR 0075 §6) and the
     *  Sideboard (whose whole pane is one drop target, so a manual Column
     *  there could never receive a card). */
    onAddColumn?: (label: string) => void;
    onRenameColumn?: (columnId: ColumnId, label: string) => void;
    onDeleteColumn?: (columnId: ColumnId) => void;
    /** Records a Card Pin (issue #1626, `deckZoneDrag.ts`'s
     *  `DeckZoneDragHandlers.onPin`). Presence is what puts this Zone's
     *  Columns on a {@link DeckZoneSelection} — the "Move to…" CTA of the
     *  Peek Panel (issue #2584, replacing the per-tile menu of #1633) — and
     *  only on the `"columns"` drop model, since the `"pane"` Zone
     *  (Sideboard) has no Columns to pin into. */
    onPin?: (cardId: string, columnId: ColumnId, pinKey: string) => void;
}

/** One card of a Zone, carrying the key its Card Pin is recorded under. The
 *  Column Layout engine resolves ITEMS, not card ids — wrapping the pair here
 *  is what lets two physically distinct copies of one card be claimed by two
 *  different Columns (issue #1626), which a `cardId`-keyed adapter cannot
 *  express. */
interface ZoneItem {
    card: ZoneCard;
    pinKey: string;
}

export default function DeckZoneSurface({
    zone,
    title,
    cards,
    layout,
    onGroupingChange,
    onOrderingChange,
    filterable = true,
    lookup,
    dropModel,
    onCardClick,
    cardTitle,
    emptyMessage,
    countSuffix,
    warning,
    headerRight,
    featuredCardId,
    onCardSelect,
    selectedTileKey,
    onAddColumn,
    onRenameColumn,
    onDeleteColumn,
    onPin,
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
    // `filterable === false` renders no way to SET a filter, so the state can
    // only ever be the default — but the flag is folded in here too, so a Zone
    // with no filter affordance can never present a filtered count or an
    // orphaned clear-chip, whatever the state happens to hold.
    const filterActive = filterable && isZoneFilterActive(filter);

    // Each card paired with the key its Pin is recorded under (issue #1626).
    // Read straight OFF the entry — never counted from its position in
    // `cards`. A positional ordinal renumbers on every Maindeck⇄Sideboard
    // move (and would renumber again per filter), which silently re-associates
    // every surviving copy's Pin with a different physical card; carrying the
    // identity on the entry is what makes a move preserve it by construction
    // (PR #2318 review B1). Absent = the Constructed rule, where all copies of
    // a card share the `cardId` key and pin together.
    const items = useMemo<ZoneItem[]>(
        () =>
            cards.map((card) => ({
                card,
                pinKey: card.pinKey ?? card.cardId,
            })),
        [cards]
    );

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
                    // applies is whether the host's entries carry a `pinKey`,
                    // resolved above — one adapter serves both.
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

    // The `"move to…"` menu's own column list (issue #1633) — id + label for
    // every Column the `"columns"` drop model resolves that is actually a PIN
    // TARGET, unfiltered by emptiness or by the Zone filter (same reasoning as
    // `rawColumns` above: the Column SET a Pin can name must never depend on
    // what's currently hidden). Built once per Zone rather than per tile, so
    // every card's menu in this Zone shares one array. Empty on the `"pane"`
    // model — the Sideboard has no Columns to pin into.
    //
    // `pinNamespace !== null` (the SAME predicate `:528` already gates
    // `DeckColumnActions` on) excludes the Catch-All and, under Grouping
    // `none`, its single Column: `onSelect` dispatches straight to `onPin` ->
    // `pinCardToColumn` (`convex/deckLayout.ts:359-367`), which parses the id
    // via `parseColumnId` and returns the layout UNCHANGED for any id with no
    // namespace — the Catch-All's id (`catch-all`) always, and Grouping
    // `none`'s (`all`) too. A menu entry that closes the popover and changes
    // nothing is not "moving" the card anywhere (PR #2333 review, B1).
    //
    // The issue's AC does read "the menu lists manual columns and the
    // Catch-All", but making that entry MEAN something ("move to Catch-All")
    // would require the engine to be able to force a card into the Catch-All
    // over a Grouping's own predicate match — `claimColumnId`
    // (`convex/deckLayout.ts:719-751`) only ever lands a card there when NO
    // Pin and NO generated Column claims it, which is true for almost no real
    // card under `mv`/`color`/`type` (their generated ladders cover every
    // definition). Simply clearing the card's active-namespace Pin does not
    // reach the Catch-All, it just falls back to rule 3 — the SAME generated
    // Column the card already sits in — so a Pin-clearing "move to Catch-All"
    // would silently do nothing useful for the common case. Expressing the
    // AC's Catch-All clause for real needs a new engine primitive (a Pin that
    // outranks a predicate match), which is a `deckLayout.ts` data-model
    // change, not something `onPin(cardId, columnId, pinKey)` can carry as-is
    // — out of scope for this fixup; excluding the entry is preferred over
    // shipping a dead one.
    const moveMenuColumns = useMemo<DeckColumnChoice[]>(
        () =>
            dropModel === "columns"
                ? rawColumns
                      .filter((column) => column.pinNamespace !== null)
                      .map((column) => ({
                          id: column.id,
                          label: column.label,
                      }))
                : [],
        [rawColumns, dropModel]
    );

    // The featured affordance/indicator goes on the LAST (topmost, visible)
    // copy of each distinct card in its column — a lower copy's button would
    // sit behind the next card.
    const rendered = useMemo(
        () =>
            columns
                .filter((column) =>
                    // `"columns"` (Maindeck): every Column renders, INCLUDING
                    // every empty one — the Catch-All included (issue #1633
                    // AC: "the Catch-All is always shown"). Narrow-screen
                    // hiding of an empty non-Catch-All Column is a CSS class
                    // below, not this filter — the Column stays MOUNTED (and
                    // so a legal desktop drop target) at every viewport.
                    // `"pane"` (Sideboard): unchanged, still unmounts an empty
                    // Column outright — it is never a drop target there, so
                    // there is nothing narrow screens need it to keep being.
                    dropModel === "columns" ? true : column.items.length > 0
                )
                .map((column) => {
                    const empty = column.items.length === 0;
                    return {
                        id: column.id,
                        label: column.label,
                        kind: column.kind,
                        // `null` = never a pin target: the Catch-All, and
                        // Grouping `none`'s single whole-Zone Column. Both are
                        // undeletable and unrenameable, so neither gets a
                        // controls menu at all (PR #2318 review NB3).
                        pinNamespace: column.pinNamespace,
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
                        // CSS-hide below `md` while empty (issue #1633) — the
                        // Catch-All is exempt, it always stays reachable.
                        hiddenWhenEmpty:
                            dropModel === "columns" &&
                            empty &&
                            column.kind !== "catchAll",
                        tiles: column.items.map(
                            ({ card, pinKey }, idx): DeckPileTile => {
                                const key = `${column.id}:${card.cardId}:${idx}`;
                                // ONE record per tile: which copy of which
                                // card, in which Column. A tap hands it to
                                // the pair parent, which builds the Peek
                                // Panel's CTA row from it.
                                const selection: DeckZoneSelection = {
                                    zone,
                                    cardId: card.cardId,
                                    cardName: card.cardName,
                                    pinKey,
                                    tileKey: key,
                                    columns:
                                        dropModel === "columns" && onPin
                                            ? moveMenuColumns
                                            : [],
                                };
                                return {
                                    key,
                                    cardId: card.cardId,
                                    dragId: `${zone}:${column.id}:${card.cardId}:${idx}`,
                                    dragData: {
                                        kind:
                                            zone === "maindeck"
                                                ? "main"
                                                : "side",
                                        cardId: card.cardId,
                                        cardName: card.cardName,
                                        // The COPY being dragged (issue #1626) —
                                        // carried on the payload so the drop
                                        // resolver never has to re-derive which of
                                        // several identical cards moved.
                                        pinKey,
                                    } satisfies CardDragData,
                                    title: cardTitle(card),
                                    // A tap SELECTS where the parent asked for
                                    // selection (touch, issue #2584) and keeps its
                                    // pre-#2584 move meaning everywhere else. One
                                    // branch, on slot presence — the surface never
                                    // asks which viewport it is on.
                                    onClick: onCardSelect
                                        ? () => onCardSelect(selection)
                                        : () => onCardClick(card),
                                    isFeatured:
                                        !!featuredCardId &&
                                        card.cardId === featuredCardId,
                                    isSelected: selectedTileKey === key,
                                };
                            }
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
            onCardSelect,
            selectedTileKey,
            featuredCardId,
            onPin,
            moveMenuColumns,
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

    // Issue #2511: the JS reading of `DeckColumnPile`'s own `hidden md:flex`
    // (Tailwind's `md` = 768px), used ONLY to stop rendering controls inside a
    // pile the CSS is hiding. Deliberately NOT `useViewportMode()`: that hook's
    // `portrait` mode also requires portrait ORIENTATION, so a narrow landscape
    // window would hide the pile in CSS while JS still filled it with buttons.
    const narrowWidth = useViewportWidth() < 768;

    // Issue #2584: a phone held UPRIGHT draws each Column as a horizontal ROW
    // (`DeckMvRow`) instead of a vertical pile — see that component for why.
    // `useViewportMode()`, not the width read above, because the arrangement
    // genuinely depends on ORIENTATION: at 844x390 the same phone is back to
    // piles (the issue's landscape AC). There is no CSS twin of this branch to
    // disagree with — the two arrangements are different elements, mounted one
    // at a time, so `index.css`'s "keep the two in step" warning does not
    // apply here the way it does to `narrowWidth`.
    const viewportMode = useViewportMode();
    const asRows = viewportMode === "portrait";

    // Issue #2665: the landscape-phone rung. The gap/padding rungs used to be
    // `md:gap-6 md:p-4` — Tailwind's `md` is a 768px WIDTH breakpoint and a
    // sideways phone is 844px WIDE, so it cleared `md:` and took the DESKTOP
    // gutter on a viewport with 390px of height. Nothing those classes can see
    // separates the two shapes; only the height does, which is precisely what
    // `useViewportMode()`/`compact-chrome:` discriminate on.
    //
    // Read from the SAME hook as `asRows` above, and it is the JS twin of the
    // `compact-chrome:` classes already on the strip (`index.css`'s "keep the
    // two in step" warning): both resolve to
    // `(orientation: landscape) and (max-height: 500px)`, so the density rung,
    // the strip's own `min-h`/`flex-none` and the header suppression below can
    // never disagree about which rung is on screen. Deliberately NOT
    // `narrowWidth` above — that read is `md`-keyed on purpose (it mirrors the
    // pile's own `hidden md:flex`) and a landscape phone is not narrow.
    const landscapeCompact = viewportMode === "landscape-compact";

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
            /* Issue #2665. Captures the tile width this surface INHERITS so the
               strip below can floor it at `CARD_LANDSCAPE_COMPACT_W` without a
               `var(--card-w)` self-reference — a custom property whose own value
               reads itself is a cycle and computes to nothing, whichever element
               declares it, so the floor genuinely needs two elements. Flooring
               (rather than replacing) is what keeps the per-zone zoom slider
               live on this rung, and reading the inherited value is what makes
               ONE expression serve both hosts: the deck builders inherit
               `calc(cardBase * zoom)` from `deck-zones-surface.tsx`'s `zoomVars`,
               while the Draft Room's Pool/Sideboard set nothing and inherit the
               board's global `--card-w` (`index.css`) — measured 90.0px and
               37.0px respectively at 844x390x3 before this change. */
            style={
                landscapeCompact
                    ? ({
                          "--card-w-inherited": "var(--card-w)",
                      } as React.CSSProperties)
                    : undefined
            }
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
                {/* `min-w-0`, no `shrink-0` (issue #2511, tightened by #2585
                    review finding #2): `shrink-0` pinned this cluster at its
                    max-content size inside a pane narrower than it, and the
                    pane clips (`overflow-hidden` with no horizontal
                    scroller), so the tail of the row landed OUTSIDE the
                    viewport with no scrollable ancestor — unreachable by any
                    gesture (4 stranded controls at 844x390, 1 at 390x844).
                    It used to apply only above `md` (`md:shrink-0`), leaving
                    the default shrinkable below `md` so `flex-wrap` could do
                    the wrapping it was always meant to; but the source-panel
                    dock (#2585) narrows the zones pane at 1440x900/1180x820
                    too — both >= `md` — so `md:shrink-0` pinned this cluster
                    THERE as well, stranding/occluding 4 more controls at the
                    headline desktop viewport. Dropping `shrink-0` outright
                    (not just its `md:` gate) lets the cluster shrink and wrap
                    at every width — measured back to 0/0 stranded/occluded at
                    all five viewports, and it also clears the pre-existing
                    820x1180 debt (9 stranded/2 occ -> 0/0). */}
                <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2 self-center">
                    {/* Issue #2511: two zones x ~98px of control rows is a
                        fifth of a phone's viewport spent on affordances that
                        refine a view the player cannot see yet. Folded behind
                        one toggle per zone on a phone-shaped viewport; rendered
                        verbatim on a desktop-shaped one. */}
                    <CompactChromeDisclosure label="View">
                        {filterable && (
                            <>
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
                                        setFilter((f) =>
                                            toggleZoneFilterColor(f, color)
                                        )
                                    }
                                    zoneLabel={title}
                                />
                            </>
                        )}
                        {onGroupingChange && (
                            <ZoneGroupingSelect
                                value={layout.grouping}
                                onChange={onGroupingChange}
                                zoneLabel={title}
                            />
                        )}
                        {onOrderingChange && (
                            <ZoneOrderingSelect
                                value={layout.ordering}
                                onChange={onOrderingChange}
                                zoneLabel={title}
                            />
                        )}
                        {onAddColumn && (
                            <ZoneAddColumnControl
                                onAdd={onAddColumn}
                                zoneLabel={title}
                            />
                        )}
                        {headerRight}
                    </CompactChromeDisclosure>
                </div>
            </div>
            {cards.length === 0 && (
                <div className="px-3 pt-2 md:px-4">
                    <EmptyState message={emptyMessage} />
                </div>
            )}
            {cards.length > 0 && visible.length === 0 && (
                <div className="px-3 pt-2 md:px-4">
                    <EmptyState message="No cards match this filter." />
                </div>
            )}
            {/* THE floor (issue #2511). This strip is the scroll container the
                probe measured at 24-66px around 101-158px card tiles: as a
                `flex-1` child of a fixed-height column it absorbed every pixel
                the chrome bands did not leave, and a horizontal scroller cannot
                recover height a tile needs all at once.

                On a phone-shaped viewport it stops flexing (`flex-none`) and
                takes a floor of ONE card row: `--card-h` is the per-zone
                zoomed card height (`zoomVars`, `deck-zones-surface.tsx`), and
                `3.5rem` is the pile's own chrome around it (label row + gaps +
                the strip's `p-3`). Deriving the floor from the SAME variable
                the tiles are drawn from is what keeps the two in step when the
                player moves the zoom slider — a hard-coded `min-h` would go
                stale at the first zoom step.

                The floor only holds because nothing above clips it any more:
                `deck-zones-surface.tsx` and `deck-builder-shell.tsx` stop
                bounding the pane under `compact-chrome:`, so the shell's one
                scroll wrapper absorbs the overflow instead of the cards.
                Above `md` on a desktop-shaped viewport this is unchanged.

                The ROWS branch needs no such floor, and that asymmetry is
                deliberate rather than an oversight: it is not `flex-1`, so it
                never absorbs leftover height — the rows stack DOWN and the
                pane scrolls past them (issue #2584). Measured 2026-08-20 in
                the tightest place this surface now renders, the Draft Room's
                phone-portrait pool stop, where TWO of these share ~70% of a
                390x844 screen (issue #2588): `cards zero0 occ0 stranded0`,
                `starved0`, tiles at full height — the `draft-pool-stop` row
                in `scripts/ui-gate/budgets.json` is that measurement. */}
            <div
                className={cn(
                    "flex overflow-auto md:snap-none",
                    // Issue #2665 — the DENSITY rung. `p-3 md:p-4` / `gap-3
                    // md:gap-6` is a WIDTH ladder and had no rung for a
                    // viewport that is wide AND short, so the landscape phone
                    // took the desktop end of it (24px gutters, 16px padding,
                    // measured). Chosen in JS rather than by adding a
                    // `compact-chrome:` class beside the `md:` one because two
                    // variants of equal specificity are resolved by the order
                    // Tailwind happens to emit them in — an invisible
                    // dependency for a rule whose whole job is to BEAT `md:`.
                    // The branch emits one rung and never both.
                    landscapeCompact ? "gap-2 p-2" : "p-3 md:p-4",
                    asRows
                        ? // Issue #2584: rows stack DOWN the pane and the pane
                          // itself is what scrolls vertically; each row owns its
                          // own horizontal scroller with
                          // `overscroll-behavior-x: contain`.
                          "flex-col items-stretch gap-2 overscroll-y-contain"
                        : cn(
                              "flex-1 items-start snap-x snap-mandatory compact-chrome:min-h-[calc(var(--card-h)+3.5rem)] compact-chrome:flex-none",
                              !landscapeCompact && "gap-3 md:gap-6"
                          )
                )}
                /* The freed gutter goes to the TILES (issue #2665 AC), as a
                   floor over the inherited width captured on the pane above —
                   so a zoom slider dragged up still wins, and every other
                   viewport keeps exactly the width it had. `--card-h` is
                   re-derived here rather than inherited because this element's
                   own `compact-chrome:min-h-[calc(var(--card-h)+3.5rem)]` reads
                   it, and `pileHeight()` reads it again on every Column. */
                style={
                    landscapeCompact
                        ? ({
                              "--card-w": `max(${CARD_LANDSCAPE_COMPACT_W}, var(--card-w-inherited))`,
                              "--card-h": `calc(max(${CARD_LANDSCAPE_COMPACT_W}, var(--card-w-inherited)) * 7 / 5)`,
                          } as React.CSSProperties)
                        : undefined
                }
            >
                {asRows
                    ? rendered.map((column) => (
                          <DeckMvRow
                              key={column.id}
                              label={column.label}
                              dropId={column.dropId}
                              droppable={dropModel === "columns"}
                              dataColumn={column.id}
                              tiles={collapseDuplicateTiles(column.tiles)}
                              hiddenWhenEmpty={column.hiddenWhenEmpty}
                          />
                      ))
                    : rendered.map((column) => (
                          <DeckColumnPile
                              key={column.id}
                              label={column.label}
                              dropId={column.dropId}
                              droppable={dropModel === "columns"}
                              dataColumn={column.id}
                              tiles={column.tiles}
                              hiddenWhenEmpty={column.hiddenWhenEmpty}
                              showHeader={!landscapeCompact}
                              /* A Column that is not a pin target is never
                                 renameable and never deletable (ADR 0075 §2), so
                                 it gets no controls at all rather than two
                                 disabled ones. Renaming is offered for MANUAL
                                 Columns only — a generated Column's label comes
                                 from its Grouping.

                                 …and a Column the pile is CSS-hiding below `md`
                                 (`hiddenWhenEmpty`, issue #1633) gets none either
                                 (issue #2511): the controls inside a
                                 `display: none` pile are unreachable but still in
                                 the document, which is 9 zero-size buttons on the
                                 Limited Maindeck at 390x844 — dead tab stops the
                                 browser probe counts and a reader cannot see.
                                 `narrowWidth` is the JS twin of the pile's own
                                 `hidden md:flex`, read from the SAME `md`
                                 breakpoint number so the two cannot disagree.

                                 The landscape-phone rung (issue #2665) is the
                                 third such case and the same reasoning: there is
                                 no header to render these INTO there. Unlike the
                                 other two cases, this one needs no gate of its
                                 own here — `showHeader={!landscapeCompact}` above
                                 already unmounts the whole header row `actions`
                                 would sit in (`{showHeader && (…)}` in
                                 `deck-column-pile.tsx`), so whatever this prop
                                 evaluates to on that rung is never rendered.
                                 Rename/delete stay workbench gestures, as
                                 `DeckMvRow` already decided for phone-portrait. */
                              actions={
                                  (onRenameColumn || onDeleteColumn) &&
                                  column.pinNamespace !== null &&
                                  !(column.hiddenWhenEmpty && narrowWidth) ? (
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
