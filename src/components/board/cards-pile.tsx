import { useEffect, useMemo, useState } from "react";
import type { CardInstance } from "~/types/game";
import { useInertialScroll } from "~/hooks/useInertialScroll";
import GameDialog from "~/components/ui/game-dialog";
import CardBack from "../cards/card-back";
import CardImage from "../cards/card-image";

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

/** Ring class for a selectable card: emerald once picked, amber otherwise. */
function selectionRing(isSelected: boolean): string {
    return isSelected
        ? "ring-2 ring-emerald-400 hover:ring-emerald-300"
        : "ring-2 ring-amber-400 hover:ring-amber-300";
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
                    const inner = faceDown ? (
                        <CardBack />
                    ) : (
                        <CardImage card={cardInstance} />
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
                                    className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer rounded ${selectionRing(isSelected)}`}
                                >
                                    {inner}
                                </button>
                            ) : isIneligible ? (
                                <div className="w-full h-full rounded opacity-40">
                                    {inner}
                                </div>
                            ) : (
                                inner
                            )}
                            {action}
                        </div>
                    );
                })}
            </div>
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
}) {
    return (
        <div className="flex flex-wrap gap-2 justify-center py-4 px-2">
            {cards.map((cardInstance) => {
                const faceDown = isCardFaceDown(
                    cardInstance,
                    isFaceDown,
                    faceUpIds
                );
                const inner = faceDown ? (
                    <CardBack />
                ) : (
                    <CardImage card={cardInstance} />
                );
                const isEligible = isEligibleCard(cardInstance.id, eligibleIds);
                const clickable = !faceDown && !!onCardClick && isEligible;
                const isIneligible = !faceDown && !!onCardClick && !isEligible;
                const isSelected =
                    selectedIds?.includes(cardInstance.id) ?? false;
                const action = renderCardAction?.(cardInstance, onClose);
                return (
                    <div
                        key={cardInstance.id}
                        className="relative w-24 sm:w-28 aspect-5/7 shrink-0"
                    >
                        {clickable ? (
                            <button
                                type="button"
                                onClick={() => {
                                    onCardClick(cardInstance);
                                    onClose();
                                }}
                                className={`w-full h-full bg-transparent border-0 p-0 cursor-pointer rounded ${selectionRing(isSelected)}`}
                            >
                                {inner}
                            </button>
                        ) : isIneligible ? (
                            <div className="w-full h-full rounded opacity-40">
                                {inner}
                            </div>
                        ) : (
                            inner
                        )}
                        {action}
                    </div>
                );
            })}
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

    // In controlled (chip) mode the owner renders the trigger; this component
    // contributes only the reveal dialog. An empty pile still needs a mounted
    // dialog so the chip can open it (e.g. an empty exile), so fall through.
    if (!cards.length && !controlled) {
        return (
            <div className="group w-(--card-w-sm) aspect-5/7 mb-2 flex justify-center items-center text-center p-2 border border-border-subtle rounded-sm">
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

    // The collapsed stack reveals only `collapsedFaceUpIds` (falls back to the
    // shared `faceUpIds`). The library passes a top-only set so the board zone
    // shows a single top-card peek; the dialog below keeps the full `faceUpIds`.
    const stackFaceUpIds = collapsedFaceUpIds ?? faceUpIds;

    const pileCards = cards.map((cardInstance: CardInstance, cardIndex) => {
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
        const image = isCardFaceDown(
            cardInstance,
            isFaceDown,
            stackFaceUpIds
        ) ? (
            <CardBack />
        ) : (
            <CardImage card={cardInstance} />
        );

        return (
            <div
                key={cardIndex}
                className="absolute w-(--card-w-sm) aspect-5/7 mb-2"
                style={cardStyle}
            >
                {image}
            </div>
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
            {!controlled && !forceOpen && (
                <div className="cursor-pointer" onClick={() => setIsOpen(true)}>
                    {pileCards}
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
                    />
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
