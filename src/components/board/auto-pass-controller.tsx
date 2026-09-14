import { useAutoPassPhases } from "~/hooks/useAutoPassPhases";
import { useAutoPassYields } from "~/hooks/useAutoPassYields";
import { useSkipPhasePreferences } from "~/hooks/useSkipPhasePreferences";

export default function AutoPassController({ solo }: { solo: boolean }) {
    const { prefs } = useSkipPhasePreferences();
    // Solo mode: 0 delay so the viewer doesn't flash through skipped phases.
    useAutoPassPhases(prefs, solo ? 0 : undefined);
    // Issue #3556 — the **Yield** loop. Mutually exclusive with the phase-stop
    // loop above by construction: that one refuses on a non-empty **Stack**,
    // this one requires it, so the two can never pass the same window twice.
    useAutoPassYields();
    return null;
}
