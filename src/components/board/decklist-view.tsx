import type { DeckCard } from "~/types/game";
import DecklistSection from "./decklist-section";

type DecklistViewProps = {
    maindeck: DeckCard[];
    sideboard: DeckCard[];
};

/** Read-only registered decklist (issue #2241): the viewer's current Match
 *  deck copy split into Maindeck and Sideboard. Not the live library. */
export default function DecklistView({
    maindeck,
    sideboard,
}: DecklistViewProps) {
    return (
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
            <DecklistSection title="Maindeck" cards={maindeck} />
            <DecklistSection title="Sideboard" cards={sideboard} />
        </div>
    );
}
