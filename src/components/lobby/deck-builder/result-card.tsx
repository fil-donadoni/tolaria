import { useMemo, useState } from "react";
import CardImage from "~/components/cards/card-image";
import { defaultEdition, editionOptions } from "~/lib/editions";
import type { EditionOption } from "~/lib/editions";
import { useScryfallEditions } from "~/lib/scryfallApi";
import type { CardIndexEntry } from "./useCardSearch";
import DraggableCard from "./draggable-card";
import EditionDropdown from "./edition-dropdown";

interface ResultCardProps {
    entry: CardIndexEntry;
    /** Active set filter — drives the default edition when one of the card's
     *  printings belongs to a selected set. */
    activeSets: string[];
    /** Whether an Unavailable Card (one the GRE does not implement) is dimmed
     *  and unselectable. TRUE for a real deck — it could not be played. FALSE
     *  in manual mode, where no rule is enforced and every printed card is
     *  playable by construction (ADR 0080), so availability says nothing about
     *  whether the card belongs in the deck. */
    enforceAvailability: boolean;
    onAdd: (printId: string, cardName: string) => void;
}

export default function ResultCard({
    entry,
    activeSets,
    enforceAvailability,
    onAdd,
}: ResultCardProps) {
    const isCatalogue = entry.oracleText === "";

    const indexOptions = useMemo(
        () => editionOptions(entry.prints),
        [entry.prints]
    );
    const indexDefault = useMemo(
        () => defaultEdition(entry.prints, activeSets),
        [entry.prints, activeSets]
    );

    const { editions: scryfallEditions, load: loadEditions } =
        useScryfallEditions(isCatalogue ? entry.name : null);

    const catalogueSingle: EditionOption = {
        printId: entry.prints[0].printId,
        label: entry.prints[0].setCode.toUpperCase(),
    };

    const options: EditionOption[] = isCatalogue
        ? (scryfallEditions ?? [catalogueSingle])
        : indexOptions;

    const defaultPrintId = isCatalogue ? entry.prints[0].printId : indexDefault;

    const [override, setOverride] = useState<string | null>(null);
    const selected = override ?? defaultPrintId;
    const unavailable = enforceAvailability && entry.available === false;

    // The footer is a FIXED-height slot, occupied or not. Every cell is then
    // the same height, which is what lets the grid be windowed by row
    // arithmetic (`gridWindow.ts`) instead of measuring each row — and it
    // also squares up a grid that used to sit ragged, cards at different
    // vertical offsets depending on whether they had an edition dropdown.
    const renderFooter = (content: React.ReactNode) => (
        <div className="flex h-6 items-center justify-center">{content}</div>
    );

    const dropdown = (
        <EditionDropdown
            options={options}
            value={selected}
            onChange={setOverride}
            onOpen={loadEditions}
        />
    );

    if (unavailable) {
        return (
            <div className="flex w-(--card-w) shrink-0 flex-col gap-1 opacity-40 pointer-events-none">
                <div className="aspect-5/7 w-full">
                    <CardImage
                        card={{ id: selected }}
                        lazy
                        promoteLayer={false}
                    />
                </div>
                {renderFooter(
                    options.length > 1 ? (
                        dropdown
                    ) : (
                        // One line, so it fits the shared footer height. The
                        // cell is already dimmed and click-through — this
                        // names the reason, it does not carry it alone.
                        <span className="text-[10px] text-text-disabled leading-none">
                            Unavailable
                        </span>
                    )
                )}
            </div>
        );
    }

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
                    <CardImage
                        card={{ id: selected }}
                        lazy
                        promoteLayer={false}
                    />
                </div>
                <div className="pointer-events-none absolute inset-0 rounded-sm ring-2 ring-transparent group-hover:ring-accent/60" />
            </DraggableCard>
            {renderFooter(
                options.length > 1 ||
                    (isCatalogue && scryfallEditions === undefined)
                    ? dropdown
                    : null
            )}
        </div>
    );
}
