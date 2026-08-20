import { useState } from "react";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import SettingsOptionGroup from "./settings-option-group";
import { useUserPreferences } from "~/hooks/useUserPreferences";
import {
    MOTION_PREFERENCE_OPTIONS,
    type MotionPreference,
} from "~/lib/user-preferences";

/**
 * Motion Settings section (issue #2595, ADR 0101 §2). "System" leaves the
 * `@media (prefers-reduced-motion: reduce)` query in `src/index.css` in
 * charge; "Reduced" forces the same collapsed durations regardless of what
 * the OS reports (`[data-motion="reduced"]`, same file).
 */
export default function SettingsMotionSection() {
    const { motion, setMotion, isLoading } = useUserPreferences();
    const [pending, setPending] = useState(false);

    function handleChange(next: MotionPreference) {
        setPending(true);
        void setMotion(next).finally(() => setPending(false));
    }

    return (
        <Panel>
            <PanelHeader
                title="Motion"
                subtitle="Animation and transition duration"
            />
            <PanelBody>
                <SettingsOptionGroup
                    legend="Motion"
                    legendVisible={false}
                    options={MOTION_PREFERENCE_OPTIONS}
                    value={motion}
                    onChange={handleChange}
                    disabled={isLoading || pending}
                />
            </PanelBody>
        </Panel>
    );
}
