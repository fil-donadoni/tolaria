import { useContext, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CardInstance } from "~/types/game";
import { useInertialScroll } from "~/hooks/useInertialScroll";
import { useViewportWidth } from "~/hooks/useViewportWidth";
import { GameContext } from "~/hooks/useGameContext";
import { SLOT_SPRING } from "~/lib/board-motion";
import { V4_COUNT_BADGE } from "~/lib/board-chrome-v4";
import {
    PILE_TILE_BOX,
    PILE_GRID_COMPACT_BREAKPOINT_PX,
    PILE_GRID_TILE_PX,
    PILE_GRID_TILE_W,
} from "~/lib/card-layout";
import GameDialog from "~/components/ui/game-dialog";
import SegmentedControl from "~/components/ui/segmented-control";
import ArrivalGlow from "./arrival-glow";
import CardTilt3D from "./card-tilt-3d";
import CardBack from "../cards/card-back";
import CardImage from "../cards/card-image";
import ManualCardMenu from "./manual-card-menu";
import { COUNTER_TONE_CLASS, getCounterDisplays } from "~/lib/counters";
import {
    buildCategorySections,
    type PileCategory,
} from "~/lib/categorized-pile";
import { pickerRingClass } from "~/lib/picker-ring";

/** Small counter chips overlaid on a revealed pile card (fan/grid dialog) —
 *  the exile/graveyard pickers need them (Dauthi Voidwalker's void counter is
 *  the eligibility marker of `choose-exile-card`). Same plate language as the
 *  battlefield CounterBadges, sized down for dialog cards. */
function PileCounterChips({ card }: { card: CardInstance }) {
    const chips = getCounterDisplays(card);
    if (chips.length === 0) return null;
    return (
        <div className="absolute top-1 left-1 z-10 flex flex-col items-start gap-0.5 pointer-events-none">
            {chips.map((c) => (
                <span
                    key={c.type}
                    className={`${COUNTER_TONE_CLASS[c.tone]} rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.9)]`}
                >
                    {c.short}
                    {c.count > 1 ? ` ×${c.count}` : ""}
                </span>
            ))}
        </div>
    );
}

/** The ordinary empty-zone placeholder (icon or label, no interaction of its
 *  own) — shared by CardsPile's two empty-pile renders: the fully
 *  uncontrolled early return (no dialog needed, nothing to browse) and the
 *  `hasContextMenu` collapsed-stack slot (issue #2345 follow-up, PR #2356),
 *  which keeps the dialog mounted below it so the menu's "Browse pile…" item
 *  has something to open even at zero cards. */
function EmptyPilePlaceholder({
    zoneIcon,
    emptyLabel,
}: {
    zoneIcon?: React.ReactNode;
    emptyLabel?: string;
}) {
    return (
        <div
            className={`group ${PILE_TILE_BOX} card-corner flex items-center justify-center border border-[var(--hairline-strong)] p-2 text-center`}
        >
            {zoneIcon ? (
                <span
                    aria-label={emptyLabel}
                    className="opacity-90 transition duration-200 group-hover:opacity-100 group-hover:scale-110"
                >
                    {zoneIcon}
                </span>
            ) : (
                <span className="text-text-muted text-xs">
                    {emptyLabel || "No cards"}
                </span>
            )}
        </div>
    );
}

function seededRandom(seed: number) {
    const x = Math.sin(seed + 1) * 10000;
    return x - Math.floor(x);
}

type CardsPileProps = {
    cards: CardInstance[];
    isFaceDown?: boolean;
    /** ADR 0026 — per-card face-up override. When provided, a card renders
     *  face-up iff its instance id is in this set, regardless of `isFaceDown`.
     *  Lets a hidden pile (library) reveal only the positions the viewer
     *  legitimately knows (`knownTo`) while the rest stay backs. */
    faceUpIds?: ReadonlySet<string>;
    /** Face-up override for the COLLAPSED board stack only (the dialog keeps
     *  using `faceUpIds`). The library passes a top-only set here so the small
     *  zone peek reveals just the topmost known card (scry / Mishra's Bauble),
     *  never a deeper known position, while the browse dialog still shows every
     *  known card. Defaults to `faceUpIds` when omitted (other zones render the
     *  same face-up cards in both surfaces). */
    collapsedFaceUpIds?: ReadonlySet<string>;
    emptyLabel?: string;
    /** Zone glyph shown (centered) in place of the text label when the pile is
     *  empty — e.g. a `Skull` for the graveyard, `Sparkles` for exile. Falls
     *  back to `emptyLabel` text when absent. `emptyLabel` is kept as the
     *  accessible label. */
    zoneIcon?: React.ReactNode;
    title?: string;
    layout?: "fan" | "grid";
    onCardClick?: (card: CardInstance) => void;
    /** Per-card action overlay rendered on top of each revealed card in the
     *  expanded dialog (fan/grid). `onClose` collapses the dialog so the host's
     *  action (e.g. cast-from-exile) can dismiss the reveal after dispatch.
     *  Returns null for cards with no action. Used by the Exile zone to surface
     *  a Cast button on cast-from-exile cards (CR 601.3e). */
    renderCardAction?: (
        card: CardInstance,
        onClose: () => void
    ) => React.ReactNode;
    forceOpen?: boolean;
    /** Instance ids currently selected by the chooser. Selected cards get a
     *  distinct ring so multi-pick selections (e.g. a `search-library`
     *  choice) show per-card feedback instead of all-amber. */
    selectedIds?: string[];
    /** Allow-list for a filtered search (issue #933). When provided, only
     *  cards whose id is in the set render the selectable (amber) ring and
     *  respond to clicks — every other revealed card renders dimmed and
     *  inert. `undefined` means unfiltered: every card stays selectable, the
     *  pre-#933 behavior. */
    eligibleIds?: ReadonlySet<string>;
    /** Rendered inside the expanded dialog below the cards. Used by the
     *  `search-library` picker to host its confirm button: the dialog opens
     *  as a modal (`forceOpen`) and would otherwise cover the board-level
     *  PendingChoicePrompt, leaving the chooser no reachable way to commit. */
    footer?: React.ReactNode;
    /** Minimize affordance forwarded to the dialog (issue #315). When set, the
     *  expanded pile dialog shows a minimize control; used by the blocking
     *  library-pick modal so the chooser can collapse it to the board
     *  indicator without dismissing the Pending Choice. */
    onMinimize?: () => void;
    /** Controlled-open mode (#336, portrait chips). When BOTH are provided the
     *  pile renders ONLY its reveal dialog — the collapsed card-stack visual is
     *  suppressed and the OWNER supplies the trigger (a tappable chip). This
     *  reuses the entire reveal surface (fan/grid layout, inertial scroll, card
     *  targeting) unchanged; only the collapsed affordance is swapped. Unlike
     *  `forceOpen` the dialog stays dismissable. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Library ordering (ADR 0026): render the TOP of the library on the RIGHT
     *  with the topmost card highest, in BOTH the collapsed zone stack and the
     *  expanded dialog — so the known top cards (scry / Mishra's Bauble peek)
     *  read the same way as the scry drag picker. Only the library passes this;
     *  every other zone keeps its default order. */
    topOnRight?: boolean;
    /** Categorized reveal grouping (issue #1364, Atraxa / Niv-Mizzet). When set
     *  (grid layout only), the pile is split into one labelled section per
     *  category. Purely visual — legality is still the server-side matching. */
    categories?: PileCategory[];
    /** An ancestor wraps this tile in its OWN context menu (issue #2345 — a
     *  library / graveyard / exile tile with pile actions). Left click is
     *  this app's context-menu gesture (`ContextMenuTrigger` synthesizes a
     *  `contextmenu` from any un-`preventDefault`ed left click); the
     *  collapsed stack's own `onClick` would fire FIRST and open the browse
     *  dialog before that synthesis ever runs, opening both surfaces on one
     *  click. When true, the collapsed stack renders with NO click handler
     *  of its own — the click bubbles untouched to the ancestor's trigger,
     *  which owns it. Browsing then requires `open`/`onOpenChange` to be
     *  supplied (typically from the same "Browse pile…" menu item's
     *  `onSelect`) — this flag also keeps the collapsed stack visible while
     *  those are controlled, unlike the #336 chip mode below, whose whole
     *  point is to suppress it. */
    hasContextMenu?: boolean;
    /** Per-card caption printed UNDER the card in the reveal dialog. Used by the
     *  attachment cluster for the "Attached to: X" line (CR 303.4 / 301.5), where
     *  the pile TITLE names one host but individual cards may enchant each other
     *  (Power Leak on Holy Strength). Return null for cards with no caption. */
    captionFor?: (card: CardInstance) => string | null;
};

/** Resolves whether a single card renders face-down. A `faceUpIds` set (ADR
 *  0026) overrides the pile-wide `isFaceDown` for individually-known cards. */
function isCardFaceDown(
    card: CardInstance,
    isFaceDown: boolean,
    faceUpIds?: ReadonlySet<string>
): boolean {
    if (faceUpIds?.has(card.id)) return false;
    return isFaceDown;
}

/** Fraction of a card's width that each fanned card overlaps its left
 *  neighbour. The visible step per card is `1 - FAN_OVERLAP`, and the whole
 *  fan's width is derived from it so the flex container hugs the cards with no
 *  empty trailing space. */
const FAN_OVERLAP = 0.8;

/** Priority order for the plain-browse type filter (issue #2729, "segmented
 *  filter footer"). A card carrying several of these types (an artifact
 *  creature) lands in the FIRST bucket that matches, same first-match-wins
 *  shape as `buildCategorySections` above — a card never shows under two
 *  filter buttons. Purely a client-side display grouping over a pile already
 *  on screen: it never touches choice legality, which stays
 *  `eligibleIds`/`onCardClick` (server-driven, CR 601.2c). */
const PILE_FILTER_TYPE_ORDER = [
    "Creature",
    "Land",
    "Instant",
    "Sorcery",
    "Artifact",
    "Enchantment",
    "Planeswalker",
] as const;

const PILE_FILTER_ALL = "all";

/** Plural button label per bucket — a naive `${type}s` suffix mangles
 *  "Sorcery" → "Sorcerys" and over-pluralizes the "Other" catch-all. */
const PILE_FILTER_LABEL: Record<string, string> = {
    Creature: "Creatures",
    Land: "Lands",
    Instant: "Instants",
    Sorcery: "Sorceries",
    Artifact: "Artifacts",
    Enchantment: "Enchantments",
    Planeswalker: "Planeswalkers",
    Other: "Other",
};

/** First matching top-level type from `PILE_FILTER_TYPE_ORDER`, else
 *  `"Other"` (Battle, Kindred-only, and any future type not in the list). */
function pileFilterType(card: CardInstance): string {
    const types = card.types ?? [];
    for (const type of PILE_FILTER_TYPE_ORDER) {
        if (types.includes(type)) return type;
    }
    return "Other";
}

/** The filter buttons to render: `"All"` plus one per type actually present
 *  among `cards`, in `PILE_FILTER_TYPE_ORDER` (then `"Other"` last) —
 *  mirrors `CategoryHeader`'s "empty sections show no header" rule so a
 *  mono-type pile (an all-Mountain library) never grows a useless button. */
function pileFilterOptions(
    cards: CardInstance[]
): { value: string; label: string }[] {
    const present = new Set(cards.map(pileFilterType));
    const types = [...PILE_FILTER_TYPE_ORDER, "Other"].filter((t) =>
        present.has(t)
    );
    return [
        { value: PILE_FILTER_ALL, label: "All" },
        ...types.map((t) => ({ value: t, label: PILE_FILTER_LABEL[t] })),
    ];
}

/** Whether a revealed card is a legal pick under an (optional) filtered
 *  search allow-list (issue #933). No `eligibleIds` means an unfiltered
 *  search — every card stays selectable. */
function isEligibleCard(
    cardId: string,
    eligibleIds?: ReadonlySet<string>
): boolean {
    return !eligibleIds || eligibleIds.has(cardId);
}

function FanLayout({
    cards,
    isFaceDown,
    faceUpIds,
    onCardClick,
    renderCardAction,
    onClose,
    selectedIds,
    eligibleIds,
    captionFor,
    topOnRight = false,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    faceUpIds?: ReadonlySet<string>;
    onCardClick?: (card: CardInstance) => void;
    renderCardAction?: (
        card: CardInstance,
        onClose: () => void
    ) => React.ReactNode;
    onClose: () => void;
    selectedIds?: string[];
    eligibleIds?: ReadonlySet<string>;
    captionFor?: (card: CardInstance) => string | null;
    /** Library ordering: put the TOP of the library on the RIGHT, each card
     *  overlapping its left neighbour so the topmost sits highest (matches the
     *  scry drag picker). The input is top→bottom; rendering it reversed makes
     *  the last-painted (top) card the rightmost and visually on top. */
    topOnRight?: boolean;
}) {
    // A full library fans to many overlapping cards that overflow the dialog
    // width. Inertial drag-to-pan (Arena-like) makes browsing the reveal feel
    // physical; native wheel + keyboard scroll stay intact (#255).
    const scrollRef = useInertialScroll<HTMLDivElement>("x");
    const ordered = topOnRight ? [...cards].reverse() : cards;

    // When the fan overflows, open scrolled to the far RIGHT — the end of the
    // fan, whose cards paint last and sit on top. For a library (topOnRight)
    // that end is the top of the deck; for any pile it's the visually on-top
    // side, so browsing always starts at the most-relevant edge.
    //
    // Deferred to a rAF and jumped INSTANTLY: on open the dialog auto-focuses
    // its content, which resets this scroller to 0 AFTER a synchronous effect
    // runs, and the container's `scroll-behavior: smooth` turns a same-tick set
    // into an animation that focus then cancels. Running past the focus reset
    // and bypassing smooth makes the end-of-fan position stick.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const raf = requestAnimationFrame(() => {
            el.scrollTo({ left: el.scrollWidth, behavior: "instant" });
        });
        return () => cancelAnimationFrame(raf);
    }, [scrollRef, cards.length]);
    return (
        <div
            ref={scrollRef}
            tabIndex={0}
            className="overflow-x-auto px-2 py-6 outline-none focus-visible:ring-1 focus-visible:ring-border-accent/60"
            style={
                {
                    "--pile-card-w": "clamp(5.5rem, 14vw, 13rem)",
                    scrollBehavior: "smooth",
                } as React.CSSProperties
            }
        >
            <div
                className="flex mx-auto"
                style={{
                    // First card is full width; each subsequent card adds only
                    // its visible step (1 - FAN_OVERLAP), matching the negative
                    // marginLeft below so the container has no empty trailing gap.
                    width: `calc(var(--pile-card-w) * ${1 + (1 - FAN_OVERLAP) * (cards.length - 1)})`,
                    minWidth: "min-content",
                }}
            >
                {ordered.map((cardInstance, cardIndex) => {
                    const faceDown = isCardFaceDown(
                        cardInstance,
                        isFaceDown,
                        faceUpIds
                    );
                    // Same hover language as a hand / battlefield card (QA): the
                    // 3D tilt + glare wraps every pile card too, so graveyard,
                    // exile and every dialog pile react identically to the
                    // pointer instead of sitting inert.
                    const inner = (
                        <CardTilt3D>
                            {faceDown ? (
                                <CardBack />
                            ) : (
                                // Fan dialog cards render up to 13rem (208px)
                                // wide (--pile-card-w) — a mid/large slot, no
                                // `thumb`.
                                <CardImage
                                    card={cardInstance}
                                    sizes="208px"
                                    includeThumb={false}
                                />
                            )}
                        </CardTilt3D>
                    );
                    const isEligible = isEligibleCard(
                        cardInstance.id,
                        eligibleIds
                    );
                    const clickable = !faceDown && !!onCardClick && isEligible;
                    const isIneligible =
                        !faceDown && !!onCardClick && !isEligible;
                    const isSelected =
                        selectedIds?.includes(cardInstance.id) ?? false;
                    const action = renderCardAction?.(cardInstance, onClose);
                    return (
                        <div
                            key={cardInstance.id}
                            className="relative w-(--pile-card-w) aspect-5/7 shrink-0"
                            style={{
                                marginLeft:
                                    cardIndex === 0
                                        ? "0"
                                        : `calc(var(--pile-card-w) * -${FAN_OVERLAP})`,
                            }}
                        >
                            {clickable ? (
                                <button
                                    type="button"
                                    onClick={() => {
                                        onCardClick(cardInstance);
                                        onClose();
                                    }}
                                    className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer ${pickerRingClass(isSelected)}`}
                                >
                                    {inner}
                                </button>
                            ) : isIneligible ? (
                                <div className="w-full h-full card-corner opacity-40">
                                    {inner}
                                </div>
                            ) : (
                                // Manual-mode QA round 3 — a pile card is
                                // interactive here, carrying its own move
                                // verbs. Passthrough on every GRE board and in
                                // every picker (`clickable` above wins, so a
                                // choice dialog's click is never hijacked).
                                <ManualCardMenu card={cardInstance}>
                                    {inner}
                                </ManualCardMenu>
                            )}
                            <PileCounterChips card={cardInstance} />
                            {action}
                            {!faceDown && captionFor?.(cardInstance) && (
                                <span className="absolute -bottom-5 inset-x-0 text-center text-[10px] leading-tight text-text-muted">
                                    {captionFor(cardInstance)}
                                </span>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/** `CardImage` `sizes`/`includeThumb` for the grid pile/picker tile, derived
 *  from the LIVE viewport width (issue #1817, opus review round 2). Mirrors
 *  `PILE_GRID_TILE_W`'s own breakpoints so the hint describes the REAL
 *  rendered width instead of a media-conditional `sizes` string the browser
 *  can't act on — the previous `sizes="(min-width:640px) 112px, 64px"` was a
 *  no-op: with `includeThumb: false` the smallest available srcset candidate
 *  is `grid` 488w regardless of which branch of the hint "wins"
 *  (`src/lib/images.ts:46-52`). Below the compact breakpoint the tile is a
 *  genuinely SMALL slot (≤96px, `images.ts`'s own bucketing), so
 *  `includeThumb` flips back to `true` there — a 60-card library browse on a
 *  phone must fetch 146w thumbs, not 60×488w `grid` renditions. At/above it
 *  the tile is `images.ts`'s MID slot ("pickers ~112px, pile dialogs") and
 *  keeps `includeThumb: false` as before. */
function gridImageSizing(viewportWidth: number): {
    sizes: string;
    includeThumb: boolean;
} {
    if (viewportWidth < PILE_GRID_COMPACT_BREAKPOINT_PX) {
        return { sizes: `${PILE_GRID_TILE_PX}px`, includeThumb: true };
    }
    // Tailwind's `sm:` breakpoint (640px) — matches PILE_GRID_TILE_W's w-24 →
    // sm:w-28 step.
    if (viewportWidth < 640) {
        return { sizes: "96px", includeThumb: false };
    }
    return { sizes: "112px", includeThumb: false };
}

/** One selectable grid card — shared by the flat grid and the per-category
 *  sections so both render identical affordances (ring, dim, counters, action). */
function GridCard({
    cardInstance,
    isFaceDown,
    faceUpIds,
    onCardClick,
    renderCardAction,
    onClose,
    selectedIds,
    eligibleIds,
    captionFor,
    imageSizing,
}: {
    cardInstance: CardInstance;
    isFaceDown: boolean;
    faceUpIds?: ReadonlySet<string>;
    onCardClick?: (card: CardInstance) => void;
    renderCardAction?: (
        card: CardInstance,
        onClose: () => void
    ) => React.ReactNode;
    onClose: () => void;
    selectedIds?: string[];
    eligibleIds?: ReadonlySet<string>;
    captionFor?: (card: CardInstance) => string | null;
    /** Computed once per dialog open by `GridLayout` (not per-card — a 60-card
     *  library browse would otherwise subscribe 60 `resize` listeners) via
     *  `gridImageSizing`. */
    imageSizing: { sizes: string; includeThumb: boolean };
}) {
    const faceDown = isCardFaceDown(cardInstance, isFaceDown, faceUpIds);
    // Tilt + glare on hover, exactly like a board card (QA — uniform card
    // interaction across zones and dialogs).
    const inner = (
        <CardTilt3D>
            {faceDown ? (
                <CardBack />
            ) : (
                <CardImage
                    card={cardInstance}
                    sizes={imageSizing.sizes}
                    includeThumb={imageSizing.includeThumb}
                />
            )}
        </CardTilt3D>
    );
    const isEligible = isEligibleCard(cardInstance.id, eligibleIds);
    const clickable = !faceDown && !!onCardClick && isEligible;
    const isIneligible = !faceDown && !!onCardClick && !isEligible;
    const isSelected = selectedIds?.includes(cardInstance.id) ?? false;
    const action = renderCardAction?.(cardInstance, onClose);
    const caption = faceDown ? null : captionFor?.(cardInstance);
    return (
        <div className={`flex ${PILE_GRID_TILE_W} shrink-0 flex-col gap-1`}>
            <div className="relative w-full aspect-5/7">
                {clickable ? (
                    <button
                        type="button"
                        onClick={() => {
                            onCardClick(cardInstance);
                            onClose();
                        }}
                        className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer ${pickerRingClass(isSelected)}`}
                    >
                        {inner}
                    </button>
                ) : isIneligible ? (
                    <div className="w-full h-full card-corner opacity-40">
                        {inner}
                    </div>
                ) : (
                    // See the fan layout's own note — same seam, grid variant.
                    <ManualCardMenu card={cardInstance}>{inner}</ManualCardMenu>
                )}
                <PileCounterChips card={cardInstance} />
                {action}
            </div>
            {caption && (
                <span className="text-center text-[10px] leading-tight text-text-muted">
                    {caption}
                </span>
            )}
        </div>
    );
}

// PILE_GRID_TILE_W now lives in `~/lib/card-layout` (issue #1817 round 2) —
// shared with the 5 sibling cost/target-picker dialogs, not just this file's
// own two grid modes. See its doc comment there for the fit math.

/** Grid-layout row of tiles (issue #1817). The horizontal gap shrinks below
 *  `PILE_GRID_COMPACT_BREAKPOINT_PX` (4px vs 8px) alongside `PILE_GRID_TILE_W`
 *  so 4 columns fit at 360-390px phone widths (see the executable fit
 *  assertion in `__tests__/cards-pile.test.tsx`); at/above it keeps today's
 *  `gap-2`, unchanged from before issue #1817. Shared by the flat grid and
 *  every categorized section — same reuse rationale as `PILE_GRID_TILE_W`. */
const PILE_GRID_ROW_CLASS =
    "flex flex-wrap gap-1 min-[420px]:gap-2 justify-center";

/** Grid-layout horizontal padding (issue #1817). Zeroed below
 *  `PILE_GRID_COMPACT_BREAKPOINT_PX` — the dialog's own Panel chrome already
 *  provides generous clearance from the screen edge — and restored to
 *  today's `px-2` at/above it, unchanged from before issue #1817. Shared by
 *  the flat grid's outer wrapper and the categorized layout's outer wrapper
 *  (both play the same "outer padding" role; the categorized layout
 *  additionally nests one `PILE_GRID_ROW_CLASS` row per section). */
const PILE_GRID_H_PADDING = "px-0 min-[420px]:px-2";

/** A category header above a section of the categorized grid (issue #1364).
 *  Mirrors the picker's ZoneLabel chrome (uppercase, muted) so the reveal reads
 *  as one labelled group per card type / colour pair. */
function CategoryHeader({ label, count }: { label: string; count: number }) {
    return (
        <div className="w-full flex items-center gap-2 px-1 pt-1">
            <span className="text-[11px] font-bold tracking-wide uppercase text-text-muted">
                {label}
            </span>
            <span className="text-[10px] text-text-muted/70">×{count}</span>
            <span className="flex-1 border-t border-border-subtle" />
        </div>
    );
}

function GridLayout({
    cards,
    isFaceDown,
    faceUpIds,
    onCardClick,
    renderCardAction,
    onClose,
    selectedIds,
    eligibleIds,
    categories,
    captionFor,
    activeFilterType,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    faceUpIds?: ReadonlySet<string>;
    onCardClick?: (card: CardInstance) => void;
    renderCardAction?: (
        card: CardInstance,
        onClose: () => void
    ) => React.ReactNode;
    onClose: () => void;
    selectedIds?: string[];
    eligibleIds?: ReadonlySet<string>;
    /** Categorized reveal (issue #1364, Atraxa / Niv-Mizzet) — when present, the
     *  grid is split into one labelled section per category (in category order)
     *  plus a trailing "not keepable" section for cards matching none. Omit for
     *  an ordinary flat grid. */
    categories?: PileCategory[];
    captionFor?: (card: CardInstance) => string | null;
    /** Segmented type filter (issue #2729) — `CardsPile` owns the filter
     *  STATE and renders the `SegmentedControl` itself (sticky, syntactically
     *  inside its own `<GameDialog>` — `shell-height-claims.guard.test.tsx`'s
     *  sticky-site registry resolves ancestors from source text, so a sticky
     *  element rendered by a SEPARATE function component, even one only ever
     *  mounted inside GameDialog, does not read as "inside `<GameDialog>`").
     *  This component only filters `cards` by the resolved value;
     *  `PILE_FILTER_ALL` (or omitted) renders everything. */
    activeFilterType?: string;
}) {
    // One viewport read for the whole dialog (not per-card — see
    // `gridImageSizing`'s doc comment on the listener-count rationale).
    const viewportWidth = useViewportWidth();
    const imageSizing = gridImageSizing(viewportWidth);
    const cardProps = {
        isFaceDown,
        faceUpIds,
        onCardClick,
        renderCardAction,
        onClose,
        selectedIds,
        eligibleIds,
        captionFor,
        imageSizing,
    };

    if (!categories) {
        const visibleCards =
            activeFilterType && activeFilterType !== PILE_FILTER_ALL
                ? cards.filter((c) => pileFilterType(c) === activeFilterType)
                : cards;
        return (
            <div
                className={`${PILE_GRID_ROW_CLASS} py-4 ${PILE_GRID_H_PADDING}`}
            >
                {visibleCards.map((cardInstance) => (
                    <GridCard
                        key={cardInstance.id}
                        cardInstance={cardInstance}
                        {...cardProps}
                    />
                ))}
            </div>
        );
    }

    const { sections, ungrouped } = buildCategorySections(cards, categories);
    return (
        <div className={`flex flex-col gap-3 py-4 ${PILE_GRID_H_PADDING}`}>
            {sections.map((section) => (
                <div key={section.label} className="flex flex-col gap-1.5">
                    <CategoryHeader
                        label={section.label}
                        count={section.cards.length}
                    />
                    <div className={PILE_GRID_ROW_CLASS}>
                        {section.cards.map((cardInstance) => (
                            <GridCard
                                key={cardInstance.id}
                                cardInstance={cardInstance}
                                {...cardProps}
                            />
                        ))}
                    </div>
                </div>
            ))}
            {ungrouped.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    <CategoryHeader
                        label="Not keepable"
                        count={ungrouped.length}
                    />
                    <div className={PILE_GRID_ROW_CLASS}>
                        {ungrouped.map((cardInstance) => (
                            <GridCard
                                key={cardInstance.id}
                                cardInstance={cardInstance}
                                {...cardProps}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function CardsPile({
    cards,
    isFaceDown = false,
    faceUpIds,
    collapsedFaceUpIds,
    emptyLabel,
    zoneIcon,
    title,
    layout = "fan",
    onCardClick,
    renderCardAction,
    forceOpen = false,
    selectedIds,
    eligibleIds,
    footer,
    onMinimize,
    open,
    onOpenChange,
    topOnRight = false,
    categories,
    captionFor,
    hasContextMenu = false,
}: CardsPileProps) {
    // Controlled-open chip mode (#336): the owner drives `open` and supplies the
    // trigger, so this component renders only the dialog.
    const controlled = open !== undefined && onOpenChange !== undefined;
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = forceOpen || (controlled ? open : internalOpen);
    const setIsOpen = (next: boolean) => {
        if (forceOpen) return;
        if (controlled) {
            onOpenChange(next);
            return;
        }
        setInternalOpen(next);
    };

    const rotations = useMemo(
        () => cards.map((_, i) => seededRandom(i) * 4 - 2),
        [cards]
    );

    // Zone-change flight hooks — hoisted above every early return (rules of
    // hooks): the collapsed pile renders shared-layout elements keyed by
    // stable instance id, and the top card plays the arrival glow.
    const reduceMotion = useReducedMotion();
    const gameCtx = useContext(GameContext);
    const recentArrivals = gameCtx?.recentArrivals;

    // Segmented type filter (issue #2729, "segmented filter footer") — PLAIN
    // browse only: `onCardClick` set means this grid is a picker (a
    // graveyard/exile CHOICE), where hiding a legal-but-filtered-out target
    // behind a filter button would read as the target vanishing rather than
    // as a view option. A categorized reveal (Atraxa/Niv-Mizzet) already
    // groups by type via `categories`, so the two features never compose.
    // Fan layout keeps no filter (the prototype's segmented-filter stage is
    // the wide GRID browse only). Owned HERE, not by `GridLayout` — its
    // sticky footer must sit syntactically inside `<GameDialog>` below for
    // `shell-height-claims.guard.test.tsx`'s sticky-site registry to resolve
    // it as portaled rather than pinned against `<main>`. `> 2` (not `> 1`)
    // excludes the degenerate "All / Other" pair a mono-type pile would
    // otherwise grow — a single real bucket makes every filter button show
    // the identical set of cards.
    //
    // `!footer` (round-2 review fixup, issue #2729): a caller can supply a
    // `footer` on a plain grid browse with no `onCardClick` —
    // `RevealHandView`'s undismissable "Done" acknowledgement of a
    // `forceOpen` reveal-hand prompt is exactly that shape. Both the filter
    // row and `footer` below render `sticky bottom-0` as direct siblings of
    // the same `GameDialog` scroller, so without this gate they stack on the
    // same edge and the filter (`z-10`) paints over the footer — the ONLY
    // way to dismiss a prompt the user cannot otherwise escape. The other
    // callers with a footer (`player-graveyard`/`player-exile`/
    // `player-library`) escape only incidentally, by always pairing `footer`
    // with `onCardClick` (already excluded above) for the same `is*Choice`
    // flag. The correct fix is not z-index or "sticky-er" — a caller with a
    // footer never gets a filter, full stop.
    const filterOptions = useMemo(
        () =>
            layout === "grid" && !onCardClick && !categories && !footer
                ? pileFilterOptions(cards)
                : [],
        [cards, layout, onCardClick, categories, footer]
    );
    const showFilter = filterOptions.length > 2;
    const [filterType, setFilterType] = useState<string>(PILE_FILTER_ALL);
    const activeFilterType = filterOptions.some((o) => o.value === filterType)
        ? filterType
        : PILE_FILTER_ALL;

    // Fully uncontrolled (no `open`/`onOpenChange`, no menu): there is no
    // dialog anything could drive open, so an empty pile stops here — the
    // ordinary placeholder, no dialog mounted at all.
    //
    // `controlled && hasContextMenu` is NOT included here (PR #2356 follow-up
    // — a review of #2345 found the previous, broader `!controlled ||
    // hasContextMenu` condition early-returned this case too, skipping the
    // `<GameDialog>` at the bottom of this component entirely: the pile
    // menu's "Browse pile…" item lifts `open`/`onOpenChange` state
    // (`usePileBrowseMenu`) that then had nothing to mount against, so
    // clicking it did nothing on an empty library — see
    // `pile-empty-browse.test.tsx`). That case instead falls through below,
    // where the collapsed-stack slot renders the SAME placeholder but the
    // dialog still mounts, so the menu item stays functional.
    const isEmpty = cards.length === 0;
    if (isEmpty && !controlled) {
        return (
            <EmptyPilePlaceholder zoneIcon={zoneIcon} emptyLabel={emptyLabel} />
        );
    }

    // The collapsed stack reveals only `collapsedFaceUpIds` (falls back to the
    // shared `faceUpIds`). The library passes a top-only set so the board zone
    // shows a single top-card peek; the dialog below keeps the full `faceUpIds`.
    const stackFaceUpIds = collapsedFaceUpIds ?? faceUpIds;

    // Zone-change flights (validated in the zone-motion prototype): the pile
    // participates in the board's shared-layout identity — each rendered card
    // carries a `layoutId` keyed by its STABLE instance id (was: array-index
    // keys, which broke identity on every push), so a card arriving here flies
    // in from its previous zone instead of popping in. Only the top few cards
    // render: deeper cards are visually identical (backs / hidden behind the
    // fan), only the top is ever a flight endpoint, and a deep pile used to
    // mount one CardImage (+CardPreview) per card.
    const COLLAPSED_DEPTH = 3;
    const firstVisible = topOnRight
        ? 0
        : Math.max(0, cards.length - COLLAPSED_DEPTH);
    const visibleCards = topOnRight
        ? cards.slice(0, COLLAPSED_DEPTH)
        : cards.slice(firstVisible);
    const topIndex = topOnRight ? 0 : cards.length - 1;

    const pileCards = visibleCards.map((cardInstance: CardInstance, i) => {
        const cardIndex = firstVisible + i;
        // Library (topOnRight): in the small collapsed board slot a full-library
        // horizontal fan would overflow, so here we only lift the known top card
        // in the stacking order — the topmost (index 0) sits highest and face-up,
        // so a scried / peeked top card is the one you see on the board. The full
        // top-on-the-right fan happens in the expanded dialog below. Every other
        // zone keeps the plain rotated stack (later card on top).
        const faceUpHere = !isCardFaceDown(
            cardInstance,
            isFaceDown,
            stackFaceUpIds
        );
        const cardStyle: React.CSSProperties = topOnRight
            ? {
                  transform: `rotate(${rotations[cardIndex]}deg)`,
                  zIndex: faceUpHere ? cards.length - cardIndex : 0,
              }
            : { transform: `rotate(${rotations[cardIndex]}deg)` };

        // The collapsed stack is an OPEN-ONLY affordance: clicking it expands the
        // reveal dialog (the wrapping `onClick={setIsOpen(true)}` below). It must
        // stay non-interactive per card — a `SelectableCard` bound to the card's
        // `legalActions` turns a playable pile card (e.g. a Headliner Scarlett
        // impulse-exiled card whose exile projection carries `["play"|"cast"]`,
        // gameProjections) into a `<div onClick={play}>`, so the single pile click
        // both PLAYS the card and opens the dialog. Per-card actions belong in the
        // dialog only, surfaced via `renderCardAction` (Exile → ExileCastButton).
        const image = (
            <CardTilt3D>
                {isCardFaceDown(cardInstance, isFaceDown, stackFaceUpIds) ? (
                    <CardBack />
                ) : (
                    // Collapsed pile slot is --card-w-sm (≤96px) — a small
                    // slot: keep `thumb`, hint at the upper bound.
                    <CardImage card={cardInstance} sizes="96px" />
                )}
            </CardTilt3D>
        );

        return (
            <motion.div
                key={cardInstance.id}
                layout
                layoutId={cardInstance.id}
                data-flight-id={cardInstance.id}
                transition={reduceMotion ? { duration: 0 } : SLOT_SPRING.motion}
                className={`absolute ${PILE_TILE_BOX}`}
                style={cardStyle}
            >
                {image}
                <ArrivalGlow
                    show={
                        cardIndex === topIndex &&
                        recentArrivals?.has(cardInstance.id) === true
                    }
                />
            </motion.div>
        );
    });

    const dialogTitle = `${title || "Cards"} (${cards.length})`;

    return (
        <>
            {/* Controlled (chip) mode suppresses the collapsed card stack — the
                owner renders the trigger and only the dialog mounts here.
                `forceOpen` (a blocking picker modal) likewise hides it: the
                collapsed trigger sits behind an undismissable dialog and is
                unreachable, and rendering it would duplicate every card image. */}
            {!forceOpen && (!controlled || hasContextMenu) && (
                <div
                    // `relative ${PILE_TILE_BOX}` (round-2 review fixup,
                    // issue #2727): the count badge below is positioned
                    // against THIS element, so it has to be both positioned
                    // AND the size of a tile. Every in-flow child here is
                    // `absolute`, so without a box of its own this wrapper —
                    // and the caller's `relative` wrapper above it — measure
                    // ZERO height, and `-bottom-1.5` then resolves against a
                    // zero-height line at the TOP of the tile: measured in
                    // headless Chrome, the badge landed at y=106..126 against
                    // a tile occupying y=120..200, i.e. 14 of its 20px above
                    // the thumb (at the board's top edge on the opponent
                    // rail). Layout-neutral: the grandparent
                    // (`player-graveyard.tsx` et al.) is already exactly
                    // `w-(--card-w-sm) aspect-5/7`, so filling it changes no
                    // band and no rail geometry — it only gives the absolute
                    // children the containing block they always meant to
                    // resolve against. Guarded by `cards-pile.test.tsx` §
                    // "the count badge's containing block is a full tile box".
                    className={`cursor-pointer relative ${PILE_TILE_BOX}`}
                    // `hasContextMenu` — no handler at all, so the click
                    // bubbles untouched to the ancestor's `ContextMenuTrigger`
                    // (see the prop doc). Opening the browse dialog is then
                    // the menu's own "Browse pile…" item, via the caller-
                    // supplied `onOpenChange`.
                    onClick={hasContextMenu ? undefined : () => setIsOpen(true)}
                >
                    {isEmpty ? (
                        <EmptyPilePlaceholder
                            zoneIcon={zoneIcon}
                            emptyLabel={emptyLabel}
                        />
                    ) : (
                        <>
                            {pileCards}
                            {/* Count badge (ADR 0103, issue #2727): "piles as
                                card thumbs with a count badge" — the depth of
                                a zone used to be legible only by opening it
                                (or, on portrait, from the separate chip row).
                                The ivory pill is the one opaque element on the
                                tile, per §3, and `pointer-events-none` keeps
                                the whole tile a single click target for the
                                browse dialog. Anchored against the wrapper
                                right above — a `relative` element sized to a
                                full `PILE_TILE_BOX`, the same positioned
                                ancestor the absolutely-placed pile cards
                                resolve against — so the pill sits on the
                                tile's bottom-right corner and costs the tile
                                no layout of its own. */}
                            <span
                                data-pile-count
                                aria-hidden
                                className={`pointer-events-none absolute -right-1.5 -bottom-1.5 z-10 shadow-[0_2px_6px_rgba(0,0,0,0.6)] ${V4_COUNT_BADGE}`}
                            >
                                {cards.length}
                            </span>
                        </>
                    )}
                </div>
            )}

            <GameDialog
                open={isOpen}
                onOpenChange={setIsOpen}
                title={dialogTitle}
                size="wide"
                dismissable={!forceOpen}
                showCloseButton={!forceOpen}
                onMinimize={forceOpen ? onMinimize : undefined}
                // Mobile-only Panel padding reduction (issue #1817 round 2) —
                // gives the grid's 4-per-row math the room it needs on a
                // phone; unchanged (p-6 at every width) at/above
                // PILE_GRID_COMPACT_BREAKPOINT_PX, and unchanged for every
                // OTHER `size="wide"` GameDialog (this prop defaults to
                // "default" elsewhere).
                density="comfortable"
            >
                {layout === "fan" ? (
                    <FanLayout
                        cards={cards}
                        isFaceDown={isFaceDown}
                        faceUpIds={faceUpIds}
                        onCardClick={onCardClick}
                        renderCardAction={renderCardAction}
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
                        eligibleIds={eligibleIds}
                        captionFor={captionFor}
                        topOnRight={topOnRight}
                    />
                ) : (
                    <GridLayout
                        cards={cards}
                        isFaceDown={isFaceDown}
                        faceUpIds={faceUpIds}
                        onCardClick={onCardClick}
                        renderCardAction={renderCardAction}
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
                        eligibleIds={eligibleIds}
                        categories={categories}
                        captionFor={captionFor}
                        activeFilterType={activeFilterType}
                    />
                )}
                {showFilter && (
                    <div className="sticky bottom-0 z-10 flex justify-center border-t border-border-subtle bg-surface pt-2 pb-1">
                        <SegmentedControl
                            options={filterOptions}
                            value={activeFilterType}
                            onChange={setFilterType}
                            ariaLabel="Filter pile by card type"
                        />
                    </div>
                )}
                {footer && (
                    <div className="sticky bottom-0 mt-2 flex justify-center border-t border-border-subtle bg-surface pt-3 pb-1">
                        {footer}
                    </div>
                )}
            </GameDialog>
        </>
    );
}
