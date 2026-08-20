import { useState } from "react";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import SettingsOptionGroup from "./settings-option-group";
import { useUserPreferences } from "~/hooks/useUserPreferences";
import {
    PREVIEW_PREFERENCE_OPTIONS,
    type PreviewPreference,
} from "~/lib/user-preferences";

/**
 * Preview default Settings section (issue #2595). Seeds `CardPreviewBody`'s
 * initial Oracle/Printed toggle (`src/components/cards/card-preview-body.tsx`)
 * — a one-time seed per mount, not a live binding: a card preview already
 * open when this changes elsewhere keeps whatever the viewer toggled it to.
 * Manual Game forces "Printed" and hides the toggle regardless of this
 * setting; unrelated to it.
 */
export default function SettingsPreviewSection() {
    const { previewPreference, setPreviewPreference, isLoading } =
        useUserPreferences();
    const [pending, setPending] = useState(false);

    function handleChange(next: PreviewPreference) {
        setPending(true);
        void setPreviewPreference(next).finally(() => setPending(false));
    }

    return (
        <Panel>
            <PanelHeader
                title="Card preview default"
                subtitle="Oracle text or the original printing"
            />
            <PanelBody>
                <SettingsOptionGroup
                    legend="Card preview default"
                    legendVisible={false}
                    options={PREVIEW_PREFERENCE_OPTIONS}
                    value={previewPreference}
                    onChange={handleChange}
                    disabled={isLoading || pending}
                />
            </PanelBody>
        </Panel>
    );
}
