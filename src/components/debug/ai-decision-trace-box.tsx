// Box for the Bot's last DecisionTrace, mounted at the top of the left
// `DebugSheet` (issue #3403).
//
// It does NOT POSITION itself — the sheet owns placement, which is what lets
// the same box sit in a 400px-wide phone sheet and a desktop one. What it does
// own is the OPEN BODY'S max-height: 40vh, lifted to 65vh from `lg` up
// (issue #3492), because a desktop sheet was showing a short scroller inside a
// column of unused vertical space. The variant is `lg` (1024px) and not `md`
// deliberately — the landscape-phone viewport is 844x390, wide enough for `md`
// and only 390px TALL, so an `md` lift would have spent the one viewport where
// the height budget is actually scarce.
//
// It keeps its own collapse toggle so a tester can fold the trace away and
// still reach the actions below it, and it has no outside-click listener of
// its own: the sheet is non-modal and pointer-undismissable, so watching the
// bot decide while clicking through the board is the normal way to use it.
// Mounted only for a vs-AI game (see `debug-sheet.tsx`). Reads the client-only
// trace store via the inner `AiDecisionTrace`.

import { useState } from "react";
import { Panel } from "~/components/ui/panel";
import AiDecisionTrace from "./ai-decision-trace";
import AiEscalationLog from "./ai-escalation-log";
import AiDecisionLog from "./ai-decision-log";

export default function AiDecisionTraceBox() {
    const [open, setOpen] = useState(true);

    return (
        <Panel density="compact" className="w-full min-w-0 shrink-0 px-3 py-2">
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
                <div
                    data-ai-trace-body=""
                    className="mt-2 flex max-h-[40vh] flex-col gap-2 overflow-y-auto border-t border-border-accent/20 pt-2 lg:max-h-[65vh]"
                >
                    {/* The RING FIRST (issue #3492). It is the section a tester
                        reads to judge a bot play, and it used to sit under the
                        outcome log — which is non-empty in the HEALTHY case
                        (`ai-decision-log.tsx`), so the healthy game was exactly
                        the one that buried it. The two logs below are read when
                        the ring says nothing, so they belong after it. */}
                    <AiDecisionTrace />
                    {/* issue #2284 — a decision the bot could NOT make has no
                        DecisionTrace to ride on, so the escalations get their
                        own list. Renders nothing while the liveness invariant
                        holds normally. */}
                    <AiEscalationLog />
                    {/* issue #2470 — how each decision ENDED. The escalation
                        list says what fired after the normal path produced
                        nothing; this says why it produced nothing. */}
                    <AiDecisionLog />
                </div>
            )}
        </Panel>
    );
}
