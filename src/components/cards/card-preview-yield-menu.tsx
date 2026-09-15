import AnchoredPicker, {
    AnchoredPickerRow,
    type AnchorPoint,
} from "~/components/ui/anchored-picker";
import type { ActionSheetItem } from "~/components/ui/action-sheet";
import { previewSurfaceIsolationProps } from "./preview-surface-isolation";

/** The desktop RIGHT-click menu of a card whose viewing seat holds a **Yield**
 *  on it (issue #3616): "Preview" — the same anchored preview a right click
 *  opens on every other card — plus the card's "Turn off auto-yield for …"
 *  reset(s). A card without a Yield never mounts this; its right click opens
 *  the preview straight away.
 *
 *  Portal'd, yet a REACT descendant of the card, so the whole surface is
 *  isolated: a row click must never bubble into the card's own left-click
 *  handler (a battlefield permanent would read it as a tap). */
export default function CardPreviewYieldMenu({
    position,
    yieldItems,
    onPreview,
    onClose,
}: {
    position: AnchorPoint;
    yieldItems: ActionSheetItem[];
    onPreview: () => void;
    onClose: () => void;
}) {
    return (
        <div {...previewSurfaceIsolationProps} data-card-preview-yield-menu>
            <AnchoredPicker
                position={position}
                rowCount={yieldItems.length + 1}
                onCancel={onClose}
            >
                <AnchoredPickerRow
                    data-testid="card-preview-menu-preview"
                    onSelect={() => {
                        onClose();
                        onPreview();
                    }}
                >
                    Preview
                </AnchoredPickerRow>
                {yieldItems.map((item) => (
                    <AnchoredPickerRow
                        key={item.key}
                        data-testid="card-preview-menu-yield-off"
                        onSelect={(e) => {
                            onClose();
                            item.onSelect(e);
                        }}
                    >
                        {item.label}
                    </AnchoredPickerRow>
                ))}
            </AnchoredPicker>
        </div>
    );
}
