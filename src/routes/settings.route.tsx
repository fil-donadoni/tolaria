// /settings (issue #2595, PRD #2405 slice 16/16, ADR 0101) — the single
// surface for the app's per-user knobs: density, motion, the board pod's
// phase stops, and the card-preview Oracle/Printed default. Each concern is
// its own Panel section (`src/components/settings/`); this route is layout
// only, same shape as `design-system.route.tsx`.
import AmbientPageGround from "@/components/ui/ambient-page-ground";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import SettingsDensitySection from "@/components/settings/settings-density-section";
import SettingsMotionSection from "@/components/settings/settings-motion-section";
import SettingsPhaseStopsSection from "@/components/settings/settings-phase-stops-section";
import SettingsPreviewSection from "@/components/settings/settings-preview-section";

export default function SettingsRoute() {
    useDocumentTitle("Settings");
    return (
        <div className="relative flex-1 bg-surface-base text-text">
            <AmbientPageGround />
            <div className="relative z-10 mx-auto max-w-2xl px-4 py-10 sm:px-8">
                <header className="mb-6">
                    <p className="text-label">preferences</p>
                    <h1 className="heading-panel mt-1 text-left text-3xl">
                        Settings
                    </h1>
                </header>
                <div className="flex flex-col gap-6">
                    <SettingsDensitySection />
                    <SettingsMotionSection />
                    <SettingsPhaseStopsSection />
                    <SettingsPreviewSection />
                </div>
            </div>
        </div>
    );
}
