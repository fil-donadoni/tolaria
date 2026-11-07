// PROTOTYPE — throwaway. Dialog "ladder": the rating IS a position on the
// scale. Eleven rungs top to bottom, each with the comparable cards already
// sitting on it; clicking a rung puts the card there. Answers "is this card a
// 3.5 next to those 3.5s?" by eye, without reading any number but the rung's.
import { useMemo, useState } from "react";
import {
    RatingDialogShell,
    Thumb,
    type RatingDialogProps,
} from "./ratings-dialog-shared";
import { RATING_STEPS, toStep } from "./ratings-dialog-utils";
import type { ProtoRatingCard } from "./proto-data";

type Compare = "colour" | "cost" | "type" | "scope";

const COMPARE: { key: Compare; label: string }[] = [
    { key: "colour", label: "Same colour" },
    { key: "cost", label: "Same cost ±1" },
    { key: "type", label: "Same type" },
    { key: "scope", label: "Whole scope" },
];

const MAX_THUMBS = 30;

function comparable(a: ProtoRatingCard, b: ProtoRatingCard, by: Compare) {
    if (by === "colour")
        return a.colors.length === 0
            ? b.colors.length === 0
            : a.colors.some((c) => b.colors.includes(c));
    if (by === "cost") return Math.abs(a.manaValue - b.manaValue) <= 1;
    if (by === "type") return a.types.some((t) => b.types.includes(t));
    return true;
}

export default function RatingsDialogLadder(props: RatingDialogProps) {
    return (
        <RatingDialogShell props={props}>
            <LadderBody {...props} />
        </RatingDialogShell>
    );
}

export function LadderBody({ card, all, api, onJump }: RatingDialogProps) {
    const [compare, setCompare] = useState<Compare>("colour");
    // Left click on a neighbour: open it here to reposition it. Stops the
    // event, or the rung underneath would rate the open card.
    const openNeighbour = (cardId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onJump(cardId);
    };
    const onSelf = (_cardId: string, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const rungs = useMemo(() => {
        const by = new Map<number, ProtoRatingCard[]>();
        if (!card) return by;
        for (const c of all) {
            if (c.cardId === card.cardId || c.rating === null) continue;
            if (!comparable(card, c, compare)) continue;
            const k = toStep(c.rating);
            by.set(k, [...(by.get(k) ?? []), c]);
        }
        // Closest in cost first: the cards the eye should weigh this one against.
        for (const list of by.values())
            list.sort(
                (a, b) =>
                    Math.abs(a.manaValue - card.manaValue) -
                        Math.abs(b.manaValue - card.manaValue) ||
                    a.name.localeCompare(b.name)
            );
        return by;
    }, [card, all, compare]);

    return (
        <>
            {card && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1">
                        <span className="mr-1 text-[10px] tracking-wide text-text-muted uppercase">
                            Compare with
                        </span>
                        {COMPARE.map((c) => (
                            <button
                                key={c.key}
                                type="button"
                                onClick={() => setCompare(c.key)}
                                className={
                                    "rounded-sm px-2 py-0.5 text-xs transition " +
                                    (compare === c.key
                                        ? "bg-accent/30 text-parchment"
                                        : "text-text-muted hover:bg-surface-elevated/50 hover:text-text")
                                }
                            >
                                {c.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-col">
                        {[...RATING_STEPS].reverse().map((step) => {
                            const here =
                                card.rating !== null &&
                                toStep(card.rating) === step;
                            const list = rungs.get(step) ?? [];
                            return (
                                <div
                                    key={step}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Rate ${card.name} ${step.toFixed(1)}`}
                                    onClick={() =>
                                        api.setRating(card.cardId, step)
                                    }
                                    className={
                                        "grid cursor-pointer items-center gap-2 border-t border-border-subtle/20 px-1 py-0.5 transition " +
                                        (here
                                            ? "bg-accent/20"
                                            : "hover:bg-surface-elevated/40")
                                    }
                                    style={{
                                        gridTemplateColumns:
                                            "2.5rem 2.25rem minmax(0, 1fr) 2.5rem",
                                        minHeight: "2.75rem",
                                    }}
                                >
                                    <span
                                        className={
                                            "font-mono text-sm " +
                                            (here
                                                ? "text-parchment"
                                                : "text-text-muted")
                                        }
                                    >
                                        {step.toFixed(1)}
                                        {card.seedRating === step && (
                                            <span className="block text-[8px] leading-none text-text-muted">
                                                seed
                                            </span>
                                        )}
                                    </span>
                                    <span>
                                        {here && (
                                            <Thumb
                                                card={card}
                                                width="w-8"
                                                sizes="32px"
                                                onPeek={onSelf}
                                            />
                                        )}
                                    </span>
                                    <span className="flex min-w-0 items-center gap-0.5 overflow-hidden">
                                        {list.slice(0, MAX_THUMBS).map((c) => (
                                            <Thumb
                                                key={c.cardId}
                                                card={c}
                                                width="w-7"
                                                sizes="28px"
                                                onPeek={openNeighbour}
                                            />
                                        ))}
                                    </span>
                                    <span className="text-right font-mono text-[11px] text-text-muted">
                                        {list.length > MAX_THUMBS
                                            ? `+${list.length - MAX_THUMBS}`
                                            : list.length === 0
                                              ? ""
                                              : list.length}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    <p className="text-[10px] text-text-disabled">
                        Click a rung to rate. Cards closest in cost come first.
                        A card on a rung: right-click for the preview, click to
                        open it here and reposition it, then back.
                    </p>
                </div>
            )}
        </>
    );
}
