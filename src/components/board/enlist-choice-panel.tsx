import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Combat } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import { displayCardId } from "~/lib/card-utils";
import { enlistOffers } from "~/lib/enlist-offer";
import { Panel } from "~/components/ui/panel";

/**
 * Optional-attack-cost control shown to the attacking player while attackers are
 * still being declared (CR 508.1g / 702.154a — "you may tap up to one untapped
 * creature you control that you didn't choose to attack with").
 *
 * The choice belongs beside the attacker selection, as with exert: it is part of
 * declaring attackers. Declining is the default and always legal, so the panel
 * only appears once a declared attacker has someone it could tap.
 */
export default function EnlistChoicePanel({
    combat,
    battlefield,
    gameId,
    playerId,
}: {
    combat: Combat;
    battlefield: CardInstance[];
    gameId: Id<"games">;
    playerId: string;
}) {
    const toggleEnlist = useMutation(api.game.toggleEnlist);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const offers = enlistOffers(battlefield, combat.attackerIds);
    if (offers.length === 0) return null;

    const handleToggle = async (attackerId: string, enlistedId: string) => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await toggleEnlist({ gameId, playerId, attackerId, enlistedId });
        } catch (e) {
            setError(extractMutationErrorMessage(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        // Positioning is owned by the declare-attackers dock in CombatPanels.
        <div>
            <Panel density="compact" className="max-w-sm p-3 text-xs">
                <div className="font-bold mb-1">Enlist (optional)</div>
                <div className="text-content-muted mb-2">
                    Tap a creature that isn&apos;t attacking. The attacker gets
                    +X/+0 until end of turn, where X is that creature&apos;s
                    power.
                </div>
                {offers.map(({ attacker, partners }) => (
                    <div key={attacker.id} className="mb-1 last:mb-0">
                        <div className="mb-1">
                            {getDefinition(displayCardId(attacker)).name} taps:
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {partners.map((partner) => {
                                const on = (combat.enlists ?? []).some(
                                    (pair) =>
                                        pair.attackerId === attacker.id &&
                                        pair.enlistedId === partner.id
                                );
                                return (
                                    <button
                                        key={partner.id}
                                        disabled={busy}
                                        aria-pressed={on}
                                        onClick={() =>
                                            void handleToggle(
                                                attacker.id,
                                                partner.id
                                            )
                                        }
                                        className={`px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                                            on
                                                ? "bg-signal-pending/40 border-signal-pending"
                                                : "bg-surface-elevated border-border-subtle"
                                        }`}
                                    >
                                        {on ? "✓ " : ""}
                                        {
                                            getDefinition(
                                                displayCardId(partner)
                                            ).name
                                        }
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ))}
                {error && (
                    <div className="mt-2 text-signal-danger">{error}</div>
                )}
            </Panel>
        </div>
    );
}
