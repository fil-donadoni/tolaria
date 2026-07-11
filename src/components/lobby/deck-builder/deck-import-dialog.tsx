import { useCallback, useState } from "react";
import type { FormatId } from "@convex/formats";
import GameDialog from "~/components/ui/game-dialog";
import { type ParsedDecklist, parseDecklist } from "~/lib/deckImport";

interface DeckImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // The working deck's format. Drives which printing each pasted name resolves
    // to: the earliest one legal in this format, so the import is legal by
    // construction (e.g. a Premodern import picks Counterspell's 4ed/Ice-Age
    // print, never LEA).
    format: FormatId;
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
 *  not in the registry (unknown or not-yet-implemented) are listed back to the
 *  user; the import stays partial and never blocks. */
export default function DeckImportDialog({
    open,
    onOpenChange,
    format,
    onImport,
}: DeckImportDialogProps) {
    const [text, setText] = useState("");
    const [parsed, setParsed] = useState<ParsedDecklist | null>(null);
    const [copied, setCopied] = useState(false);

    const reset = useCallback(() => {
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

    const handleParse = useCallback(() => {
        setParsed(parseDecklist(text, format));
    }, [text, format]);

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
                        {parsed.unresolved.length > 0 && (
                            <div className="rounded-sm border border-danger/40 bg-danger/10 px-3 py-2">
                                <div className="flex items-start justify-between gap-2">
                                    <p className="text-label text-danger">
                                        {parsed.unresolved.length} line
                                        {parsed.unresolved.length === 1
                                            ? ""
                                            : "s"}{" "}
                                        not recognised — skipped:
                                    </p>
                                    <button
                                        type="button"
                                        onClick={handleCopyUnresolved}
                                        className="btn-base btn-tone-ghost shrink-0 px-2 py-0.5 text-xs"
                                    >
                                        {copied ? "Copied" : "Copy"}
                                    </button>
                                </div>
                                <ul className="mt-1 max-h-32 select-text overflow-auto font-mono text-xs text-text-muted">
                                    {parsed.unresolved.map((line, i) => (
                                        <li key={i}>{line}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={close}
                        className="btn-base btn-tone-ghost px-3 py-1.5 text-sm"
                    >
                        Cancel
                    </button>
                    {parsed ? (
                        <button
                            type="button"
                            onClick={handleConfirm}
                            disabled={total === 0}
                            className="btn-base btn-tone-primary px-4 py-1.5 text-sm disabled:opacity-50"
                        >
                            Add {total} card{total === 1 ? "" : "s"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={handleParse}
                            disabled={text.trim() === ""}
                            className="btn-base btn-tone-primary px-4 py-1.5 text-sm disabled:opacity-50"
                        >
                            Preview
                        </button>
                    )}
                </div>
            </div>
        </GameDialog>
    );
}
