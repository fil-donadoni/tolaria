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

/** The morphing primary call-to-action. `primary` is v4's ONE opaque **ivory
 *  plate** with dark text (ADR 0103 §3, issue #2727 — the gold gradient it
 *  replaces was the v3 brand accent, and v4's chrome carries no brand hue);
 *  `destructive` is a hairline edge over the base surface, deliberately quieter
 *  than the plate so a Cancel / Pass Turn that wins the slot never reads as the
 *  recommended move.
 *
 *  `bg-accent` IS the ivory (`--color-accent: #efe9da`); `text-surface-base` is
 *  the graphite it sits on. The pair is re-derived by
 *  `design-tokens.test.ts`'s plate-label rung (≥4.5:1), so a future value edit
 *  cannot quietly make this unreadable. */
export const CONTROLLER_PRIMARY_TONE: Record<ControllerActionTone, string> = {
    primary: "bg-accent text-surface-base hover:bg-accent-strong",
    destructive:
        "border border-danger/60 bg-surface-base/90 text-danger-strong backdrop-blur-md",
};

/** Side pills — everything the centre slot did not take. A hairline edge on the
 *  base surface in both tones: a side pill is never the recommended move, so it
 *  never gets the plate. */
export const CONTROLLER_SECONDARY_TONE: Record<ControllerActionTone, string> = {
    primary: "border-[var(--hairline-strong)] bg-surface-base/85 text-text",
    destructive: "border-danger/50 bg-surface-base/85 text-danger-strong",
};
