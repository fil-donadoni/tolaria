import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useGameContext } from "~/hooks/useGameContext";
import { V4_ZONE_CTA } from "~/lib/board-chrome-v4";

/** CR 116.2 / 702.139a (ADR 0064) — the companion summon special action.
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
            className={V4_ZONE_CTA}
        >
            Companion {"{3}"}
        </button>
    );
}
