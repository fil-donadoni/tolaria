import { useMemo, useState } from "react";
import type { CardInstance } from "~/types/game";
import { useInertialScroll } from "~/hooks/useInertialScroll";
import GameDialog from "~/components/ui/game-dialog";
import CardBack from "../cards/card-back";
import SelectableCard from "../cards/selectable-card";
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
    emptyLabel?: string;
    /** Zone glyph shown (centered) in place of the text label when the pile is
     *  empty — e.g. a `Skull` for the graveyard, `Sparkles` for exile. Falls
     *  back to `emptyLabel` text when absent. `emptyLabel` is kept as the
     *  accessible label. */
    zoneIcon?: React.ReactNode;
    title?: string;
    layout?: "fan" | "grid";
    onCardClick?: (card: CardInstance) => void;
    forceOpen?: boolean;
    /** Instance ids currently selected by the chooser. Selected cards get a
     *  distinct ring so multi-pick selections (e.g. a `search-library`
     *  choice) show per-card feedback instead of all-amber. */
    selectedIds?: string[];
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

/** Ring class for a selectable card: emerald once picked, amber otherwise. */
function selectionRing(isSelected: boolean): string {
    return isSelected
        ? "ring-2 ring-emerald-400 hover:ring-emerald-300"
        : "ring-2 ring-amber-400 hover:ring-amber-300";
}

function FanLayout({
    cards,
    isFaceDown,
    faceUpIds,
    onCardClick,
    onClose,
    selectedIds,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    faceUpIds?: ReadonlySet<string>;
    onCardClick?: (card: CardInstance) => void;
    onClose: () => void;
    selectedIds?: string[];
}) {
    // A full library fans to many overlapping cards that overflow the dialog
    // width. Inertial drag-to-pan (Arena-like) makes browsing the reveal feel
    // physical; native wheel + keyboard scroll stay intact (#255).
    const scrollRef = useInertialScroll<HTMLDivElement>("x");
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
                    width: `calc(var(--pile-card-w) * ${(cards.length + 1) / 2})`,
                    minWidth: "min-content",
                }}
            >
                {cards.map((cardInstance, cardIndex) => {
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
                    const clickable = !faceDown && !!onCardClick;
                    const isSelected =
                        selectedIds?.includes(cardInstance.id) ?? false;
                    return (
                        <div
                            key={cardInstance.id}
                            className="w-(--pile-card-w) aspect-5/7 shrink-0"
                            style={{
                                marginLeft:
                                    cardIndex === 0
                                        ? "0"
                                        : "calc(var(--pile-card-w) * -0.5)",
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
                            ) : (
                                inner
                            )}
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
    onClose,
    selectedIds,
}: {
    cards: CardInstance[];
    isFaceDown: boolean;
    faceUpIds?: ReadonlySet<string>;
    onCardClick?: (card: CardInstance) => void;
    onClose: () => void;
    selectedIds?: string[];
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
                const clickable = !faceDown && !!onCardClick;
                const isSelected =
                    selectedIds?.includes(cardInstance.id) ?? false;
                return (
                    <div
                        key={cardInstance.id}
                        className="w-24 sm:w-28 aspect-5/7 shrink-0"
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
                        ) : (
                            inner
                        )}
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
    emptyLabel,
    zoneIcon,
    title,
    layout = "fan",
    onCardClick,
    forceOpen = false,
    selectedIds,
    footer,
    onMinimize,
    open,
    onOpenChange,
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

    const pileCards = cards.map((cardInstance: CardInstance, cardIndex) => {
        const cardStyle = {
            transform: `rotate(${rotations[cardIndex]}deg)`,
        };

        const image = isCardFaceDown(cardInstance, isFaceDown, faceUpIds) ? (
            <CardBack />
        ) : (
            <SelectableCard
                cardInstance={cardInstance}
                allowedActions={cardInstance.legalActions ?? []}
            />
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
                owner renders the trigger and only the dialog mounts here. */}
            {!controlled && (
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
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
                    />
                ) : (
                    <GridLayout
                        cards={cards}
                        isFaceDown={isFaceDown}
                        faceUpIds={faceUpIds}
                        onCardClick={onCardClick}
                        onClose={() => setIsOpen(false)}
                        selectedIds={selectedIds}
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
