// PROTOTYPE — throwaway. Dialog "shelf", the baseline from the first session:
// the half-point buttons and the cards rated half a point higher and lower.
import {
    RatingDialogShell,
    RatingStepBar,
    Thumb,
    type RatingDialogProps,
} from "./ratings-dialog-shared";
import { usePeek } from "./ratings-dialog-peek";

export default function RatingsFocusDialog(props: RatingDialogProps) {
    const { card, all, api } = props;
    const { onPeek, layer } = usePeek();
    const r = card?.rating ?? null;
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
                  .slice(0, 12);
    return (
        <RatingDialogShell props={props}>
            {card && (
                <div className="flex flex-col gap-5">
                    <RatingStepBar card={card} api={api} height="h-12" />
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
                                        <Thumb
                                            key={n.cardId}
                                            card={n}
                                            width="w-14"
                                            sizes="56px"
                                            onPeek={onPeek}
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
                    {layer}
                </div>
            )}
        </RatingDialogShell>
    );
}
