// `phaseTrigger` — declarative factory for CR 603.6a "at the beginning of
// [step]" triggered abilities. First member of the trigger-factory family
// (PRD #1, slice 3 of #4): card authors describe what step, whose scope,
// and what to do, instead of repeating the same `event.type === "PHASE_BEGIN"`
// narrowing + scope check + LKI plumbing per card. The factory handles:
//
//   * event-kind narrowing (PHASE_BEGIN) so the per-card body sees a typed
//     `PhaseBeginEvent` rather than `GameEvent`,
//   * scope resolution via `resolvePhaseScope` (your / each / opponents /
//     host-controller),
//   * delivery of `scopedPlayerId` (the active player on whose step the
//     trigger fires, or — for `host-controller` — the enchanted permanent's
//     current controller, looked up at resolve time per CR 603.10 last-known
//     information),
//   * optional CR 603.4 condition filter at trigger time and CR 603.4d
//     intervening-if filter at resolution time.
//
// Cards using the factory should NOT re-narrow the event type or recompute
// the scope inside `resolve` — they receive a typed event and the resolved
// playerId for free.

import type { Phase } from "../../../gre/types";
import type {
    PermanentView,
    PhaseBeginEvent,
    SpellContext,
    TriggerStateView,
    TriggeredAbility,
} from "../../types";
import { resolvePhaseScope, type TriggerScope } from "./shared";

/** Arguments to `phaseTrigger`. See the field docs below for the contract of
 *  each property. */
export interface PhaseTriggerArgs {
    /** Stable id within the source card's `triggeredAbilities` array. */
    id: string;
    /** Oracle text shown on the stack and in trigger logs (CR 603.3a). */
    oracleText: string;
    /** Which step's PHASE_BEGIN to listen for (CR 500.1). */
    phase: Phase;
    /** Whose step counts — drives both the trigger filter and the
     *  `scopedPlayerId` passed to `resolve`. See `TriggerScope`. */
    scope: TriggerScope;
    /** Optional CR 603.4 extra filter applied at trigger time, after the
     *  phase + scope checks pass. Use this for narrow per-card conditions
     *  the factory cannot express (e.g. an additional state-shape check that
     *  ONLY runs at trigger time, not at resolve). For "if X at resolve"
     *  semantics use `interveningIf` instead — that's the CR 603.4d hook
     *  the engine re-checks before invoking `resolve`. */
    condition?: (
        event: PhaseBeginEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** CR 603.4d intervening-if. The engine re-evaluates this predicate
     *  immediately before `resolve` runs; if it returns false the trigger
     *  fizzles (no resolve, TRIGGER_FIZZLED queued — see
     *  `gre/state.ts:resolveTopOfStack`). Use this for "if [condition on
     *  the source]" oracle phrasings (Howling Mine "if untapped", Mana
     *  Vault draw-step ping "if tapped", Clockwork Beast "if attacked or
     *  blocked this combat"). */
    interveningIf?: (
        event: PhaseBeginEvent,
        self: PermanentView,
        state?: TriggerStateView
    ) => boolean;
    /** Per-card resolution body. Receives a fresh `SpellContext`, the typed
     *  `PhaseBeginEvent` that fired the trigger, and `scopedPlayerId` — the
     *  active player on whose step the trigger fired (or, for
     *  `host-controller`, the enchanted permanent's current controller, read
     *  at resolve time so control changes between trigger and resolve are
     *  honored). */
    resolve: (
        ctx: SpellContext,
        event: PhaseBeginEvent,
        scopedPlayerId: string
    ) => void;
}

export function phaseTrigger(args: PhaseTriggerArgs): TriggeredAbility {
    return {
        id: args.id,
        oracleText: args.oracleText,
        event: "PHASE_BEGIN",
        matches: (event, self, state) => {
            if (event.type !== "PHASE_BEGIN") return false;
            if (event.phase !== args.phase) return false;
            if (resolvePhaseScope(args.scope, event, self, state) === null) {
                return false;
            }
            if (args.condition && !args.condition(event, self, state)) {
                return false;
            }
            // CR 603.4d — intervening-if is checked at BOTH trigger time and
            // resolve time. The engine wires the resolve-time check via the
            // `interveningIf` field; we mirror it into `matches` here so the
            // trigger never enters the stack when the condition is already
            // false at the moment it would fire.
            if (args.interveningIf && !args.interveningIf(event, self, state)) {
                return false;
            }
            return true;
        },
        interveningIf: args.interveningIf
            ? (event, self, state) => {
                  if (event.type !== "PHASE_BEGIN") return false;
                  return args.interveningIf!(event, self, state);
              }
            : undefined,
        resolve: (ctx, event) => {
            if (event.type !== "PHASE_BEGIN") return;
            const scoped = resolveScopeAtResolve(args.scope, event, ctx);
            if (scoped === null) return;
            args.resolve(ctx, event, scoped);
        },
    };
}

/** Resolve-time scope resolution. Mirrors `resolvePhaseScope` but reads the
 *  current host (for `host-controller`) via the SpellContext so control
 *  changes between trigger and resolve are honored. For non-aura scopes the
 *  value is read off `event` / `ctx.controller` and never returns null at
 *  resolve (matches semantics: if we got here, matches() already passed). */
function resolveScopeAtResolve(
    scope: TriggerScope,
    event: PhaseBeginEvent,
    ctx: SpellContext
): string | null {
    if (scope === "each") return event.activePlayerId;
    if (scope === "your") return ctx.controller;
    if (scope === "opponents") return event.activePlayerId;
    // host-controller: re-fetch host at resolve time (CR 603.10 LKI applies
    // to the source, not the target — the host's controller may have changed
    // between trigger and resolve via e.g. Control Magic).
    const hostId = ctx.getAttachedTo(ctx.sourceInstanceId);
    if (!hostId) return null;
    return ctx.getController({ type: "permanent", id: hostId });
}
