import { useState } from "react";
import CardImage from "~/components/cards/card-image";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import type { ScopeCardRating } from "~/hooks/useCardRatings";
import { manaCostToString } from "~/lib/card-utils";
import { formatOracleText } from "~/lib/oracle-text";
import PickRatingsDialogLayers from "./pick-ratings-dialog-layers";
import PickRatingsDialogTabs, {
    type DialogTab,
} from "./pick-ratings-dialog-tabs";
import { useRatingKeys } from "./pick-ratings-dialog-keys";
import PickRatingsLadder from "./pick-ratings-ladder";
import PickRatingsPack from "./pick-ratings-pack";
import PickRatingsSourceBadge from "./pick-ratings-source-badge";
import { effectiveRating, ratingSource } from "./pick-ratings-model";

interface PickRatingsDialogProps {
    /** The open card, read LIVE from the scope query; `null` = closed. */
    card: ScopeCardRating | null;
    /** Every card of the scope: the ladder's neighbours and the pack's pool. */
    all: readonly ScopeCardRating[];
    /** Its place in the walk (`index` 0-based), frozen at open. */
    index: number;
    total: number;
    /** The card Back returns to while detouring through a neighbour. */
    backToName: string | null;
    /** A write is in flight: every rating control waits. */
    saving: boolean;
    onRate: (card: ScopeCardRating, rating: number) => void;
    onClear: (card: ScopeCardRating) => void;
    onJump: (cardId: string) => void;
    /** Steps back in the walk; `null` at its first card or on a detour. */
    onPrev: (() => void) | null;
    /** Next in the walk, or Back out of a detour. */
    onNext: () => void;
    onClose: () => void;
}

/** The Pick Rating dialog (PRD #8772, issue #8909; prototype verdict
 *  `ladder-pack`): image, cost, source and the three layers on the left, the
 *  ladder on the right with the pack test one tab (or `p`) away. The tab
 *  survives Next, so a pass can stay on either. */
export default function PickRatingsDialog({
    card,
    all,
    index,
    total,
    backToName,
    saving,
    onRate,
    onClear,
    onJump,
    onPrev,
    onNext,
    onClose,
}: PickRatingsDialogProps) {
    const [tab, setTab] = useState<DialogTab>("ladder");
    useRatingKeys({
        enabled: card !== null,
        rating: card ? effectiveRating(card) : 0,
        disabled: saving,
        onRate: (rating) => card && onRate(card, rating),
        onNext,
        onPrev,
        onSwitchTab: () => setTab((t) => (t === "ladder" ? "pack" : "ladder")),
    });
    return (
        <GameDialog
            open={card !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            title={card?.name ?? ""}
            subtitle={
                card
                    ? backToName
                        ? `Opened from ${backToName}`
                        : `${index + 1} of ${total} in the current list`
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
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={onPrev === null}
                            onClick={() => onPrev?.()}
                        >
                            ← Prev
                        </Button>
                        <Button variant="primary" onClick={onNext}>
                            {backToName ? `← Back to ${backToName}` : "Next →"}
                        </Button>
                        {ratingSource(card) === "override" && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={saving}
                                onClick={() => onClear(card)}
                            >
                                Clear override
                            </Button>
                        )}
                        <span className="ml-auto text-xs text-text-muted">
                            0–5 set · +/− nudge · ↵ or j next · k prev · Esc
                            close
                        </span>
                    </div>
                )
            }
        >
            {card && (
                <div className="grid w-[min(1340px,calc(90vw-3rem))] grid-cols-[15rem_minmax(0,1fr)] gap-6">
                    <div className="flex flex-col gap-3">
                        <div
                            className="relative aspect-5/7 w-full"
                            data-pick-rating-dialog-art={card.cardId}
                        >
                            <CardImage
                                card={{ id: card.cardId }}
                                sizes="256px"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-sm">
                                {card.manaCost
                                    ? formatOracleText(
                                          manaCostToString(card.manaCost)
                                      )
                                    : "—"}
                            </span>
                            <PickRatingsSourceBadge
                                source={ratingSource(card)}
                            />
                        </div>
                        <PickRatingsDialogLayers card={card} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-3">
                        <PickRatingsDialogTabs
                            tab={tab}
                            onTab={setTab}
                            card={card}
                            all={all}
                        />
                        {tab === "ladder" ? (
                            <PickRatingsLadder
                                card={card}
                                all={all}
                                disabled={saving}
                                onRate={(rating) => onRate(card, rating)}
                                onOpenNeighbour={onJump}
                            />
                        ) : (
                            <PickRatingsPack
                                card={card}
                                all={all}
                                disabled={saving}
                                onRate={(rating) => onRate(card, rating)}
                            />
                        )}
                    </div>
                </div>
            )}
        </GameDialog>
    );
}
