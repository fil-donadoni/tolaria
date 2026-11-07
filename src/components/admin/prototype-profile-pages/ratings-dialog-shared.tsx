// PROTOTYPE — throwaway. What every ratings dialog shares so that only the
// right-hand block differs between variants: the GameDialog frame, the image
// column with the rating's layers, the footer, the keys, the card thumb with
// the app's CardPreview and a click peek. Several bits in one file on purpose,
// as in proto-bits.tsx.
import { useEffect } from "react";
import CardImage from "~/components/cards/card-image";
import CardPreview from "~/components/cards/card-preview";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import type { RatingsProtoApi } from "./pick-ratings-prototype";
import type { ProtoRatingCard } from "./proto-data";
import { ArtTile, ManaCost } from "./proto-bits";
import { RATING_STEPS, SOURCE_LABEL } from "./ratings-dialog-utils";

export interface RatingDialogProps {
    card: ProtoRatingCard | null;
    index: number;
    total: number;
    all: ProtoRatingCard[];
    api: RatingsProtoApi;
    onClose: () => void;
    onPrev: () => void;
    onNext: () => void;
    /** Opens another card to reposition it; Next then comes back here. */
    onJump: (cardId: string) => void;
    /** Set while on such a detour: the card Next goes back to. */
    backToName: string | null;
}

export function SourceBadge({ source }: { source: ProtoRatingCard["source"] }) {
    const tone =
        source === "override"
            ? "bg-accent/20 text-accent-strong"
            : source === "seed"
              ? "bg-surface-elevated/60 text-text-muted"
              : "bg-danger-strong/15 text-danger-strong";
    return (
        <span
            className={`inline-flex h-5 shrink-0 items-center rounded-sm px-1.5 text-[10px] font-medium tracking-wide uppercase ${tone}`}
        >
            {SOURCE_LABEL[source]}
        </span>
    );
}

function useRatingKeys(props: RatingDialogProps) {
    const { card, api, onNext, onPrev } = props;
    useEffect(() => {
        if (!card) return;
        const r = card.rating ?? 0;
        const onKey = (e: KeyboardEvent) => {
            const t = e.target;
            if (
                t instanceof Element &&
                t.closest("input, textarea, [contenteditable]")
            )
                return;
            if (/^[0-5]$/.test(e.key))
                api.setRating(card.cardId, Number(e.key));
            if (e.key === "+" || e.key === "=")
                api.setRating(card.cardId, Math.min(5, r + 0.5));
            if (e.key === "-") api.setRating(card.cardId, Math.max(0, r - 0.5));
            if (e.key === "j" || e.key === "Enter") {
                e.preventDefault();
                onNext();
            }
            if (e.key === "k") onPrev();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });
}

function LayerRow({
    label,
    value,
    active,
}: {
    label: string;
    value: number | null;
    active: boolean;
}) {
    return (
        <div
            className={
                "flex items-baseline justify-between text-xs " +
                (active ? "text-parchment" : "text-text-muted")
            }
        >
            <span>{label}</span>
            <span className="font-mono">
                {value === null ? "—" : value.toFixed(1)}
            </span>
        </div>
    );
}

/** The frame of every variant: image and layers left, `children` right. */
export function RatingDialogShell({
    props,
    children,
}: {
    props: RatingDialogProps;
    children: React.ReactNode;
}) {
    const { card, index, total, api, onClose, onPrev, onNext, backToName } =
        props;
    useRatingKeys(props);
    return (
        <GameDialog
            open={card !== null}
            onOpenChange={(o) => {
                if (!o) onClose();
            }}
            title={card?.name ?? ""}
            subtitle={
                card
                    ? `${card.typeLine} · ${card.rarity} · ${
                          backToName
                              ? `opened from ${backToName}`
                              : `${index + 1} of ${total} in the current list`
                      }`
                    : undefined
            }
            align="start"
            size="wide"
            className="max-w-[1400px]"
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
                            {backToName ? `← Back to ${backToName}` : "Next →"}
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
                            0–5 set · +/− nudge · ↵ or j next · k prev · Esc
                            close
                        </span>
                    </div>
                )
            }
        >
            {card && (
                <div
                    className="grid gap-6"
                    style={{
                        gridTemplateColumns: "15rem minmax(0, 1fr)",
                        // The dialog's Panel shrink-wraps its content.
                        width: "min(1340px, calc(90vw - 3rem))",
                    }}
                >
                    <div className="flex flex-col gap-3">
                        <ArtTile
                            cardId={card.cardId}
                            name={card.name}
                            sizes="256px"
                        />
                        <div className="flex items-center justify-between">
                            <ManaCost symbols={card.costSymbols} />
                            <SourceBadge source={card.source} />
                        </div>
                        <div className="flex flex-col gap-0.5 border-t border-border-subtle/30 pt-2">
                            <LayerRow
                                label="Override"
                                value={
                                    card.source === "override"
                                        ? card.rating
                                        : null
                                }
                                active={card.source === "override"}
                            />
                            <LayerRow
                                label="Seed"
                                value={card.seedRating}
                                active={card.source === "seed"}
                            />
                            <LayerRow
                                label="Scope median"
                                value={card.fallbackRating}
                                active={card.source === "fallback"}
                            />
                        </div>
                    </div>
                    <div className="min-w-0">{children}</div>
                </div>
            )}
        </GameDialog>
    );
}

/** The half-point buttons, marking where the seed sits. */
export function RatingStepBar({
    card,
    api,
    height = "h-10",
}: {
    card: ProtoRatingCard;
    api: RatingsProtoApi;
    height?: string;
}) {
    return (
        <div className="flex gap-1">
            {RATING_STEPS.map((s) => (
                <button
                    key={s}
                    type="button"
                    onClick={() => api.setRating(card.cardId, s)}
                    className={
                        `relative flex ${height} flex-1 items-center justify-center rounded-sm border font-mono text-sm transition ` +
                        (card.rating === s
                            ? "border-accent-strong bg-accent/40 text-parchment"
                            : "border-border-subtle/30 text-text-muted hover:bg-surface-elevated/50 hover:text-text")
                    }
                >
                    {s.toFixed(1)}
                    {card.seedRating === s && (
                        <span className="absolute right-0.5 bottom-0 text-[8px] text-text-muted">
                            seed
                        </span>
                    )}
                </button>
            ))}
        </div>
    );
}

/** A small card: hover or right-click = CardPreview, click = peek. */
export function Thumb({
    card,
    width = "w-6",
    sizes = "24px",
    onPeek,
}: {
    card: { cardId: string; name: string; rating?: number | null };
    width?: string;
    sizes?: string;
    onPeek: (cardId: string, e: React.MouseEvent) => void;
}) {
    return (
        <span className={`block ${width} shrink-0`}>
            <CardPreview
                cardId={card.cardId}
                cardName={card.name}
                holdPreview={false}
            >
                <button
                    type="button"
                    onClick={(e) => onPeek(card.cardId, e)}
                    className="relative block aspect-5/7 w-full overflow-hidden rounded-xs ring-border-subtle/40 hover:ring-1"
                    title={
                        typeof card.rating === "number"
                            ? `${card.name} · ${card.rating.toFixed(1)}`
                            : card.name
                    }
                >
                    <CardImage card={{ id: card.cardId }} lazy sizes={sizes} />
                </button>
            </CardPreview>
        </span>
    );
}
