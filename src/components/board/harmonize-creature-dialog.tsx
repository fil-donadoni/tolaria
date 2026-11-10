import type { CardInstance } from "~/types/game";
import { getDefinition } from "@convex/cards";
import GameDialog from "~/components/ui/game-dialog";
import { Button } from "~/components/ui/button";
import CardImage from "~/components/cards/card-image";
import { PILE_GRID_TILE_W } from "~/lib/card-layout";
import { pickerRingClass } from "~/lib/picker-ring";
import { displayCardId } from "~/lib/card-utils";

/** CR 702.180a/b — the Harmonize creature picker, asked BEFORE the cast is
 *  announced: "tapping up to one untapped creature you control", whose power
 *  reduces the generic part of the harmonize cost. The choice is part of the
 *  announcement (CR 601.2b), so this dialog dispatches nothing itself — the
 *  pick rides `announceCast`'s `harmonizeCreatureId` through `onPick`, and
 *  "Don't tap" announces the cast with no creature. Dismissing abandons the
 *  cast before anything reached the server. */
export default function HarmonizeCreatureDialog({
    creatures,
    onPick,
    onCancel,
}: {
    /** The caster's untapped creatures, each with its live power. */
    creatures: { card: CardInstance; power: number }[];
    onPick: (creatureId: string | undefined) => void;
    onCancel: () => void;
}) {
    return (
        <GameDialog
            open
            onOpenChange={(open) => {
                if (!open) onCancel();
            }}
            title="Harmonize"
            subtitle="Tap up to one untapped creature you control — its power reduces the generic mana of the harmonize cost"
            size="wide"
        >
            <div className="flex flex-wrap justify-center gap-2 mt-2 p-1">
                {creatures.map(({ card, power }) => (
                    <button
                        key={card.id}
                        type="button"
                        onClick={() => onPick(card.id)}
                        title={`${getDefinition(displayCardId(card)).name} — reduces the cost by ${Math.max(0, power)}`}
                        aria-label={`Tap ${getDefinition(displayCardId(card)).name} (power ${power})`}
                        className={`relative ${PILE_GRID_TILE_W} aspect-5/7 overflow-hidden transition-all cursor-pointer ${pickerRingClass(false)}`}
                    >
                        <CardImage card={card} />
                    </button>
                ))}
            </div>
            <div className="mt-3 flex justify-end">
                <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => onPick(undefined)}
                >
                    Don&apos;t tap a creature
                </Button>
            </div>
        </GameDialog>
    );
}
