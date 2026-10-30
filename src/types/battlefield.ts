// Board view types — the per-permanent visual state the battlefield
// renderers (`board-battlefield-card.tsx`, the manual board) compute, and an
// activated ability the on-card menu offers.

export type CardVisualState = {
    interactive: boolean;
    enabled: boolean;
    dimmed: boolean;
    combatOffset: string;
    ringClass: string;
    badge: { color: string; index: number } | null;
    tooltip?: string;
    /** CR 601.2d — this permanent is a legal target of an active divide-as-you-
     *  choose selection (Pyrokinesis), so it carries an on-card `[−] N [+]`
     *  stepper instead of being click-to-target. Absent ⇒ false. */
    divideTarget?: boolean;
    /** This permanent is a legal target of the spell/ability currently choosing
     *  targets (`pendingTarget`), so it renders the SAME accent-strong glow ring
     *  a targetable player nameplate gets (player-nameplate.tsx) instead of a
     *  faded Tailwind ring. A box-shadow glow can't live in `ringClass`, so it's
     *  a separate overlay in `board-battlefield-card`. Absent ⇒ false. */
    targetGlow?: boolean;
    /** Issue #6917 — an untapped Mana Ability source the viewer can activate in
     *  a plain Priority window (CR 605.3a); one source of the `actionable`
     *  ring. Absent ⇒ false. */
    manaActivatable?: boolean;
};

export type ActivatableAbility = {
    id: string;
    oracleText: string;
};
