import { useState } from "react";
import { Panel, PanelHeader, PanelBody } from "~/components/ui/panel";
import { Checkbox } from "~/components/ui/checkbox";
import { useUserPreferences } from "~/hooks/useUserPreferences";

/**
 * Auto-order Settings section (issue #9988). Persists per user via
 * `convex/userSettings.ts`; the GRE reads it server-side and answers the
 * trigger-order (CR 603.3b) and graveyard-arrangement (CR 404.3) prompts with
 * the engine's own order, so nothing here changes how a prompt renders.
 */
export default function SettingsAutoOrderSection() {
    const { autoOrderPrompts, setAutoOrderPrompts, isLoading } =
        useUserPreferences();
    const [pending, setPending] = useState(false);

    function handleChange(next: boolean) {
        setPending(true);
        void setAutoOrderPrompts(next).finally(() => setPending(false));
    }

    return (
        <Panel>
            <PanelHeader
                title="Ordering prompts"
                subtitle="Triggers on the stack and cards put into your graveyard"
            />
            <PanelBody>
                <label className="flex items-start gap-3 text-sm">
                    <Checkbox
                        checked={autoOrderPrompts}
                        onCheckedChange={handleChange}
                        disabled={isLoading || pending}
                        className="mt-0.5"
                    />
                    <span>
                        <span className="block font-medium">
                            Order my triggers and graveyard automatically
                        </span>
                        <span className="block text-text-muted">
                            Skip the ordering prompts and use the engine&apos;s
                            order. Off by default.
                        </span>
                    </span>
                </label>
            </PanelBody>
        </Panel>
    );
}
