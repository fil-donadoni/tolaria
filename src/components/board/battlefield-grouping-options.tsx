import SettingsOptionGroup from "~/components/settings/settings-option-group";
import { useBattlefieldGrouping } from "~/hooks/useBattlefieldGrouping";
import { BATTLEFIELD_GROUPING_OPTIONS } from "~/lib/boardViewPrefs";

/**
 * Stacked / Separate choice for identical permanents (issue #7429). ONE
 * control mounted in two homes — the in-game Game Menu and Settings → Board —
 * both bound to the same per-device preference (`useBattlefieldGrouping`), so
 * flipping it in either re-lays the battlefield out at once.
 */
export default function BattlefieldGroupingOptions({
    legendVisible = true,
}: {
    /** `false` when a surrounding Panel title already names the choice. */
    legendVisible?: boolean;
}) {
    const [grouping, setGrouping] = useBattlefieldGrouping();
    return (
        <SettingsOptionGroup
            legend="Identical permanents"
            legendVisible={legendVisible}
            options={BATTLEFIELD_GROUPING_OPTIONS}
            value={grouping}
            onChange={setGrouping}
        />
    );
}
