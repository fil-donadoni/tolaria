import { useAutoPassPhases } from "~/hooks/useAutoPassPhases";
import { useAutoPassYields } from "~/hooks/useAutoPassYields";
import { useGameContext } from "~/hooks/useGameContext";
import { useSkipPhasePreferences } from "~/hooks/useSkipPhasePreferences";
import { useSyncSkipPrefs } from "~/hooks/useSyncSkipPrefs";

export default function AutoPassController({
    solo,
    skipPrefSeatIds,
}: {
    solo: boolean;
    /** The seats whose Phase Stops this client speaks for: both in a solo
     *  game, the viewer's own in every other mode (ADR 0077). */
    skipPrefSeatIds: readonly string[];
}) {
    const { prefs } = useSkipPhasePreferences();
    const { gameId } = useGameContext();
    // The server drain passes a run of skipped steps in one mutation; the
    // client loop below stays as the fallback for a run it did not start.
    useSyncSkipPrefs(gameId, skipPrefSeatIds, prefs);
    // Solo mode: 0 delay so the viewer doesn't flash through skipped phases.
    useAutoPassPhases(prefs, solo ? 0 : undefined);
    // Issue #3556 — the **Yield** loop. Mutually exclusive with the phase-stop
    // loop above by construction: that one refuses on a non-empty **Stack**,
    // this one requires it, so the two can never pass the same window twice.
    useAutoPassYields();
    return null;
}
