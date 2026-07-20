import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { type BanlistFormatId } from "@convex/formats";
import GameDialog from "~/components/ui/game-dialog";
import BanlistCardTile from "./banlist-card-tile";

interface BanlistCardsDialogProps {
    format: BanlistFormatId;
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Admin dialog showing a format's banned + restricted cards as two piles of
 * card art (PRD #1138, follow-up to `BanlistAdminPanel`, issue #1146). Reuses
 * the same reactive `getBanlist` query the sync row's counts read, so opening
 * it right after a sync shows the fresh list. Cards with no `CardDefinition`
 * yet render as name placeholders (`BanlistCardTile`) rather than being hidden
 * — the pile mirrors the complete official list, not just the built subset.
 */
export default function BanlistCardsDialog({
    format,
    label,
    open,
    onOpenChange,
}: BanlistCardsDialogProps) {
    // Skip the query until the dialog is opened — no round-trip for a pile the
    // admin never expands. (The sync row already holds the counts.)
    const entries = useQuery(
        api.banlists.getBanlist,
        open ? { format } : "skip"
    );
    const banned = entries?.filter((e) => e.status === "banned") ?? [];
    const restricted = entries?.filter((e) => e.status === "restricted") ?? [];

    return (
        <GameDialog
            open={open}
            onOpenChange={onOpenChange}
            title={`${label} banlist`}
            subtitle="Banned and restricted cards. Includes cards not yet implemented in the engine."
            size="wide"
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
                <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto">
                    {banned.length > 0 && (
                        <section className="flex flex-col gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-danger-strong-strong">
                                Banned ({banned.length})
                            </h3>
                            <div className="flex flex-wrap gap-3">
                                {banned.map((e) => (
                                    <BanlistCardTile
                                        key={e.cardName}
                                        cardName={e.cardName}
                                        status="banned"
                                        scryfallId={e.scryfallId}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                    {restricted.length > 0 && (
                        <section className="flex flex-col gap-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-strong">
                                Restricted ({restricted.length})
                            </h3>
                            <div className="flex flex-wrap gap-3">
                                {restricted.map((e) => (
                                    <BanlistCardTile
                                        key={e.cardName}
                                        cardName={e.cardName}
                                        status="restricted"
                                        scryfallId={e.scryfallId}
                                    />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </GameDialog>
    );
}
