import { useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { PhaseSkipPrefs } from "~/lib/skip-phase-prefs";

/** Keep the server's copy of the Phase Stop preferences current (ADR 0077):
 *  sent on game entry and again on every change, for each seat in `seatIds`.
 *  The server drain reads them to pass a run of skipped steps in one
 *  mutation; a failed send only loses that shortcut, because a seat with no
 *  stored preferences is never skipped and the client auto-pass still runs. */
export function useSyncSkipPrefs(
    gameId: Id<"games">,
    seatIds: readonly string[],
    prefs: PhaseSkipPrefs
): void {
    const setSkipPrefs = useMutation(api.gamePrefs.setSkipPrefs);
    const seatKey = seatIds.join("|");
    const prefsKey = JSON.stringify(prefs);

    useEffect(() => {
        if (seatKey === "") return;
        setSkipPrefs({
            gameId,
            playerIds: seatKey.split("|"),
            skipPrefs: JSON.parse(prefsKey) as PhaseSkipPrefs,
        }).catch(() => {
            // The drain degrades to "do not skip"; nothing to surface.
        });
    }, [gameId, seatKey, prefsKey, setSkipPrefs]);
}
