import { useMemo } from "react";
import { LAND_SUBTYPE_MANA } from "@convex/gre/constants";
import CardImage from "~/components/cards/card-image";
import ManaSymbol from "~/components/cards/mana-symbol";
import { Button } from "~/components/ui/button";
import PrintingPicker from "~/components/lobby/deck-builder/printing-picker";
import {
    basicLandDefinitionId,
    legalBasicLandPrintings,
    type BasicLandSubtype,
} from "./basicLands";

interface BasicLandTileProps {
    subtype: BasicLandSubtype;
    /** The printing in effect for this subtype (stored preference, else Pool
     *  printing, else catalogue default); `null` only when the catalogue has
     *  no definition for the subtype — the tile renders disabled. */
    cardId: string | null;
    /** Current Maindeck copy count of the subtype. */
    count: number;
    /** The deck Format's allowed Sets, `null` offers every printing. */
    allowedSets: string[] | null;
    onAdd: (cardId: string, cardName: string, count: number) => void;
    onRemove: (subtype: BasicLandSubtype) => void;
    onPickArt: (subtype: BasicLandSubtype, printId: string) => void;
    disabled: boolean;
}

/** One basic land of the Add Basic bar (issue #5398): its art — tapping it
 *  opens the issue #4122 printing picker, Format-filtered — its mana symbol,
 *  the Maindeck count, `−` and `+`. */
export default function BasicLandTile({
    subtype,
    cardId,
    count,
    allowedSets,
    onAdd,
    onRemove,
    onPickArt,
    disabled,
}: BasicLandTileProps) {
    const basePrintings = useMemo(
        () => legalBasicLandPrintings(subtype, [], allowedSets),
        [subtype, allowedSets]
    );
    const addDisabled = disabled || cardId === null;
    // Removing needs no resolved cardId: the copies are in the Maindeck and
    // are identified by subtype (PR #2320 review B1); the count is the floor.
    const removeDisabled = disabled || count === 0;
    const selected = {
        printId: cardId ?? "",
        setCode: basePrintings.find((p) => p.printId === cardId)?.setCode ?? "",
    };

    return (
        <div className="flex w-14 min-w-0 flex-col items-center gap-1 md:w-20 short-viewport:w-14">
            <PrintingPicker
                cardName={subtype}
                cardId={basicLandDefinitionId(subtype)}
                basePrintings={basePrintings}
                allowedSets={allowedSets}
                selected={selected}
                onSelect={(p) => onPickArt(subtype, p.printId)}
                renderTrigger={(open) => (
                    <button
                        type="button"
                        onClick={open}
                        disabled={disabled || cardId === null}
                        aria-label={`Choose ${subtype} art`}
                        aria-haspopup="dialog"
                        title={`Choose ${subtype} art`}
                        className="aspect-5/7 w-full overflow-hidden rounded-sm border border-border-subtle/40 bg-surface-elevated/40 transition hover:border-accent/60 disabled:opacity-40"
                    >
                        {cardId !== null && (
                            <CardImage
                                card={{ id: cardId }}
                                promoteLayer={false}
                            />
                        )}
                    </button>
                )}
            />
            <div className="flex items-center gap-1">
                <ManaSymbol
                    symbol={LAND_SUBTYPE_MANA[subtype]}
                    className="size-4"
                />
                <span
                    className="min-w-[1.5ch] text-center text-sm tabular-nums text-parchment"
                    data-testid={`basic-count-${subtype}`}
                >
                    {count}
                </span>
            </div>
            <div className="flex items-center gap-1">
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove one ${subtype}`}
                    title={`Remove one ${subtype}`}
                    disabled={removeDisabled}
                    onClick={() => {
                        if (count > 0) onRemove(subtype);
                    }}
                >
                    −
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Add one ${subtype}`}
                    title={`Add one ${subtype}`}
                    disabled={addDisabled}
                    onClick={() => {
                        if (cardId !== null) onAdd(cardId, subtype, 1);
                    }}
                >
                    +
                </Button>
            </div>
        </div>
    );
}
