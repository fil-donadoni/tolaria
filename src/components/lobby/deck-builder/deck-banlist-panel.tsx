import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { FormatId } from "@convex/formats";
import { Button } from "~/components/ui/button";
import GameDialog from "~/components/ui/game-dialog";

interface DeckBanlistPanelProps {
    format: FormatId;
}

// The two Formats a DB-backed official banlist exists for (PRD #1138,
// mirrors `BanlistFormatId` in `convex/formats.ts` — kept as a local literal
// set rather than an import since `BanlistFormatId` isn't exported for
// frontend consumption; `FormatId` is the wider type this component receives).
const BANLIST_FORMATS = new Set<FormatId>(["premodern", "old-school"]);

function isBanlistFormat(
    format: FormatId
): format is "premodern" | "old-school" {
    return BANLIST_FORMATS.has(format);
}

/**
 * Read-only full official banlist (PRD #1138 User Story 2, issue #1141).
 * Every player — not just admins — can open this to see the COMPLETE banlist
 * for the deck's Format, including cards with no `CardDefinition` yet (e.g.
 * Parallax Tide for Premodern): the whole point of moving banlists to the DB
 * is that the displayed list finally reads as complete, unlike the old
 * code-const lists which were implicitly intersected with the built pool.
 *
 * Renders nothing for a Format with no DB-backed banlist (Freeform, Alpha 40
 * — the latter keeps its bespoke Eternal Central lists fully code-managed).
 * `useQuery` is skipped (not called with `"skip"`) for those Formats so no
 * network round-trip fires for a panel that will render null anyway.
 */
export default function DeckBanlistPanel({ format }: DeckBanlistPanelProps) {
    const [open, setOpen] = useState(false);
    // Called inline (not via a hoisted boolean) so TS narrows `format` at the
    // `useQuery` call site — a separate `hasBanlist` boolean wouldn't carry
    // the narrowing through to the ternary below.
    const entries = useQuery(
        api.banlists.getBanlist,
        isBanlistFormat(format) ? { format } : "skip"
    );

    if (!isBanlistFormat(format)) return null;

    return (
        <>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(true)}
            >
                Banlist
            </Button>
            <GameDialog
                open={open}
                onOpenChange={setOpen}
                title="Official banlist"
                subtitle="Includes cards not yet implemented in the engine."
                dismissable
                showCloseButton
            >
                {entries === undefined ? (
                    <p className="text-sm text-text-muted">Loading…</p>
                ) : entries.length === 0 ? (
                    <p className="text-sm text-text-muted">
                        No cards are banned or restricted.
                    </p>
                ) : (
                    <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
                        {entries.map((entry) => (
                            <li
                                key={entry.cardName}
                                className="flex items-center justify-between gap-3 border-b border-border-subtle/20 py-1 text-sm last:border-none"
                            >
                                <span className="text-text">
                                    {entry.cardName}
                                </span>
                                <span
                                    className={
                                        entry.status === "banned"
                                            ? "rounded-sm bg-danger/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger-strong-strong"
                                            : "rounded-sm bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-strong"
                                    }
                                >
                                    {entry.status}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </GameDialog>
        </>
    );
}
