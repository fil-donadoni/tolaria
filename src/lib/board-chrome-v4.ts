import type { Combat } from "~/types/game";

/** Identity v4 board-chrome recipes (ADR 0103, issue #2727).
 *
 *  ADR 0103 §1/§3/§5 make the board's chrome quiet — graphite ground, hairline
 *  edges, monochrome ivory for the one primary action, Geist display for names
 *  and numbers — so that card art and the game-state signal hues carry every
 *  bit of colour on screen. The recipes below are the SHARED spelling of that
 *  register for the board surfaces (plaques, piles, controller, stack panel,
 *  targeting prompt), so a chip on the phone bar and a chip in the stack panel
 *  are the same chip rather than two near-misses.
 *
 *  **Class strings, deliberately.** They are literal Tailwind class text so the
 *  JIT scanner can see them (it greps source text and cannot evaluate a
 *  template), which is the same contract `portrait-board-bands.ts` /
 *  `landscape-board-bands.ts` already rely on for their band classes. Nothing
 *  here sets a WIDTH or a HEIGHT that a band budget reads: ADR 0101's bands are
 *  the contract and the skin fits inside them (see
 *  `PORTRAIT_NAMEPLATE_MAX_H` — the compact plaque's box math is mirrored in
 *  `portrait-board-bands.ts` and must not move).
 *
 *  This module is NOT a component and holds no React: it is imported by board
 *  chrome the way `controller-action-tone.ts` is. */

/** The v4 eyebrow: uppercase, 10px, .16em tracking, muted (ADR 0103 §4). The
 *  small label ABOVE a display-face value — a player's name over their life
 *  total, "Turn 6" over the phase name, a zone name over its count. Never
 *  monospace (the mono eyebrow is phase.rs's dev-dashboard signature, §4). */
export const V4_EYEBROW =
    "text-[10px] font-semibold uppercase leading-none tracking-[0.16em] text-text-muted";

/** The same eyebrow one rung quieter, for a label that must not compete with
 *  the value beside it (the stack panel's kind label, the phase-list heads). */
export const V4_EYEBROW_FAINT =
    "text-[9px] font-semibold uppercase leading-none tracking-[0.16em] text-text-disabled";

/** A hairline plate: 1px ivory/12 edge, the panel corner, a translucent
 *  graphite fill that composites over whatever board art sits behind it
 *  (ADR 0103 §5 — hairline + material, never a corner bracket). The board's
 *  floating chrome (plaques, the controller pod, the phone bar cells) is this
 *  plate; a genuine PANEL — the stack, the phase list, the targeting prompt —
 *  uses the shared `Panel` primitive instead, which carries the grain. */
export const V4_PLATE =
    "rounded-[var(--panel-radius)] border border-[var(--hairline)] bg-surface/85 backdrop-blur-md";

/** The ivory count badge (ADR 0103 §3 — the one opaque ivory element carries
 *  the number the player scans for). Used on the pile thumbs and on the phone
 *  chips; `tabular-nums` so a count never jumps width as it ticks. */
export const V4_COUNT_BADGE =
    "inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-bold leading-5 tabular-nums text-surface-base";

/** A quiet informational chip — hairline edge, muted label. The neutral
 *  sibling of the seat-coloured `signal-self` / `signal-opponent` chips the
 *  stack rows use, which keep their hues because they carry meaning (§3). */
export const V4_CHIP =
    "inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--hairline-strong)] px-2 py-0.5 text-[10px] font-semibold leading-none text-text-muted";

/** Life at or below this reads as a LOW-LIFE plaque state (ADR 0103 §8 — the
 *  signal hues carry meaning, and "you are nearly dead" is the one life-total
 *  state worth a hue). Five is the conventional burn range; it is a display
 *  threshold only and the engine never reads it. */
export const V4_LOW_LIFE_THRESHOLD = 5;

/** The three plaque states of the issue's AC, in precedence order. `null` is
 *  the resting plaque. `attacked` beats `low` (being attacked at 3 life is
 *  still first and foremost being attacked); `active` is the quietest of the
 *  three and loses to both. */
export type PlaqueState = "attacked" | "low" | "active" | null;

/** Pick the plaque state from the three inputs the board already knows.
 *  Pure — the same arguments always give the same state, so the precedence is
 *  unit-testable away from React. */
export function plaqueState({
    hasPriority,
    underAttack,
    life,
}: {
    hasPriority: boolean;
    underAttack: boolean;
    life: number;
}): PlaqueState {
    if (underAttack) return "attacked";
    if (life <= V4_LOW_LIFE_THRESHOLD) return "low";
    if (hasPriority) return "active";
    return null;
}

/** CR 506.2 / 508.1a — in a two-player game the DEFENDING player is the one
 *  whose turn it is not, so a seat is "under attack" exactly while attackers
 *  have been declared and that seat is not the active player. Deliberately
 *  derived from `combat.attackerIds` rather than the phase: the state persists
 *  through the declare-blockers and combat-damage steps, which is when the
 *  plaque most needs to say it. */
export function isUnderAttack(
    combat: Combat | undefined,
    playerId: string,
    activePlayerId: string
): boolean {
    if (!combat || combat.attackerIds.length === 0) return false;
    return playerId !== activePlayerId;
}

/** Whether the mid-board line is WARM (`signal-opponent`) rather than the
 *  resting hairline. True while attackers are being declared (CR 508 — the
 *  step is open until the attack is confirmed) and for as long as attackers
 *  are on the board, so the line stays lit through blockers and damage rather
 *  than blinking off the instant the declaration is locked in. */
export function isCombatLineHot(combat: Combat | undefined): boolean {
    if (!combat) return false;
    return !combat.confirmed || combat.attackerIds.length > 0;
}
