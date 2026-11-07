// PROTOTYPE — throwaway. Ratings focus in a GameDialog (variant C's body):
// eleven half-point buttons, the ±0.5 calibration shelf, Prev / Next over
// the current filtered list. Keys: 0–5 set, +/− nudge, ↵ next, Esc close.
import { useEffect } from "react";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import type { ProtoRatingCard } from "./proto-data";
import { ArtTile, ColourPips, ManaCost } from "./proto-bits";

const STEPS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export default function RatingsFocusDialog({
    card,
    index,
    total,
    all,
    api,
    onClose,
    onPrev,
    onNext,
}: {
    card: ProtoRatingCard | null;
    index: number;
    total: number;
    all: ProtoRatingCard[];
    api: RatingsProtoApi;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
}) {
    const r = card?.rating ?? null;
    useEffect(() => {
        if (!card) return;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, [contenteditable]")
            )
                return;
            if (/^[0-5]$/.test(e.key))
                api.setRating(card.cardId, Number(e.key));
            if (e.key === "+")
                api.setRating(card.cardId, Math.min(5, (r ?? 0) + 0.5));
            if (e.key === "-")
                api.setRating(card.cardId, Math.max(0, (r ?? 0) - 0.5));
            if (e.key === "j" || e.key === "Enter") onNext();
            if (e.key === "k") onPrev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const shelf = (delta: number) =>
        !card || r === null
            ? []
            : all
                  .filter(
                      (c) =>
                          c.cardId !== card.cardId &&
                          c.rating !== null &&
                          Math.abs(c.rating - (r + delta)) < 0.01
                  )
                  .slice(0, 8);

    return (
        <GameDialog
            open={card !== null}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            title={card?.name ?? ""}
            subtitle={
                card
                    ? `${card.rarity} · ${card.source} · ${index + 1} of ${total} in the current list`
                    : undefined
            }
            align="start"
            size="wide"
            className="max-w-[1100px]"
            density="comfortable"
            showCloseButton
            footer={
                card && (
                    <div className="flex w-full items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onPrev}>
                            ← Prev
                        </Button>
                        <Button
                            variant="primary"
                            size="default"
                            onClick={onNext}
                        >
                            Next →
                        </Button>
                        {card.source === "override" && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => api.setRating(card.cardId, null)}
                            >
                                Clear override
                            </Button>
                        )}
                        <span className="ml-auto text-[10px] text-text-muted">
                            0–5 set · +/− nudge · ↵ next · Esc close
                        </span>
                    </div>
                )
            }
        >
            {card && (
                <div
                    className="grid gap-6"
                    style={{ gridTemplateColumns: "16rem minmax(0, 1fr)" }}
                >
                    <ArtTile
                        cardId={card.cardId}
                        name={card.name}
                        sizes="256px"
                    />
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                            <ManaCost symbols={card.costSymbols} />
                            <ColourPips colors={card.colors} />
                            {card.seedRating !== null && (
                                <span>· seed {card.seedRating.toFixed(1)}</span>
                            )}
                        </div>
                        <div className="flex gap-1">
                            {STEPS.map((s) => (
                                <button
                                    key={s}
                                    type="button"
                                    onClick={() =>
                                        api.setRating(card.cardId, s)
                                    }
                                    className={
                                        "flex h-12 flex-1 items-center justify-center rounded-sm border font-mono text-sm transition " +
                                        (r === s
                                            ? "border-accent-strong bg-accent/40 text-parchment"
                                            : "border-border-subtle/30 text-text-muted hover:bg-surface-elevated/50 hover:text-text")
                                    }
                                >
                                    {s.toFixed(1)}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            {[0.5, -0.5].map((d) => (
                                <div key={d}>
                                    <span className="text-[10px] tracking-wide text-text-muted uppercase">
                                        {d > 0
                                            ? "Rated half a point higher"
                                            : "Rated half a point lower"}
                                    </span>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {shelf(d).map((n) => (
                                            <ArtTile
                                                key={n.cardId}
                                                cardId={n.cardId}
                                                name={n.name}
                                                width="w-14"
                                                sizes="56px"
                                            />
                                        ))}
                                        {shelf(d).length === 0 && (
                                            <span className="text-[11px] text-text-disabled">
                                                none
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </GameDialog>
    );
}
