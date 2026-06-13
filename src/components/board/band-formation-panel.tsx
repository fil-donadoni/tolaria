import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Combat } from "~/types/game";
import { getCardById } from "@convex/cards";
import { extractMutationErrorMessage } from "~/lib/mutation-error";

const hasBanding = (c: CardInstance): boolean =>
    c.staticAbilities?.includes("banding") ?? false;

/**
 * Band-formation control shown to the attacking player during attacker
 * declaration (CR 702.21e). A band groups 2+ attackers — at least one with
 * banding and at most one without — that attack and are blocked as a unit. The
 * panel only appears once a band is actually possible (a selected banding
 * attacker plus another selected attacker).
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
    if (ungrouped.length < 2 || !ungrouped.some(hasBanding)) {
        if (bands.length === 0) return null;
    }

    const toggle = (id: string) =>
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        );

    const chosen = selected
        .map((id) => attackers.find((a) => a.id === id))
        .filter((c): c is CardInstance => !!c && !bandedIds.has(c.id));
    const nonBanding = chosen.filter((c) => !hasBanding(c));
    const canCreate =
        chosen.length >= 2 && chosen.some(hasBanding) && nonBanding.length <= 1;

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
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 bg-black/90 border border-white/20 rounded-lg p-3 text-white text-xs max-w-sm">
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
                                            ? "bg-amber-500/40 border-amber-300"
                                            : "bg-white/10 border-white/20"
                                    }`}
                                >
                                    {getCardById(c.card.id).name}
                                    {hasBanding(c) ? " ⟡" : ""}
                                </button>
                            );
                        })}
                    </div>
                    <button
                        disabled={!canCreate || busy}
                        onClick={handleCreate}
                        className="px-3 py-1 rounded bg-amber-600/40 border border-amber-400/50 disabled:opacity-40 disabled:cursor-not-allowed mb-2"
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
                            className="flex items-center gap-2 bg-white/5 rounded px-2 py-1"
                        >
                            <span className="flex-1 truncate">
                                {b.memberIds
                                    .map((id) => {
                                        const c = attackers.find(
                                            (a) => a.id === id
                                        );
                                        return c
                                            ? getCardById(c.card.id).name
                                            : id;
                                    })
                                    .join(" + ")}
                            </span>
                            <button
                                disabled={busy}
                                onClick={() => handleRemove(b.bandId)}
                                className="text-red-300 hover:text-red-200 disabled:opacity-40"
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {error && <div className="text-red-400 mt-2">{error}</div>}
        </div>
    );
}
