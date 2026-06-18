// Standalone floating box for the Bot's last DecisionTrace.
//
// Split out of the Debug panel on purpose: the Debug panel closes on any
// click-outside, which dismisses the trace the moment you interact with the
// board. This box has its OWN collapse toggle and no outside-click listener, so
// it stays put while you play and watch the bot decide. Mounted only in DEV
// vs-AI games (see game.route). Reads the client-only trace store via the inner
// `AiDecisionTrace`.

import { useState } from "react";
import AiDecisionTrace from "./ai-decision-trace";

export default function AiDecisionTraceBox() {
    const [open, setOpen] = useState(true);

    return (
        <div className="fixed top-1/2 left-16 z-100 -translate-y-1/2 font-mono text-xs">
            <div className="rounded-lg border border-white/10 bg-black/90 shadow-2xl backdrop-blur">
                <button
                    onClick={() => setOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-6 px-3 py-2 text-white/70 hover:text-white"
                >
                    <span className="font-semibold">AI trace</span>
                    <span className="text-white/40">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                    <div className="max-h-[70vh] overflow-y-auto border-t border-white/10 px-3 py-2">
                        <AiDecisionTrace />
                    </div>
                )}
            </div>
        </div>
    );
}
