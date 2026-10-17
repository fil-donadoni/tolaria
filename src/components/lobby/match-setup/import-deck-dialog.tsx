// Strict decklist import dialog for steps 4 and 5 (PRD #5334 stories 41–48,
// issue #5343): a name, a Format when the Match Format is Freeform, and a
// pasted list. Refused as a whole — with every problem listed — rather than
// imported in part; on success the deck is saved as a normal user deck.
//
// The parser reads the card catalogue, and the Setup flow is a light surface
// that renders without it (issue #5584): the dialog loads both when it opens
// (`loadStrictImport`) and keeps Import disabled until they are resident.
import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { FORMAT_LABELS, type FormatId } from "@convex/formats";
import { Banner } from "~/components/ui/banner";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "~/components/ui/tooltip";
import { useUserDeckMutations } from "~/hooks/useUserDecks";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import {
    IMPORT_FORMAT_CHOICES,
    importFormat,
} from "~/lib/matchSetupImportFormats";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import {
    loadedStrictImport,
    loadStrictImport,
    type StrictImportModule,
} from "~/lib/strictImportLoader";
import { useEarliestPrintFetcher } from "~/lib/useEarliestPrintFetcher";

const PLACEHOLDER = `4 Lightning Bolt
4x Counterspell

Sideboard
2 Blue Elemental Blast`;

const FORMAT_HELP =
    'One card per line: "4 Lightning Bolt" ("4x" also works). A "Sideboard" line starts the sideboard. MTGA, Moxfield and MTGO exports paste as-is.';

export default function ImportDeckDialog({
    open,
    onOpenChange,
    matchFormat,
    onImported,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    matchFormat: FormatId;
    onImported: (deck: UserLobbyDeck) => void;
}) {
    const [name, setName] = useState("");
    const [text, setText] = useState("");
    const [chosen, setChosen] = useState<FormatId>("freeform");
    const [errors, setErrors] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [importer, setImporter] = useState<StrictImportModule | null>(
        loadedStrictImport
    );
    const [loadError, setLoadError] = useState<string | null>(null);
    const { create } = useUserDeckMutations();
    const fetchEarliest = useEarliestPrintFetcher();
    const format = importFormat(matchFormat, chosen);

    // Opening the dialog loads the parser and the catalogue's names (issue
    // #5616); a failed load is retried by reopening it (neither memoises a
    // failure).
    useEffect(() => {
        if (!open || importer !== null) return;
        let cancelled = false;
        loadStrictImport().then(
            (loaded) => {
                if (cancelled) return;
                setImporter(loaded);
                setLoadError(null);
            },
            (err: unknown) => {
                if (!cancelled)
                    setLoadError(
                        err instanceof Error ? err.message : String(err)
                    );
            }
        );
        return () => {
            cancelled = true;
        };
    }, [open, importer]);

    const submit = async () => {
        if (importer === null) return;
        setBusy(true);
        setErrors([]);
        try {
            const result = await importer.strictImportWithPrintings(
                name,
                text,
                format,
                fetchEarliest
            );
            if (!result.ok) {
                setErrors(result.errors);
                return;
            }
            const id = await create(result.payload);
            onImported(
                importer.importedLobbyDeck(id as string, result.payload)
            );
            onOpenChange(false);
        } catch (err) {
            setErrors([extractMutationErrorMessage(err)]);
        } finally {
            setBusy(false);
        }
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={(next) => {
                // Closing mid-save would still save and select the deck.
                if (!busy) onOpenChange(next);
            }}
            title="Import deck"
            subtitle="Paste a list — it is saved to your decks."
            showCloseButton
        >
            <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        aria-label="Deck name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Deck name"
                        className="input-field min-w-0 flex-1 px-3 py-1.5 text-sm"
                    />
                    {matchFormat === "freeform" && (
                        <select
                            aria-label="Import Format"
                            value={chosen}
                            onChange={(e) =>
                                setChosen(e.target.value as FormatId)
                            }
                            className="input-field px-2 py-1.5 text-sm"
                        >
                            {IMPORT_FORMAT_CHOICES.map((f) => (
                                <option key={f} value={f}>
                                    {FORMAT_LABELS[f]}
                                </option>
                            ))}
                        </select>
                    )}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger
                                aria-label="Decklist format"
                                className="text-text-muted"
                            >
                                <Info className="size-4" />
                            </TooltipTrigger>
                            <TooltipContent side="left">
                                {FORMAT_HELP}
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
                <textarea
                    aria-label="Decklist"
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        setErrors([]);
                    }}
                    placeholder={PLACEHOLDER}
                    rows={12}
                    spellCheck={false}
                    className="input-field w-full resize-y px-3 py-2 font-mono text-xs"
                />
                {importer === null && loadError === null && (
                    <p
                        className="text-xs text-text-muted"
                        data-import-loading
                        role="status"
                    >
                        Loading cards…
                    </p>
                )}
                {importer === null && loadError !== null && (
                    <Banner tone="danger" role="alert">
                        <p className="text-label">
                            Could not load the card list — close and reopen to
                            retry.
                        </p>
                        <p className="mt-1 font-mono text-xs text-text-muted">
                            {loadError}
                        </p>
                    </Banner>
                )}
                {errors.length > 0 && (
                    <Banner tone="danger" role="alert" data-import-refusal>
                        <p className="text-label">Import refused:</p>
                        <ul className="mt-1 max-h-32 select-text overflow-auto font-mono text-xs text-text-muted">
                            {errors.map((line, i) => (
                                <li key={i}>{line}</li>
                            ))}
                        </ul>
                    </Banner>
                )}
                <div className="flex items-center justify-end gap-2">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenChange(false)}
                        disabled={busy}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        variant="primary"
                        onClick={() => void submit()}
                        disabled={
                            text.trim() === "" || busy || importer === null
                        }
                    >
                        Import
                    </Button>
                </div>
            </div>
        </GameDialog>
    );
}
