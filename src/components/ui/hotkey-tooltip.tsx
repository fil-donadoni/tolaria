import type { ReactElement } from "react";
import { ariaKeyShortcuts, type Hotkey } from "~/lib/hotkeys";
import { Keycap } from "./keycap";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** The tooltip of an ICON-ONLY control with a hotkey (issue #9833): the
 *  action's name, then its keycap. A labelled control shows its keycap after
 *  the label instead and needs none of this.
 *
 *  `trigger` is the control itself, rendered as the tooltip trigger (base-ui
 *  `render`), so it keeps its own props, children and `aria-label`; this
 *  only adds `aria-keyshortcuts` from the same declaration the cap draws.
 *  Under a coarse pointer the cap hides itself and the tooltip shows the name
 *  alone. */
export function HotkeyTooltip({
    label,
    hotkey,
    trigger,
    side = "top",
}: {
    label: string;
    hotkey: Hotkey;
    trigger: ReactElement;
    side?: "top" | "bottom" | "left" | "right";
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={trigger}
                aria-keyshortcuts={ariaKeyShortcuts(hotkey)}
            />
            <TooltipContent side={side}>
                {label}
                <Keycap hotkey={hotkey} />
            </TooltipContent>
        </Tooltip>
    );
}
