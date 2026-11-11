// PROTOTYPE — throwaway (player-feedback 2026-11, `?pv-preview-tabs=A|B|C`).
// "The player didn't realise the card preview's tabs exist."
import PrototypePreviewTabsBar from "./prototype-preview-tabs-bar";
import PrototypePreviewTabsRail from "./prototype-preview-tabs-rail";
import PrototypePreviewTabsSegmented from "./prototype-preview-tabs-segmented";
import type { PrototypePreviewTabsProps } from "./prototype-preview-tabs-types";

export default function PrototypePreviewTabs({
    variant,
    ...props
}: PrototypePreviewTabsProps & { variant: string }) {
    if (variant === "B") return <PrototypePreviewTabsRail {...props} />;
    if (variant === "C") return <PrototypePreviewTabsSegmented {...props} />;
    return <PrototypePreviewTabsBar {...props} />;
}
