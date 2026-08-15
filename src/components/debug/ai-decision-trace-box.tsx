// Box for the Bot's last DecisionTrace, mounted in the left `DevPanelRail`.
//
// Kept a SEPARATE box from the Debug panel on purpose: the Debug panel closes on
// any click-outside, which would dismiss the trace the moment you interact with
// the board. This box has its OWN collapse toggle and no outside-click listener,
// so it stays put while you play and watch the bot decide. It does NOT position
// itself — the rail owns the anchoring, which is what keeps the two overlays
// from overlapping. Mounted only in DEV vs-AI games (see game.route). Reads the
// client-only trace store via the inner `AiDecisionTrace`.

import { useState } from "react";
import { Panel } from "~/components/ui/panel";
import AiDecisionTrace from "./ai-decision-trace";
import AiEscalationLog from "./ai-escalation-log";
import AiDecisionLog from "./ai-decision-log";

export default function AiDecisionTraceBox() {
    const [open, setOpen] = useState(true);

    return (
        <Panel density="compact" className="w-72 shrink-0 px-3 py-2">
            {/* Toggle kept as the original compact dev affordance — the big
                    Beleren `PanelHeader` band is deliberately NOT used here. */}
            <button
                onClick={() => setOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-6 text-text-muted hover:text-parchment"
            >
                <span className="font-semibold">AI trace</span>
                <span className="text-text-disabled">{open ? "▾" : "▸"}</span>
            </button>
            {open && (
                <div className="mt-2 flex max-h-[40vh] flex-col gap-2 overflow-y-auto border-t border-border-accent/20 pt-2">
                    {/* issue #2284 — a decision the bot could NOT make has no
                        DecisionTrace to ride on, so the escalations get their
                        own list. Renders nothing while the liveness invariant
                        holds normally. */}
                    <AiEscalationLog />
                    {/* issue #2470 — how each decision ENDED. The escalation
                        list above says what fired after the normal path
                        produced nothing; this says why it produced nothing. */}
                    <AiDecisionLog />
                    <AiDecisionTrace />
                </div>
            )}
        </Panel>
    );
}
