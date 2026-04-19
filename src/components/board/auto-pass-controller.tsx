import { useAutoPassPhases } from "~/hooks/useAutoPassPhases";
import { useSkipPhasePreferences } from "~/hooks/useSkipPhasePreferences";

export default function AutoPassController() {
    const { prefs } = useSkipPhasePreferences();
    useAutoPassPhases(prefs);
    return null;
}
