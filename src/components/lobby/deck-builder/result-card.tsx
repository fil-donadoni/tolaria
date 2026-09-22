import { useMemo, useState } from "react";
import CardImage from "~/components/cards/card-image";
import { defaultEdition, editionOptions } from "~/lib/editions";
import type { EditionOption } from "~/lib/editions";
import { useCardPrintEditions } from "~/lib/useCardPrintEditions";
import { useScryfallEditions } from "~/lib/scryfallApi";
import type { CardIndexEntry } from "./useCardSearch";
import DraggableCard from "./draggable-card";
import EditionDropdown from "./edition-dropdown";

interface ResultCardProps {
    entry: CardIndexEntry;
    /** Active set filter — drives the default edition when one of the card's
     *  printings belongs to a selected set. */
    activeSets: string[];
    /** The deck's Format allowed Sets (Old School / Alpha 40), `null`
     *  otherwise — pre-filters the `cardPrints` query so those two Formats'
     *  selectors never offer a set they'd have to reject (ADR 0140, issue
     *  #4117). */
    allowedSets: string[] | null;
    /** Whether an Unavailable Card (one the GRE does not implement) is dimmed
     *  and unselectable. TRUE for a real deck — it could not be played. FALSE
     *  in manual mode, where no rule is enforced and every printed card is
     *  playable by construction (ADR 0080), so availability says nothing about
     *  whether the card belongs in the deck. */
    enforceAvailability: boolean;
    /** `definitionId` is omitted for a Full Catalogue entry, whose `cardId`
     *  is a PRINT id rather than a Card Definition id (`makeCatalogueEntry`
     *  in `useCardSearch.ts`) — sending it would store a printing under the
     *  definition field and no later write would ever correct it, because
     *  `withDefinitionId` only fills a MISSING one. Omitted, the server
     *  resolves it (ADR 0140, issue #4117). */
    onAdd: (printId: string, cardName: string, definitionId?: string) => void;
}

export default function ResultCard({
    entry,
    activeSets,
    allowedSets,
    enforceAvailability,
    onAdd,
}: ResultCardProps) {
    const isCatalogue = entry.oracleText === "";

    // Card Prints (ADR 0140, issue #4117): the table is the source of truth
    // for every printing — promos, Secret Lair and digital-only included —
    // queried by Card ID only once the dropdown opens (`onOpen` below), never
    // eagerly. `entry.prints` (the hand-written catalogue) is kept only as
    // the pre-load fallback so the collapsed dropdown shows something before
    // the query resolves, exactly like the Scryfall-editions path already did.
    // Fed through the SAME `editionOptions`/`defaultEdition` (`~/lib/editions`)
    // the catalogue path uses — both produce `CardPrinting[]`, so the labeling
    // and default-selection logic is format-agnostic of its source.
    const { prints: tablePrints, load: loadTablePrints } = useCardPrintEditions(
        entry.cardId,
        allowedSets
    );

    const indexOptions = useMemo(
        () => editionOptions(entry.prints),
        [entry.prints]
    );
    const indexDefault = useMemo(
        () => defaultEdition(entry.prints, activeSets),
        [entry.prints, activeSets]
    );
    const tableOptions = useMemo(
        () => (tablePrints ? editionOptions(tablePrints) : undefined),
        [tablePrints]
    );
    const tableDefault = useMemo(
        () =>
            tablePrints ? defaultEdition(tablePrints, activeSets) : undefined,
        [tablePrints, activeSets]
    );

    const { editions: scryfallEditions, load: loadEditions } =
        useScryfallEditions(isCatalogue ? entry.name : null);

    const catalogueSingle: EditionOption = {
        printId: entry.prints[0].printId,
        label: entry.prints[0].setCode.toUpperCase(),
    };

    const options: EditionOption[] = isCatalogue
        ? (scryfallEditions ?? [catalogueSingle])
        : (tableOptions ?? indexOptions);

    // A Full Catalogue entry's `cardId` is a PRINT id, which
    // `cardPrints.listByCardId` can never match — and its options come from
    // the Scryfall path anyway, so the table query is not merely useless but
    // a billed read per dropdown open. Only the index path loads it.
    const loadEditionOptions = () => {
        loadEditions();
        if (!isCatalogue) loadTablePrints();
    };

    const defaultPrintId = isCatalogue
        ? entry.prints[0].printId
        : (tableDefault ?? indexDefault);

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
            onOpen={loadEditionOptions}
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
                        holdPreview={false}
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
                onClick={() =>
                    onAdd(
                        selected,
                        entry.name,
                        isCatalogue ? undefined : entry.cardId
                    )
                }
                title={`Add ${entry.name} (drag to a zone)`}
                className="group relative w-full hover:scale-[1.03]"
            >
                <div className="aspect-5/7 w-full">
                    <CardImage
                        card={{ id: selected }}
                        lazy
                        promoteLayer={false}
                        holdPreview={false}
                    />
                </div>
                {/* The "this click adds it" hover cue — the twin of
                    `deck-card-tile.tsx`'s hover-REMOVE overlay, and the same
                    shape: not one of the `card-ring` ROLES (ADR 0103 §8), so
                    it borrows `.card-ring`'s inset geometry and proportional
                    corner and supplies its own colour. Transparent until
                    hovered (issue #2724). */}
                <div className="card-ring pointer-events-none absolute inset-0 group-hover:[--card-ring-color:color-mix(in_oklab,var(--color-accent)_60%,transparent)]" />
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
