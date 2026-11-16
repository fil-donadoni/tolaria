import type { ReactElement } from "react";
import { ariaKeyShortcuts, type Hotkey } from "~/lib/hotkeys";
import { Keycap } from "./keycap";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

/** A control's hover tooltip (issue #9835): its name, a 5–8 word description
 *  in small type under it, and — for an ICON-ONLY control — its hotkey's
 *  keycap. A labelled control already draws its keycap after the label
 *  (issue #9833), so it passes no `hotkey` here.
 *
 *  It opens only after `delay` ms of hover (1 s by default) and closes on
 *  leave — the kit `Tooltip`'s per-use delay, against the app provider's 0 —
 *  so a pointer crossing the controls on its way to the board flashes
 *  nothing.
 *
 *  `trigger` is the control itself, rendered as the tooltip trigger (base-ui
 *  `render`), so it keeps its own props, children and `aria-label`; a
 *  `hotkey` also adds `aria-keyshortcuts` from the declaration the cap
 *  draws. */
export function ControlTooltip({
    label,
    description,
    hotkey,
    trigger,
    side = "top",
    delay = 1000,
}: {
    label: string;
    description?: string;
    hotkey?: Hotkey;
    trigger: ReactElement;
    side?: "top" | "bottom" | "left" | "right";
    delay?: number;
}) {
    return (
        <Tooltip delay={delay}>
            <TooltipTrigger
                render={trigger}
                // Spread, never `={undefined}`: a labelled trigger carries its
                // own `aria-keyshortcuts`, which an explicit undefined would
                // merge away.
                {...(hotkey
                    ? { "aria-keyshortcuts": ariaKeyShortcuts(hotkey) }
                    : {})}
            />
            <TooltipContent side={side}>
                <span className="flex flex-col gap-0.5">
                    <span data-control-tooltip-label>{label}</span>
                    {description && (
                        <span
                            data-control-tooltip-description
                            className="text-[10px] leading-tight opacity-75"
                        >
                            {description}
                        </span>
                    )}
                </span>
                {hotkey && <Keycap hotkey={hotkey} />}
            </TooltipContent>
        </Tooltip>
    );
}
