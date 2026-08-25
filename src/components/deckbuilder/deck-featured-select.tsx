import { useMemo } from "react";
import type { ZoneCard } from "~/types/game";

export interface DeckFeaturedSelectProps {
    /** The Maindeck — the pool a Featured Card is chosen from (PRD #589
     *  resolves the override against this list, so a card that is not in it
     *  cannot be featured). Duplicates collapse to one entry. */
    cards: readonly ZoneCard[];
    /** The explicit override stored on the working deck, if any. `undefined`
     *  selects `Auto`. */
    explicitCardId?: string;
    /** Pick a card, or `null` for `Auto` (drop the override). */
    onSet: (cardId: string | null) => void;
}

/**
 * The deck's Featured Card picker (PRD #589, issue #599), re-homed to the
 * DECK-DETAIL row by issue #2584.
 *
 * It used to be `featured-card-button.tsx`, an overlay button on the card
 * tile, and this slice's acceptance criteria delete every per-card overlay
 * button ("per-card overlay buttons are gone at every viewport"). The issue
 * names the replacement home — "Featured moves to the Inspect Overlay / deck
 * detail" — and BOTH halves ship: a finger reaches it through tap -> Peek
 * Panel -> `★ Featured`, and a mouse reaches it here, in `SaveDeckBar`'s row
 * beside the deck's name and card count.
 *
 * A deck-level home rather than a per-card gesture is not a consolation
 * prize; it is the only one left on this surface. The primary click on a tile
 * MOVES the card, a press-and-drag moves it too, and the SECONDARY button is
 * already `CardPreview`'s anchored pin (`deck-card-tile.tsx` records the whole
 * argument, PR #2641 review rounds 1-3). Featured is also a property of the
 * DECK, not of a tile: exactly one card carries it, and picking it from a list
 * of the deck's own cards says that where an affordance repeated on every tile
 * did not.
 *
 * Nothing renders on an empty Maindeck — there is no card to feature yet.
 */
export default function DeckFeaturedSelect({
    cards,
    explicitCardId,
    onSet,
}: DeckFeaturedSelectProps) {
    // One entry per distinct card, in deck order — the same order the Maindeck
    // itself is stored in, so the first entry is the card `Auto` resolves to.
    const options = useMemo(() => {
        const seen = new Set<string>();
        const out: { cardId: string; cardName: string }[] = [];
        for (const card of cards) {
            if (seen.has(card.cardId)) continue;
            seen.add(card.cardId);
            out.push({ cardId: card.cardId, cardName: card.cardName });
        }
        return out;
    }, [cards]);

    if (options.length === 0) return null;

    return (
        <label className="flex items-center gap-2 text-sm">
            <span className="text-label tracking-wide text-text-muted">★</span>
            {/* min-h-[var(--control-h)] (ADR 0101 §2, issue #2670): the native
                select measured 135x30px, under the 44px coarse-pointer rung
                (32px on a mouse — see `--control-h`'s pointer-aware
                resolution). `SaveDeckBar`'s row has slack for the extra
                height on every viewport this control renders on (it never
                mounts in portrait, `!portrait` gate above), EXCEPT
                `short-viewport:` (the phone-landscape band, `max-height:
                500px`): forcing 44px there re-opened a `ctrlsOcc` regression
                against that row's already-tuned compact padding
                (`short-viewport:py-0.5`), so the rung is dropped back to 0
                there and the existing compact treatment governs — same
                short-viewport carve-out `DeckBuilderHeader` and `SaveDeckBar`
                itself already use for their own controls. */}
            <select
                value={explicitCardId ?? ""}
                onChange={(e) =>
                    onSet(e.target.value === "" ? null : e.target.value)
                }
                className="input-field max-w-36 min-h-[var(--control-h)] px-2 py-1 short-viewport:min-h-0 short-viewport:py-0.5 short-viewport:text-xs"
                aria-label="Featured card"
                title="The card that supplies this deck's art"
            >
                <option value="">Featured: Auto</option>
                {options.map((option) => (
                    <option key={option.cardId} value={option.cardId}>
                        {option.cardName}
                    </option>
                ))}
            </select>
        </label>
    );
}
