import { useMemo, useState } from "react";
import CardImage from "~/components/cards/card-image";
import { defaultEdition, editionOptions } from "~/lib/editions";
import type { CardIndexEntry } from "./useCardSearch";
import DraggableCard from "./draggable-card";
import EditionDropdown from "./edition-dropdown";

interface ResultCardProps {
    entry: CardIndexEntry;
    /** Active set filter — drives the default edition when one of the card's
     *  printings belongs to a selected set. */
    activeSets: string[];
    onAdd: (printId: string, cardName: string) => void;
}

export default function ResultCard({
    entry,
    activeSets,
    onAdd,
}: ResultCardProps) {
    const options = useMemo(() => editionOptions(entry.prints), [entry.prints]);
    const defaultPrintId = useMemo(
        () => defaultEdition(entry.prints, activeSets),
        [entry.prints, activeSets]
    );

    const [override, setOverride] = useState<string | null>(null);
    const selected = override ?? defaultPrintId;
    const unavailable = entry.available === false;

    if (unavailable) {
        return (
            <div className="flex w-(--card-w) shrink-0 flex-col gap-1 opacity-40 pointer-events-none">
                <div className="aspect-5/7 w-full">
                    <CardImage card={{ id: selected }} lazy />
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent" />
                <span className="text-center text-[10px] text-text-disabled leading-tight">
                    Not yet available
                </span>
                {options.length > 1 && (
                    <EditionDropdown
                        options={options}
                        value={selected}
                        onChange={setOverride}
                    />
                )}
            </div>
        );
    }

    // Drag → drop into Maindeck or Sideboard; plain click → quick-add to
    // Maindeck (the fast path). The edition dropdown stays a separate, non-drag
    // control below the art.
    return (
        <div className="flex w-(--card-w) shrink-0 flex-col gap-1">
            <DraggableCard
                id={`result:${selected}`}
                data={{
                    kind: "result",
                    cardId: selected,
                    cardName: entry.name,
                }}
                onClick={() => onAdd(selected, entry.name)}
                title={`Add ${entry.name} (drag to a zone)`}
                className="group relative w-full hover:scale-[1.03]"
            >
                <div className="aspect-5/7 w-full">
                    <CardImage card={{ id: selected }} lazy />
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-accent/60" />
            </DraggableCard>
            {options.length > 1 && (
                <EditionDropdown
                    options={options}
                    value={selected}
                    onChange={setOverride}
                />
            )}
        </div>
    );
}
