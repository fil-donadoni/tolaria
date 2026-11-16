import type { ControllerAction } from "~/hooks/useControllerActions";

/** The three roles every controller surface splits `useControllerActions()`
 *  into. `pass` and `passTurn` are the two ALWAYS-AVAILABLE actions — a surface
 *  that wants a stable layout keeps their slots mounted (disabled) instead of
 *  letting the row reflow when the engine stops offering them. */
export type ControllerActionSplit = {
    pass: ControllerAction | undefined;
    passTurn: ControllerAction | undefined;
    /** Pass Until Action (issue #5782): rendered beside Pass Turn, never in
     *  the centre slot — it is a standing pass, not the step's call to action. */
    passUntilAction: ControllerAction | undefined;
    /** Everything else, in the engine's display order. */
    contextual: ControllerAction[];
};

/** Splits the live `useControllerActions()` descriptor list into the always-on
 *  Pass / Pass Turn pair plus the remaining contextual actions.
 *
 *  This is what lets the portrait bar keep Pass and Pass Turn permanently on
 *  screen (disabled when the engine doesn't offer them) instead of mounting and
 *  unmounting buttons as priority changes — the layout-shift complaint the
 *  variant-D redesign exists to answer (#1758/#1759). */
export function splitControllerActions(
    actions: ControllerAction[]
): ControllerActionSplit {
    const pass = actions.find((a) => a.key === "pass");
    const passTurn = actions.find(
        (a) => a.key === "pass-turn" || a.key.startsWith("pass-turn-")
    );
    const passUntilAction = actions.find((a) => a.key === "pass-until-action");
    const contextual = actions.filter(
        (a) => a !== pass && a !== passTurn && a !== passUntilAction
    );
    return { pass, passTurn, passUntilAction, contextual };
}

/** The command row's fixed slots (variant D, #1759). Exactly ONE morphing
 *  primary occupies the centre slot, a circular Pass-Turn button occupies the
 *  trailing slot, and anything left over renders as small side pills. */
export type ControllerCommandSlots = ControllerActionSplit & {
    /** The single morphing call-to-action: the first ACTIONABLE contextual
     *  action beats Pass, so the button the player wants is always the big one
     *  (the Arena model). `undefined` when there is nothing to do at all — the
     *  slot still renders, disabled, so the row never resizes. */
    primary: ControllerAction | undefined;
    /** Informative chrome (waiting on opponent / auto-passing / queued pass
     *  turn) shown in the SAME centre slot when there is no actionable primary.
     *  It is styled as a status pill rather than a call-to-action, but it stays
     *  CLICKABLE when the engine gave it a real handler — "Auto-passing…
     *  (cancel)" is a status pill that cancels auto-pass. */
    statusPill: ControllerAction | undefined;
    /** Everything the centre slot did not take, rendered as small side pills.
     *  A status pill that lost the centre slot to an actionable primary lands
     *  here rather than disappearing — "Pass Turn queued (cancel)" can be
     *  raised while the player still holds priority, and it must stay
     *  cancellable. */
    secondary: ControllerAction[];
};

/** Assigns each controller action to its variant-D command-row slot.
 *
 *  Pure: the bar renders whatever comes back without further branching, so the
 *  morphing rule is unit-testable away from React. */
export function selectCommandSlots(
    actions: ControllerAction[]
): ControllerCommandSlots {
    const split = splitControllerActions(actions);
    const primary = split.contextual.find((a) => !a.pill) ?? split.pass;
    const statusPill = split.contextual.find((a) => a.pill);
    // Exactly one descriptor occupies the fixed centre slot; nothing else may
    // silently vanish, so the remainder becomes side pills.
    const centre = primary ?? statusPill;
    const secondary = split.contextual.filter((a) => a !== centre);
    return { ...split, primary, statusPill, secondary };
}

/** The desktop pod's command row (issue #9835, prototype verdict C): the
 *  command slots plus what the pod draws in each — ONE pill whose content
 *  morphs, two always-mounted icon passes, and the leftovers as shelf chips.
 *  Every field is present in every state, so the pod's height never moves. */
export type PodCommandSlots = {
    /** The primary pill. `action` is what a click dispatches (absent on the
     *  disabled placeholder); `mark` is its `data-controller-primary` value
     *  (issue #3651) — `"action"` only when the step offers a real call to
     *  action, so a status or a bare cue is never mistaken for one. */
    pill: {
        action: ControllerAction | undefined;
        mark: "action" | "status";
        label: string;
        description: string | undefined;
    };
    /** Pass Turn / Pass Until Action: the step's own descriptor, else the
     *  queued-intent one (`ControllerState.queuedPasses`), else nothing — the
     *  button stays mounted, disabled. */
    passTurn: ControllerAction | undefined;
    passUntilAction: ControllerAction | undefined;
    /** Leftover actions, as small chips on the fixed-height shelf. */
    chips: ControllerAction[];
};

/** Assigns the desktop pod's command row (issue #9835). Pure, like
 *  {@link selectCommandSlots} which it builds on, so the per-state
 *  assignment is pinned away from React. */
export function selectPodCommandSlots(
    actions: ControllerAction[],
    idle: { label: string; description: string },
    queuedPasses?: {
        passTurn: ControllerAction;
        passUntilAction: ControllerAction;
    }
): PodCommandSlots {
    const slots = selectCommandSlots(actions);
    const centre = slots.primary ?? slots.statusPill;
    return {
        pill: centre
            ? {
                  action: centre,
                  mark: centre === slots.primary ? "action" : "status",
                  label: centre.label,
                  description: centre.description,
              }
            : {
                  action: undefined,
                  mark: "status",
                  label: idle.label,
                  description: idle.description,
              },
        passTurn: slots.passTurn ?? queuedPasses?.passTurn,
        passUntilAction: slots.passUntilAction ?? queuedPasses?.passUntilAction,
        chips: slots.secondary,
    };
}
