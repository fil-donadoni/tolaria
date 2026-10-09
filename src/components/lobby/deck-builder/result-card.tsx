import { useMemo, useState } from "react";
import type { CardPrinting } from "@convex/cards/catalogue";
import CardImage from "~/components/cards/card-image";
import { defaultEdition } from "~/lib/editions";
import { useScryfallEditions } from "~/lib/scryfallApi";
import type { CardIndexEntry } from "./useCardSearch";
import DraggableCard from "./draggable-card";
import PrintingPicker from "./printing-picker";

interface ResultCardProps {
    entry: CardIndexEntry;
    /** Active set filter — drives the default edition when one of the card's
     *  printings belongs to a selected set. */
    activeSets: string[];
    /** The deck's Format allowed Sets (Old School / Alpha 40), `null`
     *  otherwise — pre-filters the `cardPrints` query so those two Formats'
     *  printing pickers never offer a set they'd have to reject (ADR 0140,
     *  issues #4117, #4122). */
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

    // The printing picker (issue #4122) reads every printing from the Card
    // Prints table (ADR 0140) — promos, Secret Lair and digital-only
    // included — but only once it opens, never eagerly for a results page.
    // Until then the cell shows the hand-written catalogue's default:
    // `defaultEdition` picks the active Set filter's printing when the card
    // has one, else the Definition's own.
    const defaultPrinting = useMemo<CardPrinting>(() => {
        const id = defaultEdition(entry.prints, activeSets);
        return entry.prints.find((p) => p.printId === id) ?? entry.prints[0];
    }, [entry.prints, activeSets]);

    // A Full Catalogue entry's `cardId` is a PRINT id, which
    // `cardPrints.listByCardId` can never match — its printings come from
    // Scryfall's editions search instead, loaded when the picker opens.
    const { editions: scryfallEditions, load: loadEditions } =
        useScryfallEditions(isCatalogue ? entry.name : null);
    const basePrintings = useMemo<readonly CardPrinting[]>(
        () =>
            isCatalogue
                ? (scryfallEditions ?? entry.prints.slice(0, 1))
                : entry.prints,
        [isCatalogue, scryfallEditions, entry.prints]
    );

    const [override, setOverride] = useState<CardPrinting | null>(null);
    const chosen = override ?? defaultPrinting;
    const selected = chosen.printId;
    const unavailable = enforceAvailability && entry.available === false;

    // The footer is a FIXED-height slot, occupied or not. Every cell is then
    // the same height, which is what lets the grid be windowed by row
    // arithmetic (`gridWindow.ts`) instead of measuring each row — and it
    // also squares up a grid that used to sit ragged, cards at different
    // vertical offsets depending on whether they had an edition selector.
    const renderFooter = (content: React.ReactNode) => (
        <div className="flex h-6 items-center justify-center">{content}</div>
    );

    const picker = (
        <PrintingPicker
            cardName={entry.name}
            cardId={isCatalogue ? null : entry.cardId}
            basePrintings={basePrintings}
            allowedSets={allowedSets}
            selected={chosen}
            onSelect={setOverride}
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
                        holdPreview={false}
                    />
                </div>
                {renderFooter(
                    // One line, so it fits the shared footer height. The cell
                    // is already dimmed and click-through — this names the
                    // reason, it does not carry it alone.
                    <span className="text-[10px] text-text-disabled leading-none">
                        Unavailable
                    </span>
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
            {renderFooter(picker)}
        </div>
    );
}
