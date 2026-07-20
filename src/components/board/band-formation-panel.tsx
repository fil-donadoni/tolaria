import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Combat } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import { hasBandingLike, canFormBand } from "~/lib/banding";
import { Panel } from "~/components/ui/panel";

/**
 * Band-formation control shown to the attacking player during attacker
 * declaration (CR 702.21e / 702.22j). A band groups 2+ attackers — for plain
 * banding, at least one with banding and at most one without; for "bands with
 * other [quality]", every member sharing the quality — that attack and are
 * blocked as a unit. The panel only appears once a band is actually possible (a
 * selected banding / bands-with-other attacker plus another selected attacker).
 */
export default function BandFormationPanel({
    combat,
    attackers,
    gameId,
    playerId,
}: {
    combat: Combat;
    attackers: CardInstance[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const createBand = useMutation(api.game.createBand);
    const removeBand = useMutation(api.game.removeBand);
    const [selected, setSelected] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const bands = combat.bands ?? [];
    const bandedIds = new Set(bands.flatMap((b) => b.memberIds));
    const ungrouped = attackers.filter((c) => !bandedIds.has(c.id));

    // Only worth showing when a fresh band is still formable.
    if (ungrouped.length < 2 || !ungrouped.some(hasBandingLike)) {
        if (bands.length === 0) return null;
    }

    const toggle = (id: string) =>
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );

    const chosen = selected
        .map((id) => attackers.find((a) => a.id === id))
        .filter((c): c is CardInstance => !!c && !bandedIds.has(c.id));
    const canCreate = canFormBand(chosen);

    const handleCreate = async () => {
        if (busy || !canCreate) return;
        setBusy(true);
        setError(null);
        try {
            await createBand({
                gameId,
                playerId,
                memberIds: chosen.map((c) => c.id),
            });
            setSelected([]);
        } catch (e) {
            setError(extractMutationErrorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    const handleRemove = async (bandId: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await removeBand({ gameId, playerId, bandId });
        } finally {
            setBusy(false);
        }
    };

    return (
        // Positioning is owned by the declare-attackers dock in CombatPanels.
        <div>
            <Panel density="compact" className="max-w-sm p-3 text-xs">
                <div className="font-bold mb-2">Form a Band (banding)</div>
                {ungrouped.length >= 2 && (
                    <>
                        <div className="flex flex-wrap gap-1 mb-2">
                            {ungrouped.map((c) => {
                                const isSel = selected.includes(c.id);
                                return (
                                    <button
                                        key={c.id}
                                        onClick={() => toggle(c.id)}
                                        className={`px-2 py-1 rounded border ${
                                            isSel
                                                ? "bg-signal-pending/40 border-signal-pending"
                                                : "bg-surface-elevated border-border-subtle"
                                        }`}
                                    >
                                        {getDefinition(c.card.id).name}
                                        {hasBandingLike(c) ? " ⟡" : ""}
                                    </button>
                                );
                            })}
                        </div>
                        <button
                            disabled={!canCreate || busy}
                            onClick={handleCreate}
                            className="px-3 py-1 rounded bg-signal-pending/40 border border-signal-pending/50 disabled:opacity-40 disabled:cursor-not-allowed mb-2"
                        >
                            Create band
                        </button>
                    </>
                )}
                {bands.length > 0 && (
                    <div className="flex flex-col gap-1">
                        {bands.map((b) => (
                            <div
                                key={b.bandId}
                                className="flex items-center gap-2 bg-surface-elevated/50 rounded px-2 py-1"
                            >
                                <span className="flex-1 truncate">
                                    {b.memberIds
                                        .map((id) => {
                                            const c = attackers.find(
                                                (a) => a.id === id
                                            );
                                            return c
                                                ? getDefinition(c.card.id).name
                                                : id;
                                        })
                                        .join(" + ")}
                                </span>
                                <button
                                    disabled={busy}
                                    onClick={() => handleRemove(b.bandId)}
                                    className="text-danger-strong hover:text-parchment disabled:opacity-40"
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                    </div>
                )}
                {error && (
                    <div className="text-danger-strong mt-2">{error}</div>
                )}
            </Panel>
        </div>
    );
}
