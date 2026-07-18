import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";

/** CR 116.2 / 702.139f (ADR 0064) — the companion summon special action.
 *  Modeled on {@link GraveyardFlashbackButton}'s bottom-overlay affordance,
 *  but simpler: no target/mode/mana-choice pickers — the {3} is solved and
 *  applied server-side in one shot (`summonCompanion`, game.ts), so the
 *  button only needs a disable-while-in-flight guard (project convention:
 *  buttons firing Convex mutations must disable while the mutation is
 *  pending). Rendered only when the wire projection's
 *  `companion.canSummon` is true (own main phase, empty stack, priority,
 *  unused, {3} affordable) — the server re-validates regardless. */
export default function CompanionSummonButton() {
    const { gameId, playerId } = useGameContext();
    const summonCompanion = useMutation(api.game.summonCompanion);
    const [busy, setBusy] = useState(false);

    return (
        <button
            type="button"
            disabled={busy}
            onClick={async () => {
                if (busy) return;
                setBusy(true);
                try {
                    await summonCompanion({ gameId, playerId });
                } catch {
                    // Server-side guard rejected (timing shifted, mana no
                    // longer affordable, etc.) — the affordance simply
                    // disappears on the next state update.
                } finally {
                    setBusy(false);
                }
            }}
            className="absolute inset-x-0 bottom-0 z-30 rounded-b bg-accent-strong/90 px-1 py-1 text-xs font-bold text-white shadow hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-muted/80 disabled:text-text-muted disabled:shadow-none"
        >
            Companion {"{3}"}
        </button>
    );
}
