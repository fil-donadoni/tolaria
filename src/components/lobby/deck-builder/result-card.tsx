import { useMemo, useState } from "react";
import CardImage from "~/components/cards/card-image";
import { defaultEdition, editionOptions } from "~/lib/editions";
import type { CardIndexEntry } from "./useCardSearch";
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

    return (
        <div className="flex w-[var(--card-w-sm)] shrink-0 flex-col gap-1">
            <button
                onClick={() => onAdd(selected, entry.name)}
                className="group relative w-full transition hover:scale-[1.03]"
                title={`Add ${entry.name}`}
            >
                <div className="aspect-5/7 w-full">
                    <CardImage card={{ id: selected }} />
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-accent/60" />
            </button>
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
