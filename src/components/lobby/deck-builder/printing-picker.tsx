import { useMemo, useState } from "react";
import { ImagesIcon, SearchIcon } from "lucide-react";
import type { CardPrinting } from "@convex/cards/catalogue";
import GameDialog from "~/components/ui/game-dialog";
import { Input } from "~/components/ui/input";
import { useDebouncedValue } from "~/hooks/useDebouncedValue";
import { editionOptions } from "~/lib/editions";
import {
    countByKind,
    filterByKind,
    inSets,
    matchSetCodes,
    mergePrintings,
    restrictSets,
    type PickerPrinting,
    type PrintingKindFilter,
} from "~/lib/printingPicker";
import { useCardPrintings } from "~/lib/useCardPrintings";
import { useScryfallSetNames } from "~/lib/useScryfallSetNames";
import PrintingKindChips from "./printing-kind-chips";
import PrintingTile from "./printing-tile";

const SET_QUERY_DEBOUNCE_MS = 250;

interface PrintingPickerProps {
    cardName: string;
    /** Card Definition id the `cardPrints` table is keyed by; `null` for a
     *  Full Catalogue entry, whose printings come from Scryfall instead
     *  (`basePrintings`, fed by `onOpen`). */
    cardId: string | null;
    /** Printings known without the table: the hand-written catalogue's (the
     *  Definition's own printing among them, which the table never holds) or
     *  Scryfall's editions for a Full Catalogue entry. */
    basePrintings: readonly CardPrinting[];
    /** The deck's Format allowed Sets (Old School / Alpha 40), `null`
     *  otherwise — no printing outside them is ever offered (ADR 0140). */
    allowedSets: string[] | null;
    selected: CardPrinting;
    onSelect: (printing: PickerPrinting) => void;
    /** Fired when the picker opens — the Full Catalogue path's Scryfall
     *  editions load. */
    onOpen?: () => void;
}

/**
 * The deck builder's visual printing picker (issue #4122, owner-chosen
 * layout: a dialog grid with kind chips and a Set text filter). The footer
 * button names the chosen printing's Set; it opens a grid of every printing's
 * image, read from `cardPrints` only then, a page at a time. The text filter
 * resolves a Set name or code ("odyssey", "ody") to Set codes and restricts
 * the QUERY to them, so a basic land's four Odyssey printings are found
 * without paging through its other thousand. One click picks and closes.
 */
export default function PrintingPicker({
    cardName,
    cardId,
    basePrintings,
    allowedSets,
    selected,
    onSelect,
    onOpen,
}: PrintingPickerProps) {
    const [open, setOpen] = useState(false);
    const [setQuery, setSetQuery] = useState("");
    const [kind, setKind] = useState<PrintingKindFilter>("all");
    const debouncedQuery = useDebouncedValue(setQuery, SET_QUERY_DEBOUNCE_MS);
    const setNames = useScryfallSetNames(open);

    const sets = useMemo(
        () =>
            restrictSets(
                allowedSets,
                matchSetCodes(
                    debouncedQuery,
                    setNames,
                    basePrintings.map((p) => p.setCode)
                )
            ),
        [allowedSets, debouncedQuery, setNames, basePrintings]
    );
    const table = useCardPrintings(cardId, sets, open);

    const printings = useMemo(
        () =>
            mergePrintings(
                basePrintings.filter((p) => inSets(p, sets)),
                table.printings
            ),
        [basePrintings, sets, table.printings]
    );
    const counts = useMemo(() => countByKind(printings), [printings]);
    const visible = useMemo(
        () => filterByKind(printings, kind),
        [printings, kind]
    );
    const labels = useMemo(() => editionOptions(visible), [visible]);

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) onOpen?.();
    };
    const pick = (p: PickerPrinting) => {
        onSelect(p);
        setOpen(false);
    };
    const nameOf = (code: string) =>
        setNames.get(code.toLowerCase()) ?? code.toUpperCase();

    return (
        <>
            <button
                type="button"
                onClick={(e) => {
                    // The cell's own click adds the card; this one must not.
                    e.stopPropagation();
                    handleOpenChange(true);
                }}
                aria-label={`Choose printing of ${cardName}`}
                aria-haspopup="dialog"
                title={`Printing: ${nameOf(selected.setCode)}`}
                className="flex w-full items-center justify-center gap-1 rounded-sm border border-border-subtle/40 bg-surface-elevated/40 py-0.5 text-[10px] uppercase tracking-wide text-text-muted transition hover:text-parchment"
            >
                <span className="truncate">{selected.setCode}</span>
                <ImagesIcon className="size-3 shrink-0 opacity-60" />
            </button>
            <GameDialog
                open={open}
                onOpenChange={handleOpenChange}
                title={cardName}
                size="wide"
                showCloseButton
                stats={
                    <>
                        <label className="relative min-w-40 flex-1">
                            <span className="sr-only">Filter by set</span>
                            <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-text-disabled" />
                            <Input
                                type="search"
                                value={setQuery}
                                onChange={(e) => setSetQuery(e.target.value)}
                                placeholder="Set name or code…"
                                className="pl-7"
                            />
                        </label>
                        <PrintingKindChips
                            counts={counts}
                            value={kind}
                            onChange={setKind}
                            partial={table.canLoadMore}
                        />
                    </>
                }
            >
                {visible.length === 0 ? (
                    <p className="py-6 text-center text-sm text-text-muted">
                        {table.loading
                            ? "Loading printings…"
                            : "No printing matches."}
                    </p>
                ) : (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                        {visible.map((p, i) => (
                            <PrintingTile
                                key={p.printId}
                                printing={p}
                                label={labels[i].label}
                                setName={nameOf(p.setCode)}
                                selected={p.printId === selected.printId}
                                onSelect={pick}
                            />
                        ))}
                    </div>
                )}
                {table.canLoadMore && (
                    <button
                        type="button"
                        onClick={table.loadMore}
                        className="mt-3 w-full text-[11px] text-text-muted underline"
                    >
                        Load more
                    </button>
                )}
            </GameDialog>
        </>
    );
}
