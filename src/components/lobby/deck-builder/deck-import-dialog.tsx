import { useCallback, useRef, useState } from "react";
import { FORMAT_RULES, type FormatId } from "@convex/formats";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import { type ParsedDecklist, parseDecklist } from "~/lib/deckImport";
import type { CatalogueNameResolver } from "~/lib/fullCatalogue";
import { useEarliestPrintFetcher } from "~/lib/useEarliestPrintFetcher";

interface DeckImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // The working deck's format. Drives which printing each pasted name resolves
    // to: the earliest one legal in this format, so the import is legal by
    // construction (e.g. a Premodern import picks Counterspell's 4ed/Ice-Age
    // print, never LEA).
    format: FormatId;
    // Full-Catalogue name resolution (ADR 0080). Supplied in Tabletop mode, where
    // the pool is every printed card, so a pasted name the GRE doesn't implement
    // still imports. Absent, resolution is registry-only.
    resolveCatalogueName?: CatalogueNameResolver;
    // Append the parsed piles to the working deck. Called with the resolved
    // cards only; the dialog has already surfaced any unresolved lines.
    onImport: (parsed: ParsedDecklist) => void;
}

const PLACEHOLDER = `Deck
1 Black Lotus
4 Counterspell

Sideboard
2 Blue Elemental Blast`;

/** Paste-a-decklist importer. Accepts the MTGA / Scryfall text format and
 *  appends the resolved cards to the current Maindeck and Sideboard. Card names
 *  resolved by neither the registry nor (in Tabletop mode) the Full Catalogue
 *  are listed back to the user; the import stays partial and never blocks. */
export default function DeckImportDialog({
    open,
    onOpenChange,
    format,
    resolveCatalogueName,
    onImport,
}: DeckImportDialogProps) {
    const [text, setText] = useState("");
    const [parsed, setParsed] = useState<ParsedDecklist | null>(null);
    const [copied, setCopied] = useState(false);
    const [parsing, setParsing] = useState(false);
    const [printingsFailed, setPrintingsFailed] = useState(false);
    const fetchEarliest = useEarliestPrintFetcher();
    // Bumped on every edit/reset so a Parse still awaiting the table cannot
    // land its result over text the user has since changed.
    const parseEpoch = useRef(0);

    const reset = useCallback(() => {
        parseEpoch.current++;
        setParsing(false);
        setPrintingsFailed(false);
        setText("");
        setParsed(null);
        setCopied(false);
    }, []);

    const handleCopyUnresolved = useCallback(() => {
        if (!parsed || parsed.unresolved.length === 0) return;
        void navigator.clipboard
            .writeText(parsed.unresolved.join("\n"))
            .then(() => setCopied(true));
    }, [parsed]);

    const close = useCallback(() => {
        reset();
        onOpenChange(false);
    }, [onOpenChange, reset]);

    const total = parsed ? parsed.cards.length + parsed.sideboard.length : 0;

    // The printing each name imports under comes from the `cardPrints` table
    // (issue #5106): parse once to learn the Card IDs, fetch the earliest
    // legal row per Card ID, parse again with them. An unrestricted Format
    // (Freeform) needs no fetch.
    const handleParse = useCallback(async () => {
        const epoch = ++parseEpoch.current;
        const first = parseDecklist(text, format, resolveCatalogueName);
        const allowedSets = FORMAT_RULES[format].allowedSets;
        if (!allowedSets) {
            setParsed(first);
            return;
        }
        setParsing(true);
        setPrintingsFailed(false);
        try {
            const earliest = await fetchEarliest(
                [...first.cards, ...first.sideboard].map((c) => c.cardId),
                allowedSets
            );
            if (epoch !== parseEpoch.current) return;
            setParsed(
                parseDecklist(text, format, resolveCatalogueName, earliest)
            );
        } catch {
            // The table is unreachable: import under the home printings, as a
            // Format with no printing of the card in its Sets would.
            if (epoch !== parseEpoch.current) return;
            setPrintingsFailed(true);
            setParsed(first);
        } finally {
            if (epoch === parseEpoch.current) setParsing(false);
        }
    }, [text, format, resolveCatalogueName, fetchEarliest]);

    const handleConfirm = useCallback(() => {
        if (parsed) onImport(parsed);
        close();
    }, [parsed, onImport, close]);

    return (
        <GameDialog
            open={open}
            onOpenChange={(next) => (next ? onOpenChange(true) : close())}
            title="Import decklist"
            subtitle="Paste a list — counts add to your Maindeck and Sideboard."
            showCloseButton
        >
            <div className="flex flex-col gap-3">
                <textarea
                    value={text}
                    onChange={(e) => {
                        parseEpoch.current++;
                        setParsing(false);
                        setPrintingsFailed(false);
                        setText(e.target.value);
                        setParsed(null);
                        setCopied(false);
                    }}
                    placeholder={PLACEHOLDER}
                    rows={12}
                    spellCheck={false}
                    className="input-field w-full resize-y px-3 py-2 font-mono text-xs"
                />

                {parsed && (
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="text-text-muted">
                            {parsed.cards.length} maindeck ·{" "}
                            {parsed.sideboard.length} sideboard
                        </p>
                        {printingsFailed && (
                            <Banner tone="danger" role="alert">
                                Printings could not be loaded — cards import
                                under their original printing, which this format
                                may not allow.
                            </Banner>
                        )}
                        {parsed.unresolved.length > 0 && (
                            <Banner tone="danger">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-label">
                                        {parsed.unresolved.length} line
                                        {parsed.unresolved.length === 1
                                            ? ""
                                            : "s"}{" "}
                                        not recognised — skipped:
                                    </p>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="xs"
                                        onClick={handleCopyUnresolved}
                                        className="shrink-0"
                                    >
                                        {copied ? "Copied" : "Copy"}
                                    </Button>
                                </div>
                                <ul className="mt-1 max-h-32 select-text overflow-auto font-mono text-xs text-text-muted">
                                    {parsed.unresolved.map((line, i) => (
                                        <li key={i}>{line}</li>
                                    ))}
                                </ul>
                            </Banner>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={close}
                    >
                        Cancel
                    </Button>
                    {parsed ? (
                        <Button
                            type="button"
                            variant="primary"
                            onClick={handleConfirm}
                            disabled={total === 0}
                        >
                            Add {total} card{total === 1 ? "" : "s"}
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="primary"
                            onClick={() => void handleParse()}
                            disabled={text.trim() === "" || parsing}
                        >
                            Preview
                        </Button>
                    )}
                </div>
            </div>
        </GameDialog>
    );
}
