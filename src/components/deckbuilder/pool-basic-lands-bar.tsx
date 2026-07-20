import { Button } from "@/components/ui/button";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "./basicLands";

interface PoolBasicLandsBarProps {
    /** cardId to add for each subtype the drafted set actually printed and
     *  the seat's Pool happened to open; `null` when that subtype never
     *  appeared (not offered). */
    cardIdsBySubtype: Record<BasicLandSubtype, string | null>;
    onAdd: (cardId: string, cardName: string) => void;
    disabled: boolean;
}

/** "Unlimited basic lands added freely" (PRD #1107 story 18, ADR 0054/0055):
 *  a one-click add per Basic subtype the drafted set prints. Unlike every
 *  other card in the builder, a Basic isn't Pool-constrained — clicking
 *  appends a brand-new Maindeck copy rather than moving an existing one. */
export default function PoolBasicLandsBar({
    cardIdsBySubtype,
    onAdd,
    disabled,
}: PoolBasicLandsBarProps) {
    const available = BASIC_LAND_SUBTYPES.filter(
        (subtype) => cardIdsBySubtype[subtype] !== null
    );
    if (available.length === 0) return null;

    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle/30 bg-surface/60 px-4 py-2 md:px-6">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Add Basic
            </span>
            {available.map((subtype) => {
                const cardId = cardIdsBySubtype[subtype]!;
                return (
                    <Button
                        key={subtype}
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => onAdd(cardId, subtype)}
                    >
                        + {subtype}
                    </Button>
                );
            })}
        </div>
    );
}
