import { useAutoPassPhases } from "~/hooks/useAutoPassPhases";
import { useSkipPhasePreferences } from "~/hooks/useSkipPhasePreferences";

export default function AutoPassController({ solo }: { solo: boolean }) {
    const { prefs } = useSkipPhasePreferences();
    // Solo mode: 0 delay so the viewer doesn't flash through skipped phases.
    useAutoPassPhases(prefs, solo ? 0 : undefined);
    return null;
}
