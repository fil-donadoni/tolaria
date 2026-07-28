import type { ControllerActionTone } from "~/hooks/useControllerActions";

/** Variant-D tone palette for controller command surfaces (#1759/#1769).
 *
 *  {@link selectCommandSlots} decides WHICH descriptor lands in which slot; this
 *  module decides how a slot is COLOURED for a given `tone`. Both the portrait
 *  command row and the landscape-compact strip render the same three slot roles
 *  (morphing primary, status pill, side pill) at different geometries — the
 *  geometry is per-surface, the tone is not, so it lives here rather than being
 *  re-spelled in each surface.
 *
 *  Semantic tokens only: `accent*` for a call-to-action, `danger*` for anything
 *  that ends the player's turn or cancels their own spell. */

/** The morphing primary call-to-action. `primary` is the solid gold pill (the
 *  one control the player is meant to hit); `destructive` is an outlined
 *  surface, deliberately quieter than the gold so a Cancel / Pass Turn that
 *  wins the slot never reads as the recommended move. */
export const CONTROLLER_PRIMARY_TONE: Record<ControllerActionTone, string> = {
    primary: "bg-gradient-to-b from-accent-strong to-accent text-surface-base",
    destructive:
        "border border-danger/60 bg-surface-base/90 text-danger-strong backdrop-blur-md",
};

/** Side pills — everything the centre slot did not take. Outlined on the base
 *  surface in both tones: a side pill is never the recommended move. */
export const CONTROLLER_SECONDARY_TONE: Record<ControllerActionTone, string> = {
    primary: "border-border-accent/50 bg-surface-base/85 text-accent-strong",
    destructive: "border-danger/50 bg-surface-base/85 text-danger-strong",
};
