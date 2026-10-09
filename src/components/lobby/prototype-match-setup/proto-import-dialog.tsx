// PROTOTYPE — throwaway. "Import deck": name + pasted decklist, STRICT
// validation (every card engine-supported, deck admitted by the Match
// Format). Format is deduced from the Match Format; Freeform asks for it.
// Save is a stub: the deck joins an in-memory list, nothing hits the server.

import { useState } from "react";
import { validateDeck, type FormatId } from "@convex/formats";
import type { Id } from "@convex/_generated/dataModel";
import type { UserLobbyDeck } from "~/lib/deckTypes";
import { parseDecklist } from "~/lib/deckImport";
import GameDialog from "~/components/ui/game-dialog";
import ActionButton from "~/components/board/action-button";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "~/components/ui/tooltip";
import { ARENA_MATCH_FORMATS, formatLabel } from "./match-setup-logic";

const PLACEHOLDER = `4 Swords to Plowshares
4 Serra Angel
20 Plains

Sideboard
3 Circle of Protection: Red`;

interface ProtoImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    matchFormat: FormatId;
    onImported: (deck: UserLobbyDeck) => void;
}

export default function ProtoImportDialog({
    open,
    onOpenChange,
    matchFormat,
    onImported,
}: ProtoImportDialogProps) {
    const [name, setName] = useState("");
    const [text, setText] = useState("");
    const [pickedFormat, setPickedFormat] = useState<FormatId>("freeform");
    const [errors, setErrors] = useState<string[]>([]);
    const format = matchFormat === "freeform" ? pickedFormat : matchFormat;

    const submit = () => {
        const errs: string[] = [];
        if (!name.trim()) errs.push("Give the deck a name.");
        const parsed = parseDecklist(text, format);
        for (const line of parsed.unresolved)
            errs.push(`Not supported by the engine: "${line}"`);
        if (parsed.cards.length === 0) errs.push("The decklist has no cards.");
        if (errs.length === 0) {
            const legality = validateDeck(
                { cards: parsed.cards, sideboard: parsed.sideboard },
                format
            );
            for (const r of legality.reasons) errs.push(r.message);
        }
        setErrors(errs);
        if (errs.length > 0) return;
        const stored = (c: { cardId: string; cardName: string }) => ({
            ...c,
            definitionId: c.cardId,
        });
        onImported({
            kind: "user",
            userDeckId: `proto-${Date.now()}` as Id<"userDecks">,
            presetId: `proto-import-${Date.now()}`,
            name: name.trim(),
            format,
            colors: [],
            cards: parsed.cards.map(stored),
            sideboard: parsed.sideboard.map(stored),
            featuredCardId: parsed.cards[0]?.cardId ?? null,
            isLegal: true,
            reasons: [],
        });
        setName("");
        setText("");
        onOpenChange(false);
    };

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title="Import deck"
            subtitle={
                matchFormat === "freeform"
                    ? "Saved to your decks under the format you pick."
                    : `Saved to your decks as ${formatLabel(matchFormat)} — the Match Format.`
            }
            footer={
                <>
                    <ActionButton
                        onClick={() => onOpenChange(false)}
                        label="Cancel"
                        tone="secondary"
                    />
                    <ActionButton
                        onClick={submit}
                        label="Validate & save"
                        tone="primary"
                    />
                </>
            }
        >
            <div className="flex flex-col gap-3">
                <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Deck name"
                    className="rounded-sm border border-border-strong bg-surface/70 px-3 py-1.5 text-sm text-text"
                />
                {matchFormat === "freeform" && (
                    <select
                        aria-label="Deck format"
                        value={pickedFormat}
                        onChange={(e) =>
                            setPickedFormat(e.target.value as FormatId)
                        }
                        className="rounded-sm border border-border-strong bg-surface/70 px-2 py-1.5 text-sm text-text"
                    >
                        {ARENA_MATCH_FORMATS.map((f) => (
                            <option key={f} value={f}>
                                {formatLabel(f)}
                            </option>
                        ))}
                    </select>
                )}
                <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Decklist
                    </span>
                    <Tooltip>
                        <TooltipTrigger
                            render={<span />}
                            className="cursor-help text-xs text-text-muted underline decoration-dotted"
                        >
                            Format ⓘ
                        </TooltipTrigger>
                        <TooltipContent>
                            One card per line: {"<count> <card name>"} (e.g. "4
                            Lightning Bolt", "4x" also works). A line
                            "Sideboard" starts the sideboard. Exports from MTGA,
                            Moxfield and MTGO paste as-is.
                        </TooltipContent>
                    </Tooltip>
                </div>
                <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={PLACEHOLDER}
                    rows={10}
                    className="rounded-sm border border-border-strong bg-surface/70 px-3 py-2 font-mono text-xs text-text placeholder:text-text-disabled"
                />
                {errors.length > 0 && (
                    <ul className="max-h-32 overflow-y-auto rounded-sm border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger-strong">
                        {errors.map((e) => (
                            <li key={e}>{e}</li>
                        ))}
                    </ul>
                )}
            </div>
        </GameDialog>
    );
}
