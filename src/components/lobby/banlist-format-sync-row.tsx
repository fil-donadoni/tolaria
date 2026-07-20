import { useState } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { type BanlistFormatId } from "@convex/formats";
import ActionButton from "~/components/board/action-button";
import { Button } from "~/components/ui/button";
import BanlistCardsDialog from "./banlist-cards-dialog";

interface BanlistFormatSyncRowProps {
    format: BanlistFormatId;
    label: string;
}

interface SyncSummary {
    added: string[];
    removed: string[];
}

/**
 * One format's Scryfall-sync row inside `BanlistAdminPanel` (PRD #1138 User
 * Stories 5-8, issue #1146). Displays the format's banned/restricted counts
 * (`getBanlist`) and last-synced timestamp (`getBanlistMeta`) — both reactive
 * queries, so a completed sync updates this row automatically without a
 * manual refetch (`convex/react`'s `useQuery` re-subscribes on the mutated
 * table). The "Sync from Scryfall" button fires the `syncBanlist` action and
 * is disabled while it is in flight (project-wide convention for any
 * Convex-firing button). The returned added/removed summary stays visible
 * until the next sync attempt.
 */
export default function BanlistFormatSyncRow({
    format,
    label,
}: BanlistFormatSyncRowProps) {
    const entries = useQuery(api.banlists.getBanlist, { format });
    const meta = useQuery(api.banlists.getBanlistMeta, { format });
    const syncBanlist = useAction(api.banlistSync.syncBanlist);

    const [syncing, setSyncing] = useState(false);
    const [result, setResult] = useState<SyncSummary | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cardsOpen, setCardsOpen] = useState(false);

    const bannedCount =
        entries?.filter((e) => e.status === "banned").length ?? null;
    const restrictedCount =
        entries?.filter((e) => e.status === "restricted").length ?? null;

    async function handleSync() {
        if (syncing) return;
        setSyncing(true);
        setError(null);
        setResult(null);
        try {
            const summary = await syncBanlist({ format });
            setResult(summary);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Sync failed");
        } finally {
            setSyncing(false);
        }
    }

    return (
        <div className="flex flex-col gap-2 rounded-sm border border-border-subtle/40 p-3">
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-semibold text-text">{label}</p>
                    <div className="flex items-center gap-2">
                        <p className="text-xs text-text-muted">
                            {bannedCount === null
                                ? "Loading…"
                                : `${bannedCount} banned, ${restrictedCount} restricted`}
                        </p>
                        <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => setCardsOpen(true)}
                            disabled={bannedCount === null}
                        >
                            View cards
                        </Button>
                    </div>
                    <p className="text-xs text-text-muted">
                        {meta === undefined
                            ? "Loading…"
                            : meta.syncedAt === null
                              ? "Never synced (showing seed data)"
                              : `Last synced ${new Date(meta.syncedAt).toLocaleString()}`}
                    </p>
                </div>
                <ActionButton
                    onClick={() => void handleSync()}
                    label={syncing ? "Syncing…" : "Sync from Scryfall"}
                    tone="secondary"
                    disabled={syncing}
                />
            </div>
            {error && <p className="text-xs text-danger-strong">{error}</p>}
            {result && (
                <p className="text-xs text-text-muted">
                    Added {result.added.length}, removed {result.removed.length}
                    .
                </p>
            )}
            <BanlistCardsDialog
                format={format}
                label={label}
                open={cardsOpen}
                onOpenChange={setCardsOpen}
            />
        </div>
    );
}
