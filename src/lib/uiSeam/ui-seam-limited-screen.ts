// The Limited screen deep link's one parameter, read (issue #9560, ADR 0180):
// seam code only — imported by the seam page, which only a DEV bundle
// registers.
import {
    UI_SEAM_LIMITED_SCREENS,
    type UiSeamLimitedScreen,
} from "@convex/lib/uiSeamNamespace";

/** The screen a `__uiseam_screen` value names, or `null` for anything else
 *  (a missing, non-string or unknown value). */
export function readUiSeamLimitedScreen(
    value: unknown
): UiSeamLimitedScreen | null {
    return UI_SEAM_LIMITED_SCREENS.find((screen) => screen === value) ?? null;
}
