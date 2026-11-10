// Rung 5 of the bot's liveness ladder (issue #9003): the transient notice that
// the Bot skipped a decision.
//
// The escalation ladder ran out of legal automatic exits while the engine's
// Expected Input still named the bot. The driver handed the window to the
// server (`botLiveness.reportStall`), which advanced it and filed the fault —
// the player never clicks anything. This says so, briefly and without blocking
// the board, so a Bot that did something odd is not a mystery.

import { useEffect, useState } from "react";
import { Banner } from "~/components/ui/banner";

/** How long the notice stays up after a skip. */
export const BOT_SKIP_NOTICE_MS = 6000;

export default function BotStuckNotice({
    skipped,
}: {
    skipped: { id: number } | null;
}) {
    // The skip whose notice has timed out. Shown again on a NEW skip (a larger
    // id), never re-shown by a re-render of the same one.
    const [expiredId, setExpiredId] = useState<number | null>(null);
    const id = skipped?.id;
    useEffect(() => {
        if (id === undefined) return;
        const timer = window.setTimeout(
            () => setExpiredId(id),
            BOT_SKIP_NOTICE_MS
        );
        return () => window.clearTimeout(timer);
    }, [id]);

    if (id === undefined || expiredId === id) return null;

    return (
        // The shared `Banner` strip (ADR 0103 §3/§5). `pointer-events-none`:
        // the notice informs, it never sits between the player and the board.
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2">
            <Banner tone="info" role="status">
                The Bot hit an error and skipped a decision — reported
                automatically.
            </Banner>
        </div>
    );
}
