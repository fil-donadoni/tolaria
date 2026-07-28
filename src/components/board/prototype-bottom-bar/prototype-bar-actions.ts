import type { ControllerAction } from "~/hooks/useControllerActions";

/** PROTOTYPE — throwaway (bottom-bar redesign audit 2026-07-28).
 *
 *  Splits the live `useControllerActions` descriptor list into the three slots
 *  every variant renders: an always-mounted Pass, an always-mounted Pass Turn,
 *  and the remaining contextual actions (confirm/cancel/status pills). This is
 *  what lets a variant keep Pass / Pass Turn permanently on screen (disabled
 *  when the engine doesn't offer them) instead of letting the button row
 *  reflow — the layout-shift complaint the prototype exists to answer. */
export function splitControllerActions(actions: ControllerAction[]): {
    pass: ControllerAction | undefined;
    passTurn: ControllerAction | undefined;
    contextual: ControllerAction[];
} {
    const pass = actions.find((a) => a.key === "pass");
    const passTurn = actions.find(
        (a) => a.key === "pass-turn" || a.key.startsWith("pass-turn-")
    );
    const contextual = actions.filter((a) => a !== pass && a !== passTurn);
    return { pass, passTurn, contextual };
}

/** Zone count that tolerates both fat (`CardInstance[]`) and projected
 *  (`{ count }`) shapes. */
export function zoneCount(zone: unknown[] | { count: number }): number {
    return Array.isArray(zone) ? zone.length : zone.count;
}
