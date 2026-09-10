import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { CardInstance, Combat } from "~/types/game";
import { getDefinition } from "@convex/cards";
import { mayExertAsAttacksById } from "@convex/gre/exert";
import { extractMutationErrorMessage } from "~/lib/mutation-error";
import { displayCardId } from "~/lib/card-utils";
import { Panel } from "~/components/ui/panel";

/**
 * Optional-attack-cost control shown to the attacking player while attackers
 * are still being declared (CR 508.1g / 701.43d — "You may exert this creature
 * as it attacks", Glorybringer).
 *
 * The choice belongs HERE, beside the attacker selection, and not to a prompt
 * raised after the declaration: CR 508.1g makes it part of declaring attackers,
 * which is what makes a creature removed from combat before damage still miss
 * its next untap step. Declining is the default and always legal, so the panel
 * only appears once a declared attacker actually offers the choice.
 */
export default function ExertChoicePanel({
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
    const toggleExert = useMutation(api.game.toggleExert);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Read from the SAME definition authority the server's
    // `exertableAttackerIds` uses, so the button set and the mutation's
    // accepted set cannot drift.
    const offers = attackers.filter(
        (c) => mayExertAsAttacksById(displayCardId(c)) !== undefined
    );
    if (offers.length === 0) return null;

    const exerted = new Set(combat.exertedIds ?? []);

    const handleToggle = async (cardInstanceId: string) => {
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            await toggleExert({ gameId, playerId, cardInstanceId });
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
                <div className="font-bold mb-1">Exert (optional)</div>
                <div className="text-content-muted mb-2">
                    An exerted creature won&apos;t untap during your next untap
                    step.
                </div>
                <div className="flex flex-wrap gap-1">
                    {offers.map((c) => {
                        const on = exerted.has(c.id);
                        return (
                            <button
                                key={c.id}
                                disabled={busy}
                                aria-pressed={on}
                                onClick={() => void handleToggle(c.id)}
                                className={`px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                                    on
                                        ? "bg-signal-pending/40 border-signal-pending"
                                        : "bg-surface-elevated border-border-subtle"
                                }`}
                            >
                                {on ? "✓ " : ""}
                                {getDefinition(displayCardId(c)).name}
                            </button>
                        );
                    })}
                </div>
                {error && (
                    <div className="mt-2 text-signal-danger">{error}</div>
                )}
            </Panel>
        </div>
    );
}
