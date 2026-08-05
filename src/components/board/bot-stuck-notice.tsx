// Rung 5 of the bot's liveness ladder (issue #2284): the human's manual exit.
//
// The escalation ladder ran out of legal automatic exits while the engine's
// Expected Input still named the bot. That is never a silent no-op — the board
// says so, names the window the AI could not act in, and offers a control that
// advances the game through the SAME legal engine path the ladder walks
// (`resolveStuck` re-walks it and submits the first realisable rung). A stuck
// game is never a dead end.

import type { ExpectedInputKind } from "@convex/gre/expectedInput";
import { useState } from "react";

/** Player-facing name for the window the AI could not act in. Deliberately
 *  plain English — the player is not expected to know ADR 0047. */
const WINDOW_LABEL: Record<ExpectedInputKind, string> = {
    choice: "a choice while a spell was resolving",
    target: "choosing a target",
    blockers: "declaring blockers",
    sacrifice: "paying an attack cost",
    "attack-mana-tax": "paying an attack cost",
    priority: "taking its turn",
};

export default function BotStuckNotice({
    stuck,
    onResolve,
}: {
    stuck: { expectedKind: ExpectedInputKind } | null;
    onResolve: () => Promise<void>;
}) {
    const [pending, setPending] = useState(false);
    if (!stuck) return null;

    const handle = () => {
        setPending(true);
        // `.catch` before `.finally`: a rejecting rung must re-enable the button
        // and leave the banner up (the player retries), never surface as an
        // unhandled promise rejection. `useVsAiDriver.resolveStuck` already
        // swallows its own failures; this keeps the component correct for any
        // caller that does not.
        void onResolve()
            .catch(() => {})
            .finally(() => setPending(false));
    };

    return (
        <div
            role="alert"
            className="pointer-events-auto fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface px-4 py-2 text-sm text-fg shadow-lg"
        >
            <span>
                The AI could not act ({WINDOW_LABEL[stuck.expectedKind]}).
            </span>
            <button
                type="button"
                onClick={handle}
                disabled={pending}
                className="rounded border border-border px-2 py-1 text-xs font-medium disabled:opacity-50"
            >
                {pending ? "Continuing…" : "Continue game"}
            </button>
        </div>
    );
}
