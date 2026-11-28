import type { ReactNode } from "react";
import { FastForward, Hand } from "lucide-react";
import { ControlTooltip } from "~/components/ui/control-tooltip";
import { Keycap } from "~/components/ui/keycap";
import type { ControllerAction } from "~/hooks/useControllerActions";
import { usePrimaryClickGuard } from "~/hooks/usePrimaryClickGuard";
import { ariaKeyShortcuts } from "~/lib/hotkeys";
import type { PodCommandSlots } from "~/lib/controller-action-slots";
import {
    CONTROLLER_PRIMARY_TONE,
    CONTROLLER_SECONDARY_TONE,
} from "~/lib/controller-action-tone";

/** The quiet edge every non-CTA control in the row wears (the portrait
 *  command row's register — `border-strong`, a CONTROL boundary at ≥3:1). */
const EDGE = "border border-border-strong bg-surface-base/85";

const ICON_BUTTON = `flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full ${EDGE} text-text-muted shadow-lg transition-colors hover:text-text disabled:cursor-default disabled:opacity-30`;

/** `aria-keyshortcuts` for a labelled control, from the declaration its
 *  keycap draws (issue #9833). */
function keyShortcuts(action: ControllerAction | undefined) {
    return action?.shortcut ? ariaKeyShortcuts(action.shortcut) : undefined;
}

/** The desktop pod's command row (issue #9835, prototype verdict C): the
 *  portrait command row's model brought to the pod, at ONE constant height.
 *
 *  - a fixed-height SHELF: the priority cue when idle, leftover actions as
 *    small chips otherwise — a leftover never adds a line;
 *  - ONE line below it: the morphing primary pill (the step's call to action,
 *    else its status pill, else the bare cue) and two always-mounted icon
 *    buttons, Pass Turn and Pass Until Action, which queue their intent when
 *    the viewer lacks priority.
 *
 *  It used to be a list that mounted a button per action — 174px tall
 *  without priority, 360px declaring attackers — and the desktop stack panel
 *  anchored above it jumped with every priority change. {@link
 *  selectPodCommandSlots} decides what goes where; this only draws it. Every
 *  control carries a hover tooltip, after 1 s: its name and what it does,
 *  plus the keycap on the icon-only ones. */
export default function ControllerPodCommandRow({
    slots,
    cueBadge,
}: {
    slots: PodCommandSlots;
    /** The pod's live priority cue, shown on the shelf when it is idle and
     *  kept for assistive tech (visually hidden) when chips take it. */
    cueBadge: ReactNode;
}) {
    const { pill, chips, passTurn, passUntilAction } = slots;
    const pillAction = pill.action;
    const isCta = pill.mark === "action";
    // A click landing just as the pill morphs is dropped (issue #10973).
    const guardClick = usePrimaryClickGuard(pillAction?.key);

    return (
        <div data-controller-pod-command className="flex flex-col gap-2">
            <div
                data-controller-pod-shelf
                className="flex h-7 min-w-0 items-center gap-1.5"
            >
                {chips.length === 0 ? (
                    cueBadge
                ) : (
                    <>
                        <div className="sr-only">{cueBadge}</div>
                        {chips.map((chip) => (
                            <ControlTooltip
                                key={chip.key}
                                label={chip.label}
                                description={chip.description}
                                trigger={
                                    <button
                                        type="button"
                                        data-controller-pod-chip={chip.key}
                                        onClick={chip.onClick}
                                        disabled={chip.disabled}
                                        aria-keyshortcuts={keyShortcuts(chip)}
                                        className={`flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-semibold transition-opacity disabled:cursor-default disabled:opacity-40 ${CONTROLLER_SECONDARY_TONE[chip.tone]}`}
                                    >
                                        <span className="truncate">
                                            {chip.label}
                                        </span>
                                        {chip.shortcut && (
                                            <Keycap hotkey={chip.shortcut} />
                                        )}
                                    </button>
                                }
                            />
                        ))}
                    </>
                )}
            </div>

            <div
                data-controller-pod-row
                className="flex h-11 min-w-0 items-center gap-2"
            >
                {/* The primary pill: `data-controller-primary` names it in
                    every state — the seam `check:ui`'s game surfaces promise
                    (issue #3651) — and its value says whether the screen is
                    offering a move. A status pill stays CLICKABLE when the
                    engine gave it a handler ("Auto-passing… (cancel)"). */}
                <ControlTooltip
                    label={pill.label}
                    description={pill.description}
                    trigger={
                        <button
                            type="button"
                            data-controller-primary={pill.mark}
                            onClick={guardClick(pillAction?.onClick)}
                            disabled={!pillAction || pillAction.disabled}
                            aria-keyshortcuts={keyShortcuts(pillAction)}
                            className={`flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full px-3 text-display text-sm transition-all disabled:cursor-default ${
                                isCta && pillAction
                                    ? `shadow-[0_4px_18px_rgba(0,0,0,0.45)] disabled:opacity-40 disabled:shadow-none ${CONTROLLER_PRIMARY_TONE[pillAction.tone]}`
                                    : `${EDGE} text-text-muted shadow-lg disabled:opacity-80`
                            }`}
                        >
                            <span className="truncate">{pill.label}</span>
                            {isCta && pillAction?.shortcut && (
                                <Keycap hotkey={pillAction.shortcut} />
                            )}
                        </button>
                    }
                />

                <ControlTooltip
                    label="Pass Turn"
                    description={passTurn?.description}
                    hotkey={passTurn?.shortcut}
                    trigger={
                        <button
                            type="button"
                            aria-label="Pass Turn"
                            data-controller-pod-pass="turn"
                            onClick={passTurn?.onClick}
                            disabled={!passTurn || passTurn.disabled}
                            className={ICON_BUTTON}
                        >
                            <FastForward className="h-4 w-4" aria-hidden />
                        </button>
                    }
                />

                <ControlTooltip
                    label="Pass Until Action"
                    description={passUntilAction?.description}
                    hotkey={passUntilAction?.shortcut}
                    trigger={
                        <button
                            type="button"
                            aria-label="Pass Until Action"
                            data-controller-pod-pass="until-action"
                            onClick={passUntilAction?.onClick}
                            disabled={
                                !passUntilAction || passUntilAction.disabled
                            }
                            className={ICON_BUTTON}
                        >
                            <Hand className="h-4 w-4" aria-hidden />
                        </button>
                    }
                />
            </div>
        </div>
    );
}
