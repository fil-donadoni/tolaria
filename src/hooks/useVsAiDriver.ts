// Client driver for the vs-AI Bot (ADR 0001, issue #109).
//
// Watches the game; whenever the bot seat owes an action, it consults the Brain
// (in a Web Worker) and submits the decision through existing mutations. Mirrors
// the auto-pass controller's shape: a short debounce, an in-flight guard, and a
// per-window signature so the same decision never fires twice. The UI thread is
// never blocked — the heavy thinking lives in the Worker, and submission is a
// normal async mutation.

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { consultBrain } from "~/lib/ai/brain-client";
import { decideBotAction, type BotView } from "~/lib/ai/brain";
import { executeBotAction, type BotMutations } from "~/lib/ai/executor";

/** A small visible "thinking" beat before the bot acts, so the game does not
 *  feel like it is skipping the opponent's turn instantly. */
const THINK_DELAY_MS = 200;

/** `view` is rebuilt by the caller from the live game state every render. */
export function useVsAiDriver(gameId: Id<"games">, view: BotView | null): void {
    const declareMulligan = useMutation(api.game.declareMulligan);
    const confirmAttackers = useMutation(api.game.confirmAttackers);
    const confirmBlockers = useMutation(api.game.confirmBlockers);
    const passPriority = useMutation(api.game.passPriority);

    const inFlight = useRef(false);
    const lastSignature = useRef<string | null>(null);

    useEffect(() => {
        if (!view) return;

        // Cheap main-thread gate: only consult the Worker when the bot actually
        // owes an action. (The Worker returns the same decision; this avoids a
        // round-trip on the many windows where the bot does nothing.)
        const action = decideBotAction(view);
        if (action.kind === "none") return;

        // De-dupe: one submission per distinct decision window.
        const signature = `${view.phase}:${view.priorityPlayerId}:${view.activePlayerId}:${view.attackersConfirmed}:${view.blockersConfirmed}:${view.mulliganDeclaringId ?? ""}:${action.kind}`;
        if (lastSignature.current === signature) return;

        const mutations: BotMutations = {
            declareMulligan,
            confirmAttackers,
            confirmBlockers,
            passPriority,
        };

        const timer = window.setTimeout(() => {
            if (inFlight.current) return;
            inFlight.current = true;
            lastSignature.current = signature;
            void consultBrain(view)
                .then((decided) =>
                    executeBotAction(decided, {
                        gameId,
                        botId: view.botId,
                        mutations,
                    })
                )
                .catch(() => {
                    // Stale/illegal submissions are rejected server-side; the
                    // next state change re-drives. Allow a retry of this window.
                    lastSignature.current = null;
                })
                .finally(() => {
                    inFlight.current = false;
                });
        }, THINK_DELAY_MS);

        return () => window.clearTimeout(timer);
    }, [
        gameId,
        view,
        declareMulligan,
        confirmAttackers,
        confirmBlockers,
        passPriority,
    ]);
}
