import { useEffect, useMemo, useState } from "react";
import { Dices } from "lucide-react";
import { Button } from "~/components/ui/button";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import {
    contextCapForPick,
    DEFAULT_DRAFT_PICKS,
} from "@convex/limited/botDrafter";
import PickRatingsPackCard from "./pick-ratings-pack-card";
import {
    justAbove,
    samplePackIds,
    sortPack,
    withinContextCap,
} from "./pick-ratings-ladder-model";
import { effectiveRating } from "./pick-ratings-model";

interface PickRatingsPackProps {
    card: ScopeCardRating;
    all: readonly ScopeCardRating[];
    disabled: boolean;
    onRate: (rating: number) => void;
}

/** The pack test: a rating exists to order a pack, so judge it there. A
 *  15-card pack of the scope sorted by rating with the open card in it; the
 *  pick slider shows the scorer's context cap live. A card within the cap
 *  can go either way, one outside it is decided by the rating alone. */
export default function PickRatingsPack({
    card,
    all,
    disabled,
    onRate,
}: PickRatingsPackProps) {
    const [roll, setRoll] = useState(0);
    const [pick, setPick] = useState(1);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest("input, textarea"))
                return;
            if (event.key === "r") setRoll((n) => n + 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // The pack's membership must not move when a rating moves: it is drawn
    // from the scope's size, then read back live by id.
    const packIds = useMemo(
        () => samplePackIds(all, card.cardId, roll),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [card.cardId, roll, all.length]
    );
    const pack = useMemo(() => {
        const byId = new Map(all.map((c) => [c.cardId, c]));
        return sortPack(
            packIds.flatMap((id) => byId.get(id) ?? []),
            card.cardId
        );
    }, [packIds, all, card.cardId]);

    const cap = contextCapForPick(pick, DEFAULT_DRAFT_PICKS);
    const rating = effectiveRating(card);
    const above = pack.filter((c) => effectiveRating(c) > rating).length;
    const tied = pack.filter(
        (c) => c.cardId !== card.cardId && effectiveRating(c) === rating
    ).length;

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-text-muted">
                <span>
                    In this pack{" "}
                    <span className="font-mono text-text">#{above + 1}</span> of{" "}
                    {pack.length}
                    {tied > 0 && ` (tied with ${tied})`}
                </span>
                <label className="flex items-center gap-2">
                    Pick
                    <input
                        type="range"
                        min={1}
                        max={DEFAULT_DRAFT_PICKS}
                        value={pick}
                        aria-label="Pick number"
                        onChange={(event) =>
                            setPick(Number(event.currentTarget.value))
                        }
                        className="w-32"
                    />
                    <span className="font-mono text-text">{pick}</span>
                    <span>
                        · context up to{" "}
                        <span
                            className="font-mono text-text"
                            data-pick-rating-cap
                        >
                            {cap.toFixed(1)}
                        </span>
                    </span>
                </label>
                <Button
                    variant="secondary"
                    size="xs"
                    className="ml-auto"
                    onClick={() => setRoll((n) => n + 1)}
                >
                    <Dices className="size-3.5" /> New pack (r)
                </Button>
            </div>
            <div className="grid grid-cols-8 gap-1.5">
                {pack.map((other, i) => (
                    <PickRatingsPackCard
                        key={other.cardId}
                        card={other}
                        openName={card.name}
                        position={i + 1}
                        self={other.cardId === card.cardId}
                        flippable={withinContextCap(card, other, cap)}
                        disabled={disabled}
                        onRateAbove={() => onRate(justAbove(other))}
                    />
                ))}
            </div>
            <p className="text-xs text-text-muted">
                Sorted by rating. Bright = within the context cap of this card
                at this pick, could go either way; dimmed = the rating alone
                decides. Click a card to rate this one half a point above it.
            </p>
        </div>
    );
}
