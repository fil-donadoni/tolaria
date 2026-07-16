import { useState } from "react";
import type { CardInstance } from "~/types/game";
import CardsPile from "./cards-pile";

/** Corner peek-stack for the satellites attached to a battlefield permanent —
 *  auras stacked on a creature (CR 303.4) or cards held in exile by a permanent
 *  (Parallax Wave / Banishing Light, `exiledByPermanentId`). Replaces the old
 *  render-every-satellite-at-the-same-spot treatments (which showed only the
 *  topmost) with a compact stack: the front satellite sits in the host's
 *  top-left corner overhang and each further one peeks a thin sliver from behind
 *  it, a one-glance "there are N here" cue. Clicking the ×N badge (or, for
 *  passive satellites, the stack itself) opens the full pile in a
 *  graveyard-style {@link CardsPile} dialog.
 *
 *  The stack paints BEHIND the host: the caller renders the host art at `z-10`
 *  above this component, so only the corner overhang shows and the host is never
 *  obscured. */

// Thin sliver revealed per extra card; a handful is enough to read "several".
const STEP_PCT = 3;
const MAX_PEEK = 5;
// Corner overhang of the front satellite, and satellite size, as a % of the
// host box — matches the aura/exile pinning the board used before.
const BASE_OUT_PCT = 22;
const SIZE_PCT = 58;

type AttachedCardsClusterProps = {
    cards: CardInstance[];
    /** Render one satellite to fill a `w-full h-full` box. Auras pass the board's
     *  interactive `renderCard` (so the front card stays clickable/targetable);
     *  exile-held cards pass a plain art renderer. */
    renderMember: (card: CardInstance) => React.ReactNode;
    /** Whether a satellite handles its own clicks (auras: yes — keep board
     *  targeting/tap). When false (exile-held art), clicking a sliver opens the
     *  pile dialog instead. */
    interactiveMembers: boolean;
    pileTitle: string;
    /** Per-card action rendered on each card in the pile dialog — cast-from-exile
     *  (Ice Cauldron / Dauthi). */
    renderPileAction?: (
        card: CardInstance,
        onClose: () => void
    ) => React.ReactNode;
    /** Dialog card click — auras route it to the board's `handleClick` so a
     *  specific aura among many can still be targeted (Disenchant) from the
     *  clear reveal. */
    onPileCardClick?: (card: CardInstance) => void;
};

export default function AttachedCardsCluster({
    cards,
    renderMember,
    interactiveMembers,
    pileTitle,
    renderPileAction,
    onPileCardClick,
}: AttachedCardsClusterProps) {
    const [open, setOpen] = useState(false);
    const n = cards.length;
    if (n === 0) return null;

    // Only a few slivers are worth showing; the badge carries the true count.
    const shown = cards.slice(0, MAX_PEEK);

    return (
        <>
            {/* Peek-stack layer — sits behind the host (host art is z-10). */}
            <div className="absolute inset-0 z-0">
                {/* Paint back-to-front so the first card ends up on top. */}
                {[...shown].reverse().map((card, ri) => {
                    const i = shown.length - 1 - ri; // 0 = front
                    const out = BASE_OUT_PCT + i * STEP_PCT;
                    const box = (
                        <div
                            className="w-full h-full rounded-sm overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.6)]"
                            style={{ pointerEvents: "auto" }}
                        >
                            {renderMember(card)}
                        </div>
                    );
                    return (
                        <div
                            key={card.id}
                            className="absolute"
                            style={{
                                top: `-${out}%`,
                                left: `-${out}%`,
                                width: `${SIZE_PCT}%`,
                                height: `${SIZE_PCT}%`,
                                zIndex: 9 - i,
                            }}
                        >
                            {interactiveMembers ? (
                                box
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setOpen(true)}
                                    className="w-full h-full bg-transparent border-0 p-0 cursor-pointer"
                                    aria-label={`${n} attached — open pile`}
                                >
                                    {box}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* ×N badge — in front of the host so the count always reads. */}
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(true);
                }}
                className="absolute -top-2 -left-2 z-20 rounded-full bg-black/85 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white ring-1 ring-white/30 drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] cursor-pointer"
                aria-label={`${n} attached — open pile`}
            >
                ×{n}
            </button>

            <CardsPile
                cards={cards}
                title={pileTitle}
                layout="grid"
                open={open}
                onOpenChange={setOpen}
                onCardClick={onPileCardClick}
                renderCardAction={renderPileAction}
            />
        </>
    );
}
