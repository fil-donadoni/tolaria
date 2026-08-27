import { useMemo } from "react";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import type { DeckCard } from "~/types/game";
import { getArtCropImageUrl, resolveCardImageId } from "~/lib/images";

type SideboardSwapListProps = {
    /** Section heading, e.g. "Maindeck" / "Sideboard". */
    title: string;
    cards: DeckCard[];
    /** Per-row move-one action label ("→ Side" / "→ Main"). */
    moveLabel: string;
    /** Move `all` copies when true, one copy when false/absent. */
    onMove: (cardId: string, all?: boolean) => void;
    /** Hover drives the preview panel (null on leave). */
    onHoverCard?: (cardId: string | null) => void;
    /** Optional count suffix shown after the count (e.g. " / 60+"). */
    countSuffix?: string;
    disabled?: boolean;
    emptyMessage: string;
};

type Row = { cardId: string; cardName: string; count: number };

/** Collapses a flat card list into one row per distinct card with a quantity,
 *  preserving first-seen order. Sideboarding moves a single copy at a time. */
function groupRows(cards: DeckCard[]): Row[] {
    const order: string[] = [];
    const byId = new Map<string, Row>();
    for (const c of cards) {
        const existing = byId.get(c.cardId);
        if (existing) existing.count += 1;
        else {
            order.push(c.cardId);
            byId.set(c.cardId, {
                cardId: c.cardId,
                cardName: c.cardName,
                count: 1,
            });
        }
    }
    return order.map((id) => byId.get(id)!);
}

/** One pile of the between-Games Sideboarding editor (issue #395; phase-2
 *  revamp: art thumbs, move-one AND move-all CTAs, hover→preview). Purely
 *  presentational — swap state lives in the parent. */
export default function SideboardSwapList({
    title,
    cards,
    moveLabel,
    onMove,
    onHoverCard,
    countSuffix,
    disabled,
    emptyMessage,
}: SideboardSwapListProps) {
    const rows = useMemo(() => groupRows(cards), [cards]);
    const toMain = moveLabel.includes("Main");

    return (
        <section className="flex flex-col min-w-0 flex-1">
            {/* v4 (ADR 0103 §4, issue #2729): Beleren retired from chrome —
                section label, not a card face. */}
            <div className="px-1 pb-1 text-sm tracking-wide text-parchment">
                {title} {cards.length}
                {countSuffix ?? ""}
            </div>
            {rows.length === 0 ? (
                <div className="px-1 py-2 text-xs text-text-muted">
                    {emptyMessage}
                </div>
            ) : (
                // `min-h-0 flex-1` (not a max-height): the parent row owns the
                // height, so the list scrolls inside a box that never changes
                // size as the neighbouring preview grows.
                <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
                    {rows.map((row) => {
                        const imageId = resolveCardImageId(row.cardId);
                        return (
                            <li
                                key={row.cardId}
                                className="flex items-center gap-2 rounded-sm bg-surface-elevated px-2 py-1 text-xs text-text"
                                onMouseEnter={() => onHoverCard?.(row.cardId)}
                                onMouseLeave={() => onHoverCard?.(null)}
                            >
                                {imageId ? (
                                    <img
                                        src={getArtCropImageUrl(imageId)}
                                        alt=""
                                        className="h-8 w-6 shrink-0 rounded-sm object-cover"
                                    />
                                ) : null}
                                <span className="min-w-0 flex-1 truncate">
                                    {row.count > 1 ? `${row.count}× ` : ""}
                                    {row.cardName}
                                </span>
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onMove(row.cardId)}
                                    className="shrink-0 rounded-sm border border-accent/40 px-1.5 py-0.5 text-accent-strong hover:bg-accent-soft transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {moveLabel}
                                </button>
                                <button
                                    type="button"
                                    disabled={disabled || row.count < 2}
                                    onClick={() => onMove(row.cardId, true)}
                                    title={`Move all ${row.count} copies`}
                                    aria-label={`Move all ${row.count} copies of ${row.cardName}`}
                                    className="shrink-0 rounded-sm border border-accent/40 px-1.5 py-0.5 text-accent-strong hover:bg-accent-soft transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                    {toMain ? (
                                        <ChevronsLeft className="h-3 w-3" />
                                    ) : (
                                        <ChevronsRight className="h-3 w-3" />
                                    )}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
