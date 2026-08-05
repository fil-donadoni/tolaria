import { Button } from "@/components/ui/button";
import { BASIC_LAND_SUBTYPES, type BasicLandSubtype } from "./basicLands";

interface PoolBasicLandsBarProps {
    /** cardId to add for each Basic subtype — the seat's own Pool printing
     *  when the Pool opened one, else the catalogue's canonical basic land
     *  (`resolveBasicLandCardIds`, issue #1576). `null` only in the
     *  pathological case where the catalogue itself has no definition for
     *  that subtype's name; that button renders disabled rather than being
     *  omitted. */
    cardIdsBySubtype: Record<BasicLandSubtype, string | null>;
    onAdd: (cardId: string, cardName: string) => void;
    disabled: boolean;
}

/** "Unlimited basic lands added freely" (PRD #1107 story 18, ADR 0054/0055):
 *  a one-click add per Basic subtype. Unlike every other card in the
 *  builder, a Basic isn't Pool-constrained — clicking appends a brand-new
 *  Maindeck copy rather than moving an existing one. All five subtypes
 *  ALWAYS render (issue #1576) — a Limited deck always needs basics
 *  regardless of what the drafted set's Pool happened to open (a Vintage
 *  Cube Pool has none), so this bar must never render `null`. */
export default function PoolBasicLandsBar({
    cardIdsBySubtype,
    onAdd,
    disabled,
}: PoolBasicLandsBarProps) {
    return (
        <div className="flex flex-wrap items-center gap-2 short-viewport:gap-1 border-b border-border-subtle/30 bg-surface/60 px-4 py-2 short-viewport:py-0.5 md:px-6">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Add Basic
            </span>
            {BASIC_LAND_SUBTYPES.map((subtype) => {
                const cardId = cardIdsBySubtype[subtype];
                return (
                    <Button
                        key={subtype}
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled || cardId === null}
                        onClick={() => {
                            if (cardId !== null) onAdd(cardId, subtype);
                        }}
                    >
                        + {subtype}
                    </Button>
                );
            })}
        </div>
    );
}
