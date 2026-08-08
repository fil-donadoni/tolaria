// Inert GRE game context for the Manual Board (PRD #2162, issue #2169).
//
// `BoardSurface`'s subtree is presentational but NOT context-free: every one of
// `BoardBattlefield`, `BoardBattlefieldCard`, `BoardPlayer`, `PlayerLibrary`,
// `PlayerGraveyard`, `PlayerExile`, `CombatPanels` and the controller layouts
// calls `useGameContext()` unconditionally, and that hook THROWS when no
// provider is mounted. So a Manual Game — which has no GRE state at all
// (ADR 0080) — must still hand the subtree a complete, well-formed context.
//
// Every field here is deliberately empty rather than absent-shaped: an empty
// stack, no pending cast / target / choice, no combat, no emblems. Read
// together with the seams the Manual Board injects (interaction, controller,
// pile verbs, row classifier) that makes every GRE-driven affordance in the
// subtree evaluate to "nothing to do", which is exactly right for a board where
// the rules are the player's job.
//
// CONTAINMENT: this is the ONE thing #2169 solves entirely on the manual side.
// No shared component is changed to tolerate a missing context.
//
// Pure: no Convex, no React, no DOM.

import type { Id } from "@convex/_generated/dataModel";
import type { Phase } from "@convex/gre/types";
import { MANUAL_PHASE_ORDER } from "@convex/manual";
import type { ProjectedManualGameState } from "@convex/manual";
import type { Player } from "~/types/game";

/** Phases the manual phase marker can name. It is a FREE marker (ADR 0080 —
 *  it enforces nothing), so an unrecognised or absent value simply reads as the
 *  main phase rather than being an error.
 *
 *  Derived from `MANUAL_PHASE_ORDER` (`convex/manual.ts`) rather than
 *  re-listed: the Space hotkey steps through that array and `manualEndTurn`
 *  resets to its first entry, so a phase this validator rejected but the
 *  stepper could reach would silently read as `PRECOMBAT_MAIN` on the board. */
const MANUAL_PHASES = new Set<string>(MANUAL_PHASE_ORDER);

export function manualPhase(phase: string | undefined): Phase {
    return phase && MANUAL_PHASES.has(phase)
        ? (phase as Phase)
        : "PRECOMBAT_MAIN";
}

/** The `GameContext` value the Manual Board provides. `priorityPlayerId` is the
 *  VIEWER: nothing reads it for a decision here (the priority indicator does
 *  not mount and the manual player interaction reports `hasPriority: false`),
 *  and pinning it to the viewer keeps any incidental "is it my turn" read from
 *  cueing the player to wait on an opponent who is never asked.
 *
 *  `isManualGame: true` is the explicit discriminator (issue #2346) that lets
 *  code OUTSIDE this containment boundary — the shared card-preview builder —
 *  tell a Manual Game from a GRE game without ever special-casing on "the
 *  definition failed to resolve" (a GRE card with a missing definition is a
 *  real bug and must stay visible, not silently read as manual). The GRE's
 *  own `GameContext` value never sets this field, so it's `undefined` there —
 *  falsy, same as `false` — and every reader treats it that way. This is the
 *  ONE field on the manual context whose shape isn't part of the `GameContext`
 *  type declaration (extra properties on a context value are structurally
 *  fine to read through a narrower, explicitly-typed subset — see
 *  `PreviewGameCtx` in `~/lib/preview-body`). */
export function makeManualGameContext(args: {
    gameId: Id<"games">;
    viewerId: string;
    state: ProjectedManualGameState;
    allPlayers: Player[];
    onSwitchGame: (gameId: Id<"games">, playerId: string) => void;
}) {
    const { gameId, viewerId, state, allPlayers, onSwitchGame } = args;
    return {
        gameId,
        playerId: viewerId,
        activePlayerId: state.activePlayerId,
        priorityPlayerId: viewerId,
        phase: manualPhase(state.phase),
        turn: state.turn,
        engineTurn: state.turn,
        stackCount: 0,
        stackItems: [],
        allPlayers,
        showAllCards: false,
        debugAllActions: false,
        onSwitchGame,
        isManualGame: true as const,
    };
}
