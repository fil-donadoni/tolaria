import { useState } from "react";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import SurfaceReadyMarker from "~/components/ui/surface-ready-marker";
import SettingsOptionGroup from "./settings-option-group";
import { useUserPreferences } from "~/hooks/useUserPreferences";
import {
    DENSITY_PREFERENCE_OPTIONS,
    type DensityPreference,
} from "~/lib/user-preferences";

/**
 * Density Settings section (issue #2595, ADR 0101 §2). Persists per user via
 * `convex/userSettings.ts`; `UserPreferencesEffect` (mounted at the router
 * root) is what actually publishes the saved value onto `<html>` and makes
 * every unpinned `Panel` "switch live" — this section only reads/writes the
 * preference.
 */
export default function SettingsDensitySection() {
    const { density, setDensity, isLoading } = useUserPreferences();
    const [pending, setPending] = useState(false);

    function handleChange(next: DensityPreference) {
        setPending(true);
        void setDensity(next).finally(() => setPending(false));
    }

    return (
        <Panel>
            {/* The Settings page's ready marker: every section reads the same
                `useUserPreferences`, so the first one to render it speaks for
                the screen (`settle.ts`). */}
            {!isLoading && <SurfaceReadyMarker />}
            <PanelHeader
                title="Density"
                subtitle="Panel spacing rhythm across the app"
            />
            <PanelBody>
                <SettingsOptionGroup
                    legend="Density"
                    legendVisible={false}
                    options={DENSITY_PREFERENCE_OPTIONS}
                    value={density}
                    onChange={handleChange}
                    disabled={isLoading || pending}
                />
            </PanelBody>
        </Panel>
    );
}
